import { createServer } from 'node:http';
import { parseAbi, parseAbiItem, zeroAddress } from 'viem';
import { ADDR, localWalletProvider } from '../fork/lib.mjs';
import { formatG, ledgerRows } from './ledger.mjs';
import { GAME } from '../../server/config.js';
import { itemOf } from '../../server/src/shop.js';
import { controlPage, facePage } from './pages.mjs';

/**
 * The local launcher's own small server (see launch.mjs). It holds the test player's throwaway key and does what a browser
 * wallet and GoodDollar's face-scan page would do, against the local fork:
 *   POST /wallet                 sign and send for the page's test wallet (the key never reaches the browser)
 *   GET  /face-scan, POST /face-scan/pass   the face-scan stand-in: a click marks the player verified on the fork
 *   GET  /dev, GET /dev/state, POST /dev/next-day|boss-clear|revoke   the control page and its shortcuts
 * It listens on 127.0.0.1 only and refuses requests from any web page that is not itself local.
 */

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const identityAbi = parseAbi(['function getWhitelistedRoot(address) view returns (address)']);

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const PREFERRED_PORT = 5180;
/** A day boundary is crossed at least once by this much; one UTC midnight, as the browser run does. */
const SKIP_HOURS = 27;

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('request too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

/**
 * @param {{ fork: Awaited<ReturnType<import('../fork/lib.mjs').bootFork>>, settle: () => Promise<any[]>,
 *           startBlock: bigint, getGameUrl: () => string }} opts
 */
export async function startHelper({ fork, settle, startBlock, getGameUrl }) {
  const { pub, accounts, api } = fork;
  const player = accounts.player;
  const provider = localWalletProvider(fork.rpc, player, pub);
  const known = { ubi: ADDR.ubi, engagement: ADDR.engagement, vault: fork.contracts.vault };
  // A payment into the vault is a Moon Shop purchase, and its transaction names the item: read once per purchase.
  const itemNames = new Map(GAME.SHOP.map((item) => [item.id, item.name]));
  const itemByTx = new Map();
  async function nameItems(transfers) {
    for (const t of transfers) {
      if (t.args.to.toLowerCase() !== fork.contracts.vault.toLowerCase()) continue;
      if (!itemByTx.has(t.transactionHash)) {
        const tx = await pub.getTransaction({ hash: t.transactionHash });
        itemByTx.set(t.transactionHash, itemNames.get(itemOf(tx.input)) ?? null);
      }
      t.item = itemByTx.get(t.transactionHash);
    }
    return transfers;
  }
  let advancedMs = 0;
  let shortcutRunning = false;

  const isVerified = async () => {
    const root = await pub.readContract({ address: ADDR.identity, abi: identityAbi, functionName: 'getWhitelistedRoot', args: [player.address] });
    return root.toLowerCase() !== zeroAddress;
  };
  const forgetIdentity = () => api.ctx.identity.invalidate(player.address.toLowerCase()); // so the game sees the change at once

  // The fork copies the live chain on first touch, so a read of something it has not seen yet can time out. The status
  // keeps the last good value of each field rather than failing as a whole; `syncing` says some read has not caught up.
  const lastGood = { verified: null, celo: null, g: null, vaultG: null, incoming: [], outgoing: [] };
  async function state() {
    const balance = (address) => pub.readContract({ address: ADDR.token, abi: erc20Abi, functionName: 'balanceOf', args: [address] });
    const logs = (args) => pub.getLogs({ address: ADDR.token, event: TRANSFER, args, fromBlock: startBlock });
    let syncing = false;
    const keep = async (field, read, convert = (value) => value) => {
      try { lastGood[field] = convert(await read()); } catch { syncing = true; }
    };
    await Promise.all([
      keep('verified', isVerified),
      keep('celo', () => pub.getBalance({ address: player.address }), (wei) => Number(wei / 10n ** 16n) / 100),
      keep('g', () => balance(player.address), formatG),
      keep('vaultG', () => balance(fork.contracts.vault), formatG),
      keep('incoming', () => logs({ to: player.address })),
      keep('outgoing', async () => nameItems(await logs({ from: player.address }))),
    ]);
    return {
      player: player.address,
      verified: lastGood.verified,
      celo: lastGood.celo,
      g: lastGood.g,
      vault: { address: fork.contracts.vault, g: lastGood.vaultG },
      ledger: ledgerRows([...lastGood.incoming, ...lastGood.outgoing], { player: player.address, known }),
      advancedHours: advancedMs / 3600_000,
      syncing,
    };
  }

  const shortcuts = {
    /** One UTC midnight later, on the API's clock and the chain's, then the day's prizes and harvests become Spoils. */
    async nextDay() {
      const seconds = SKIP_HOURS * 3600;
      api.advance(seconds * 1000);
      await fork.rawRpc('evm_increaseTime', [seconds]);
      await fork.rawRpc('evm_mine', []);
      advancedMs += seconds * 1000;
      const settled = (await settle()).filter((day) => day.settled);
      if (!settled.length) {
        return { message: `Moved the clock forward ${SKIP_HOURS} hours. Nothing to settle: play a ranked Endless run (30 seconds or more) first, then skip again.` };
      }
      const prizes = settled.reduce((n, day) => n + (day.prizes ?? 0), 0);
      const harvests = settled.reduce((n, day) => n + (day.harvests ?? 0), 0);
      return { message: `Moved the clock forward ${SKIP_HOURS} hours and settled ${settled.length} day: ${prizes} daily prize(s) and ${harvests} Shard Harvest(s) became Spoils. Reload the game, open the G$ wallet and press REDEEM.` };
    },

    /** What beating chapter 1's boss records on the server, done through the API like the browser run does. */
    async bossClear() {
      if (!(await isVerified())) throw new Error('verify first: tap a play row in the game and pass the face scan');
      const { token } = await fork.login(player);
      const started = await api.call('POST', '/runs/start', { mode: 'STORY', chapter: 1 }, token);
      if (started.status !== 200) throw new Error(`the server refused to start a run (${started.body.error ?? started.status}); wait a few seconds and try again`);
      const run = started.body;
      api.advance(50_000);
      await api.call('POST', `/runs/${run.runId}/checkpoints`, {
        points: [10_000, 20_000, 30_000, 40_000, 50_000].map((t, i) => ({ t, score: 0, kills: (i + 1) * 2, shards: 0 })),
      }, token);
      api.advance(10_500);
      const done = await api.call('POST', `/runs/${run.runId}/submit`, { ticket: run.ticket, score: 0, kills: 12, shards: 0, durationMs: 60_000, bossCleared: true }, token);
      if (done.status !== 200 || !done.body.bossCleared) throw new Error(`the boss clear was not accepted (${done.body.error ?? JSON.stringify(done.body.flags)})`);
      return { message: 'Recorded a chapter-1 boss clear. Reload the game, open the G$ wallet and press CLAIM on the first-boss bounty.' };
    },

    async revoke() {
      if (!(await isVerified())) return { message: 'You are not verified at the moment.' };
      await fork.unwhitelist(player.address);
      forgetIdentity();
      return { message: 'Verification removed. Reload the game: the next play tap shows the gate again.' };
    },
  };

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const url = new URL(req.url, 'http://local');
    try {
      // Browsers attach Origin to cross-site requests: anything that is not a local page is turned away.
      if (origin && !LOCAL_ORIGIN.test(origin)) return send(res, 403, { error: 'forbidden origin' });
      if (origin) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'origin');
        res.setHeader('access-control-allow-headers', 'content-type');
        res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain');

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dev')) {
        const game = getGameUrl();
        return send(res, 200, controlPage({ gameUrl: game, statsUrl: new URL('stats.html', game).href }), 'text/html');
      }
      if (req.method === 'GET' && url.pathname === '/dev/state') return send(res, 200, await state());

      if (req.method === 'POST' && url.pathname === '/wallet') {
        const { method, params } = await readJson(req);
        try {
          return send(res, 200, { result: await provider.request({ method, params }) });
        } catch (err) {
          return send(res, 200, { error: { code: err.code ?? -32000, message: err.shortMessage || err.message } });
        }
      }

      if (req.method === 'GET' && url.pathname === '/face-scan') {
        const address = url.searchParams.get('address') ?? '';
        const callback = url.searchParams.get('callback') ?? '';
        let error = null;
        if (address.toLowerCase() !== player.address.toLowerCase()) error = 'This stand-in only verifies the local test player.';
        else if (!LOCAL_ORIGIN.test(new URL(callback, 'http://invalid').origin)) error = 'The return address is not a local page.';
        return send(res, error ? 400 : 200, facePage({ address, callback, error }), 'text/html');
      }
      if (req.method === 'POST' && url.pathname === '/face-scan/pass') {
        if (!(await isVerified())) await fork.whitelist(player.address);
        forgetIdentity();
        return send(res, 200, { ok: true });
      }

      const shortcut = { '/dev/next-day': 'nextDay', '/dev/boss-clear': 'bossClear', '/dev/revoke': 'revoke' }[url.pathname];
      if (req.method === 'POST' && shortcut) {
        if (shortcutRunning) return send(res, 409, { error: 'another shortcut is still running' });
        shortcutRunning = true;
        try {
          return send(res, 200, await shortcuts[shortcut]());
        } catch (err) {
          return send(res, 400, { error: err.shortMessage || err.message });
        } finally {
          shortcutRunning = false;
        }
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      return send(res, 500, { error: err.message });
    }
  });

  // A stable address for the G$ view across restarts, unless something else has that port.
  const listenOn = (port) => new Promise((resolve, reject) => {
    const onError = (err) => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
  try {
    await listenOn(PREFERRED_PORT);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    await listenOn(0);
  }
  const urlOfHelper = `http://127.0.0.1:${server.address().port}`;
  return { url: urlOfHelper, close: () => new Promise((resolve) => server.close(resolve)) };
}
