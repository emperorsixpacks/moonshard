// Play Moonshard on your computer against the REAL Celo network: your own wallet (MetaMask, Rabby, ...), GoodDollar's real
// face verification, real G$, and your deployed MoonshardVault. Nothing is simulated, so whatever you pay is real: the gas of
// a claim, and 20 G$ for the blade (which goes into your own vault). For a session with a test wallet and a stand-in face
// scan on a copy of Celo, use `npm run dev:local` instead.
//   npm run dev:celo                      (the vault in server/.env.production)
//   npm run dev:celo -- --vault 0x...     (another vault)
//   --port <n> picks the game's port (5318 by default), --no-open does not open the browser. Ctrl-C stops it.
// The API runs here too, in development mode with an in-memory database and prizes off, and it holds no production key:
// it signs nothing a real vault would honour (no vouchers), and its session secret is made fresh for each run.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { createServer } from 'vite';
import { freePort } from './fork/ports.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argValue = (name) => { const i = process.argv.indexOf(name); return i === -1 ? undefined : process.argv[i + 1]; };
const log = (...a) => console.log(...a);

function vaultAddress() {
  const fromArg = argValue('--vault');
  if (fromArg !== undefined) return fromArg;
  try {
    const text = fs.readFileSync(path.join(ROOT, 'server', '.env.production'), 'utf8');
    return (text.match(/^VAULT_ADDRESS=(.*)$/m) ?? [])[1]?.trim() || undefined; // only this line is read from the file
  } catch {
    return undefined;
  }
}

/** The preferred port when it is free, else any free one. */
async function portFrom(preferred) {
  const free = await new Promise((resolve) => {
    const s = createNetServer().once('error', () => resolve(false)).listen(preferred, '127.0.0.1', () => s.close(() => resolve(true)));
  });
  return free ? preferred : freePort();
}

const vault = vaultAddress();
if (!/^0x[0-9a-fA-F]{40}$/.test(String(vault))) {
  console.error('No vault to play against: deploy it first (docs/DEPLOY.md), so that server/.env.production has VAULT_ADDRESS, or pass --vault 0x...');
  process.exit(1);
}

const stops = [];
const stop = async (code = 0) => {
  for (const fn of stops.reverse()) await Promise.resolve().then(fn).catch(() => {});
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

try {
  // ---- the API, on Celo itself ------------------------------------------------------------------------------------------
  const apiPort = await freePort();
  const api = spawn(process.execPath, ['index.js'], {
    cwd: path.join(ROOT, 'server'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // set explicitly, so server/.env (the local development settings) cannot fill them in
      PORT: String(apiPort),
      NODE_ENV: 'development',
      JWT_SECRET: crypto.randomBytes(32).toString('base64'),
      DATABASE_URL: '',
      DATABASE_CA: '',
      CORS_ORIGINS: '',
      CELO_RPC_URL: 'https://forno.celo.org',
      CHAIN_ID: '42220',
      VAULT_ADDRESS: vault,
      VOUCHER_SIGNER_KEY: '',
      APP_SIGNER_KEY: '',
      PRIZES_ENABLED: 'false',
      TRUST_PROXY: '1',
    },
  });
  stops.push(() => api.kill());
  let apiLog = '';
  api.stdout.on('data', (d) => { apiLog += d; });
  api.stderr.on('data', (d) => { apiLog += d; });
  for (let i = 0; ; i++) {
    const up = await fetch(`http://127.0.0.1:${apiPort}/health`).then((r) => r.ok, () => false);
    if (up) break;
    if (i > 60 || api.exitCode !== null) throw new Error(`the API did not start:\n${apiLog.slice(-1500)}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  // ---- the game, served with /api passed through to that API (one address for both) -------------------------------------
  process.env.VITE_API_URL = '';
  process.env.VITE_CELO_RPC_URL = 'https://forno.celo.org';
  process.env.VITE_GD_ENV = 'production';
  process.env.VITE_VAULT_ADDRESS = vault;
  const webPort = await portFrom(Number(argValue('--port')) || 5318);
  const vite = await createServer({
    root: ROOT,
    logLevel: 'warn',
    server: { port: webPort, strictPort: true, open: false, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } } },
  });
  await vite.listen();
  stops.push(() => vite.close());
  const game = `http://localhost:${webPort}/`;

  log(`
================================================================================
 MOONSHARD ON THE REAL CELO NETWORK   (your wallet, GoodDollar's face scan, real G$)
--------------------------------------------------------------------------------
 Game     ${game}
 Stats    ${game}stats.html
 Vault    ${vault}   (deployed on Celo: https://celoscan.io/address/${vault})

 Everything is real here: connecting uses your wallet extension, "Verify (face scan)" is
 GoodDollar's, the daily claim pays real G$, and buying the blade sends 20 G$ to your vault.
 Prizes are off. The first-boss bounty needs the app registered with GoodDollar first.
 Ctrl-C stops it.
================================================================================`);
  log(`DEV_CELO_READY ${JSON.stringify({ game, api: `http://127.0.0.1:${apiPort}`, vault })}`);
  if (!process.argv.includes('--no-open')) spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [game], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
} catch (err) {
  console.error(`\n${err?.message || err}`);
  await stop(1);
}
