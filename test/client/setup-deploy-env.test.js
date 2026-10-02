import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { setupDeployEnv } from '../../scripts/setup-deploy-env.mjs';

/*
 * `npm run setup:deploy` makes the two settings files a deployment needs, ready to use: contracts/.env (the owner pastes
 * their wallet's key there and nothing else is required) and server/.env.production (the deployed API's settings). It makes
 * the server's two signing keys and its session secret itself, writes each key straight into the server's file and its
 * address into contracts/.env, and never prints a secret or replaces a value that is already there.
 */

const TEMPLATE = fs.readFileSync(new URL('../../contracts/.env.example', import.meta.url), 'utf8');
const value = (text, key) => (text.match(new RegExp(`^${key}=(.*)$`, 'm')) ?? [])[1];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moonshard-setup-'));
  fs.mkdirSync(path.join(root, 'contracts'));
  fs.mkdirSync(path.join(root, 'server'));
  fs.writeFileSync(path.join(root, 'contracts', '.env.example'), TEMPLATE);
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  return { root, read };
}

test('it makes both files, with each signer key in the server file and its address in contracts/.env', () => {
  const { root, read } = fixture();
  const out = setupDeployEnv({ root });
  const contracts = read('contracts/.env');
  const server = read('server/.env.production');

  const voucherKey = value(server, 'VOUCHER_SIGNER_KEY');
  const appKey = value(server, 'APP_SIGNER_KEY');
  assert.match(voucherKey, /^0x[0-9a-f]{64}$/);
  assert.match(appKey, /^0x[0-9a-f]{64}$/);
  assert.notEqual(voucherKey, appKey, 'two different keys');
  assert.equal(value(contracts, 'VOUCHER_SIGNER'), privateKeyToAccount(voucherKey).address);
  assert.equal(value(contracts, 'APP_SIGNER'), privateKeyToAccount(appKey).address);
  assert.ok(value(server, 'JWT_SECRET').length >= 32, 'a session secret the API accepts');
  assert.equal(value(server, 'NODE_ENV'), 'production');
  assert.equal(value(server, 'PRIZES_ENABLED'), 'false', 'no prizes until the game has players (owner decision)');

  assert.equal(value(contracts, 'DEPLOYER_PRIVATE_KEY'), '', 'the wallet key is the one thing left for the owner');
  assert.doesNotMatch(contracts, /TEMPLATE/, 'the real file does not call itself the template');
  assert.match(contracts, /git ignores/i);

  const printed = out.join('\n');
  for (const secret of [voucherKey, appKey, value(server, 'JWT_SECRET')]) assert.ok(!printed.includes(secret), 'no secret is printed');
  assert.ok(printed.includes(privateKeyToAccount(voucherKey).address), 'the addresses are printed');
});

test('both files can be read by their owner only, including files that existed before with looser permissions', () => {
  const { root } = fixture();
  const mode = (file) => fs.statSync(path.join(root, file)).mode & 0o777;
  setupDeployEnv({ root });
  assert.equal(mode('contracts/.env'), 0o600);
  assert.equal(mode('server/.env.production'), 0o600);
  fs.chmodSync(path.join(root, 'contracts/.env'), 0o644);
  fs.chmodSync(path.join(root, 'server/.env.production'), 0o644);
  setupDeployEnv({ root }); // nothing to fill in: the permissions are tightened all the same
  assert.equal(mode('contracts/.env'), 0o600);
  assert.equal(mode('server/.env.production'), 0o600);
});

test('running it again changes nothing: keys and settings already there are kept', () => {
  const { root, read } = fixture();
  setupDeployEnv({ root });
  fs.writeFileSync(path.join(root, 'contracts/.env'), read('contracts/.env').replace(/^DEPLOYER_PRIVATE_KEY=.*$/m, 'DEPLOYER_PRIVATE_KEY=abc'));
  const before = { contracts: read('contracts/.env'), server: read('server/.env.production') };
  setupDeployEnv({ root });
  assert.equal(read('contracts/.env'), before.contracts);
  assert.equal(read('server/.env.production'), before.server);
});

test('an address with no key behind it in the server file is not replaced, and the mismatch is said out loud', () => {
  const { root, read } = fixture();
  setupDeployEnv({ root });
  const server = read('server/.env.production');
  fs.writeFileSync(path.join(root, 'server/.env.production'), server.replace(/^VOUCHER_SIGNER_KEY=.*$/m, 'VOUCHER_SIGNER_KEY='));
  const kept = value(read('contracts/.env'), 'VOUCHER_SIGNER');
  const out = setupDeployEnv({ root }).join('\n');
  assert.equal(value(read('contracts/.env'), 'VOUCHER_SIGNER'), kept, 'the address in use is not replaced');
  assert.equal(value(read('server/.env.production'), 'VOUCHER_SIGNER_KEY'), '', 'and no unrelated key is made for it');
  assert.match(out, /VOUCHER_SIGNER/);
  assert.match(out, /no key/i);
});

test('a server file made before the prize switch gets PRIZES_ENABLED=false added, and nothing else changes', () => {
  const { root, read } = fixture();
  setupDeployEnv({ root });
  const older = read('server/.env.production').replace(/^PRIZES_ENABLED=.*\n/m, '');
  fs.writeFileSync(path.join(root, 'server/.env.production'), older);
  setupDeployEnv({ root });
  const now = read('server/.env.production');
  assert.equal(value(now, 'PRIZES_ENABLED'), 'false');
  assert.equal(now.replace(/^PRIZES_ENABLED=.*\n/m, ''), older, 'every other line is kept as it was');
});

test('a PRIZES_ENABLED the owner set is kept', () => {
  const { root, read } = fixture();
  setupDeployEnv({ root });
  fs.writeFileSync(path.join(root, 'server/.env.production'), read('server/.env.production').replace(/^PRIZES_ENABLED=.*$/m, 'PRIZES_ENABLED=true'));
  setupDeployEnv({ root });
  assert.equal(value(read('server/.env.production'), 'PRIZES_ENABLED'), 'true');
});
