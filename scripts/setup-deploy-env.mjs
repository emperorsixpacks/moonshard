import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

/**
 * `npm run setup:deploy`: makes the two settings files a deployment needs, ready to use (docs/DEPLOY.md).
 *   contracts/.env          the deploy settings. The owner pastes their wallet's private key there; nothing else is required.
 *   server/.env.production  the deployed API's settings, pasted into the host's variables (Railway) later.
 * The server's two signing keys and its session secret are made here and written straight into server/.env.production, and
 * the two signers' addresses into contracts/.env. Git ignores both files. No secret is printed, and a value that is already
 * there is never replaced, so running it again is harmless. Both files are made readable by their owner only.
 */

const CONTRACTS_HEADER = `# YOUR deploy settings. Git ignores this file: it never leaves your computer and is not pushed to GitHub.
# Foundry reads it by itself when you run \`forge script\` in this folder. Made by \`npm run setup:deploy\`.`;

const SERVER_TEMPLATE = `# The deployed API's settings (production). Git ignores this file: it never leaves your computer.
# When you set up the API on Railway, open its Variables tab, choose "Raw Editor" and paste these lines.
# Never use these keys for a local test (the server on your computer reads server/.env, not this file).
# Made by \`npm run setup:deploy\`: the two keys and the session secret were generated on this computer.
NODE_ENV=production
JWT_SECRET=
VOUCHER_SIGNER_KEY=
APP_SIGNER_KEY=
# Filled in while deploying (docs/DEPLOY.md): VAULT_ADDRESS is printed by the vault's deploy, DATABASE_URL comes from
# the host's Postgres (with ?sslmode=require), CORS_ORIGINS is the website's address once it is live (https://...).
VAULT_ADDRESS=
DATABASE_URL=
CORS_ORIGINS=
CELO_RPC_URL=https://forno.celo.org
CHAIN_ID=42220
TRUST_PROXY=1
`;

const SIGNERS = [
  { address: 'VOUCHER_SIGNER', key: 'VOUCHER_SIGNER_KEY', name: 'Voucher signer' },
  { address: 'APP_SIGNER', key: 'APP_SIGNER_KEY', name: 'App signer' },
];

const lineOf = (key) => new RegExp(`^${key}=(.*)$`, 'm');
const get = (text, key) => (text.match(lineOf(key)) ?? [])[1]?.trim() ?? '';
/** Sets KEY=value, on its own line if the file has one, at the end if not. */
const set = (text, key, value) => (lineOf(key).test(text)
  ? text.replace(lineOf(key), () => `${key}=${value}`)
  : `${text.replace(/\n*$/, '\n')}${key}=${value}\n`);

/** Readable and writable by the file's owner only: these files hold private keys. */
const OWNER_ONLY = 0o600;

/** The template turned into the real file: its header says it is the template, which the copy is not. */
const fromTemplate = (template) => `${CONTRACTS_HEADER}${template.slice(template.indexOf('\n\n'))}`;

/** @returns {string[]} what to tell the owner (never a secret) */
export function setupDeployEnv({ root, newKey = generatePrivateKey, newSecret = () => crypto.randomBytes(32).toString('base64') }) {
  const contractsPath = path.join(root, 'contracts', '.env');
  const serverPath = path.join(root, 'server', '.env.production');
  const contractsExisted = fs.existsSync(contractsPath);
  const serverExisted = fs.existsSync(serverPath);
  const contractsBefore = contractsExisted
    ? fs.readFileSync(contractsPath, 'utf8')
    : fromTemplate(fs.readFileSync(path.join(root, 'contracts', '.env.example'), 'utf8'));
  const serverBefore = serverExisted ? fs.readFileSync(serverPath, 'utf8') : SERVER_TEMPLATE;
  let contracts = contractsBefore;
  let server = serverBefore;
  const out = [];
  const addresses = [];

  for (const signer of SIGNERS) {
    const address = get(contracts, signer.address);
    let key = get(server, signer.key);
    if (!key && !address) {
      key = newKey();
      server = set(server, signer.key, key);
    }
    if (!key) {
      out.push(`! ${signer.address} in contracts/.env is ${address}, but server/.env.production has no key for it (${signer.key}). Put that address's private key there, or empty ${signer.address} and run this again to make a new pair.`);
      continue;
    }
    const derived = privateKeyToAccount(key).address;
    if (!address) contracts = set(contracts, signer.address, derived);
    else if (address.toLowerCase() !== derived.toLowerCase()) {
      out.push(`! ${signer.address} in contracts/.env (${address}) is not the address of ${signer.key} in server/.env.production (${derived}). They must match: fix one of them.`);
    }
    addresses.push(`  ${signer.name} address: ${get(contracts, signer.address)}`);
  }
  if (!get(server, 'JWT_SECRET')) server = set(server, 'JWT_SECRET', newSecret());

  if (contracts !== contractsBefore || !contractsExisted) fs.writeFileSync(contractsPath, contracts, { mode: OWNER_ONLY });
  if (server !== serverBefore || !serverExisted) fs.writeFileSync(serverPath, server, { mode: OWNER_ONLY });
  // `mode` applies only when a file is created: tighten files that were already there too (or were made by an older run)
  fs.chmodSync(contractsPath, OWNER_ONLY);
  fs.chmodSync(serverPath, OWNER_ONLY);

  const deployerKey = get(contracts, 'DEPLOYER_PRIVATE_KEY');
  return [
    contractsExisted ? 'contracts/.env: already there, kept (empty settings filled in).' : 'contracts/.env: created.',
    serverExisted
      ? 'server/.env.production: already there, kept (empty settings filled in).'
      : "server/.env.production: created, with the server's two keys and its session secret (you paste it into Railway later).",
    ...addresses,
    deployerKey
      ? 'Your wallet key is in contracts/.env already.'
      : "Next: open contracts/.env and paste your wallet's private key after DEPLOYER_PRIVATE_KEY= (nothing else is required).",
    'Git ignores both files: they never go to GitHub.',
    ...out,
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const line of setupDeployEnv({ root })) console.log(line);
}
