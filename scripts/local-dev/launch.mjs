// Run Moonshard locally with every G$ flow working and the face scan passing on a click, for trying the game by hand.
//   npm run dev:local              (add --no-open to keep it from opening your browser)
//
// What it starts, all on free ports and all thrown away when you stop it (Ctrl-C):
//   - a local copy ("fork") of Celo mainnet, with GoodDollar's real Identity, UBI and Engagement Rewards contracts;
//   - MoonshardVault deployed on it and funded, the Engagement app registered and approved, and the API running on it;
//   - the game's dev server, with a built-in test wallet and a stand-in for GoodDollar's face-scan page (plugin.mjs).
// The game's source is untouched: a normal `npm run dev` or build has none of this. Nothing here touches the real chain.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { parseAbi } from 'viem';
import { createServer } from 'vite';
import { ADDR, bootFork } from '../fork/lib.mjs';
import { settleDue } from '../../server/src/spoils.js';
import { startHelper } from './helper.mjs';
import { localDevPlugin } from './plugin.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const open = !process.argv.includes('--no-open');
const log = (...a) => console.log(...a);

function openInBrowser(url) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

function checkTools() {
  if (spawnSync('anvil', ['--version'], { stdio: 'ignore' }).error) {
    throw new Error('anvil (Foundry) is not installed or not on your PATH. Install Foundry: https://getfoundry.sh');
  }
  if (!existsSync(`${ROOT}contracts/out/MoonshardVault.sol/MoonshardVault.json`)) {
    log('Building the vault contract (first run only)...');
    const built = spawnSync('forge', ['build'], { cwd: `${ROOT}contracts`, stdio: 'inherit' });
    if (built.status !== 0) throw new Error('forge build failed; see above. If the libraries are missing, see the README.');
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The fork copies the live chain the first time something touches it, and a copy can time out. The test player starts
 * unverified, so nothing has touched its accounts yet: read what the game reads first, retrying, so the first tap is quick.
 */
async function warmUp(fork) {
  const player = fork.accounts.player.address;
  const read = (address, abi, functionName) => () => fork.pub.readContract({ address, abi, functionName, args: [player] });
  const reads = [
    read(ADDR.identity, parseAbi(['function getWhitelistedRoot(address) view returns (address)']), 'getWhitelistedRoot'),
    read(ADDR.token, parseAbi(['function balanceOf(address) view returns (uint256)']), 'balanceOf'),
    read(ADDR.ubi, parseAbi(['function checkEntitlement(address) view returns (uint256)']), 'checkEntitlement'),
  ];
  for (const attempt of reads) {
    for (let i = 0; i < 6; i += 1) {
      try {
        await attempt();
        break;
      } catch (err) {
        if (!/timed out|failed to get|fetch failed|ECONN/i.test(err.message)) break; // anything else is the chain answering
        await sleep(1500);
      }
    }
  }
}

const started = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  log('\nStopping and throwing the local chain away...');
  for (const close of started.reverse()) await close().catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

try {
  checkTools();

  log('Copying Celo mainnet to a local fork (needs internet; the first minute is the slowest)...');
  // patient with the live chain: a slow copy of one account should be retried, not fail the session
  const fork = await bootFork({ apiPort: 0, whitelistPlayer: false, anvilArgs: ['--retries', '8', '--timeout', '60000'] });
  started.push(() => fork.shutdown());
  log('  vault deployed and funded, Engagement app registered, API running. Warming up...');
  await warmUp(fork);
  const startBlock = await fork.pub.getBlockNumber();

  let gameUrl = '';
  const helper = await startHelper({
    fork,
    startBlock,
    settle: () => settleDue(fork.api.ctx),
    getGameUrl: () => gameUrl,
  });
  started.push(() => helper.close());

  // the page reads these at build time, so they must be set before the dev server starts
  process.env.VITE_API_URL = fork.api.url;
  process.env.VITE_CELO_RPC_URL = fork.rpc;
  process.env.VITE_GD_ENV = 'production';
  process.env.VITE_VAULT_ADDRESS = fork.contracts.vault;
  log('Starting the game...');
  const vite = await createServer({
    root: ROOT,
    logLevel: 'warn',
    plugins: [localDevPlugin({ root: ROOT, getHelperUrl: () => helper.url, address: fork.accounts.player.address, sessionId: randomUUID() })],
    server: { port: 5173, strictPort: false, open: false },
  });
  await vite.listen();
  started.push(() => vite.close());
  gameUrl = vite.resolvedUrls.local[0];

  const dev = `${helper.url}/dev`;
  log(`
================================================================================
 MOONSHARD, LOCAL TEST SESSION   (nothing here touches the real chain)
--------------------------------------------------------------------------------
 Game          ${gameUrl}
 G$ view       ${dev}     <- your G$ in and out, shortcuts, a guide to where G$ appears
 Stats page    ${new URL('stats.html', gameUrl).href}

 Test player   ${fork.accounts.player.address}   (starts NOT verified)
 Vault         ${fork.contracts.vault}   (funded with 20,000 G$)

 Try it: tap ENDLESS MODE, connect, "Verify (face scan)", click "Pass the face scan", PLAY.
 The face scan is a stand-in that exists only in this session. Press Ctrl-C to stop; everything resets.
================================================================================`);
  log(`LOCAL_DEV_READY ${JSON.stringify({ game: gameUrl, dev, api: fork.api.url, rpc: fork.rpc, player: fork.accounts.player.address, vault: fork.contracts.vault })}`);

  if (open) {
    openInBrowser(gameUrl);
    setTimeout(() => openInBrowser(dev), 1500);
  }
} catch (err) {
  console.error(`\nCould not start the local test session: ${err.message}`);
  await stop(1);
}
