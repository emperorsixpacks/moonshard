import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import {
  createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, parseAbi, parseUnits, toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { freePort } from './ports.mjs';
import { createDb } from '../../server/src/db.js';
import { createChain } from '../../server/src/chain.js';
import { createApp } from '../../server/src/app.js';
import { loginMessage } from '../../server/src/auth.js';

// A cold fork fetches state from the live Celo RPC on first touch, which can exceed viem's 10 s default.
// No retries: a retried eth_sendTransaction on a slow fork could be mined twice.
export const forkTransport = (url) => http(url, { timeout: 180_000, retryCount: 0 });

/**
 * A minimal EIP-1193 wallet backed by a real private key, standing in for a browser wallet such as MetaMask on the fork.
 * The GoodDollar SDKs pass the account to viem as a plain address, so viem sends signing and sending requests to
 * the provider (exactly as it would to a browser wallet); a node cannot sign for an address it holds no key for.
 */
export function localWalletProvider(rpc, account, pub) {
  const sender = createWalletClient({ account, chain: celo, transport: forkTransport(rpc) });
  return {
    async request({ method, params = [] }) {
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [account.address];
        case 'personal_sign':
          return account.signMessage({ message: { raw: params[0] } });
        case 'eth_signTypedData_v4': {
          const typed = JSON.parse(params[1]);
          delete typed.types.EIP712Domain; // viem derives the domain type itself
          return account.signTypedData({ domain: typed.domain, types: typed.types, primaryType: typed.primaryType, message: typed.message });
        }
        case 'eth_sendTransaction': {
          const tx = params[0];
          return sender.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          });
        }
        default:
          return pub.request({ method, params });
      }
    },
  };
}

export const ADDR = {
  identity: '0xC361A6E67822a0EDc17D899227dd9FC50BD62F42',
  ubi: '0x43d72Ff17701B2DA814620735C39C620Ce0ea4A1',
  token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A',
  engagement: '0x25db74CF4E7BA120526fd87e159CF656d94bAE43',
  avatar: '0x495d133B938596C9984d462F007B676bDc57eCEC',
};

const erc20 = parseAbi(['function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const identityAbi = parseAbi(['function addWhitelisted(address)']);
const engagementAbi = parseAbi([
  'function applyApp(address app,address rewardReceiver,uint8 userAndInviterPercentage,uint8 userPercentage,string description,string url,string email)',
  'function approve(address app)',
]);

// ERC-7201 storage location of AccessControlUpgradeable (OpenZeppelin upgradeable v5)
const ACCESS_CONTROL_LOCATION = '0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b626800';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function bootFork({ upstream = process.env.CELO_UPSTREAM_RPC || 'https://forno.celo.org', port, apiPort = 0 } = {}) {
  port = port ?? (await freePort());
  const rpc = `http://127.0.0.1:${port}`;
  const anvil = spawn('anvil', ['--fork-url', upstream, '--port', String(port), '--chain-id', '42220', '--silent'], { stdio: 'ignore' });
  process.on('exit', () => anvil.kill()); // never leave a fork running, even if the run crashes
  const pub = createPublicClient({ chain: celo, transport: forkTransport(rpc) });
  for (let i = 0; i < 60; i++) {
    try { if ((await pub.getBlockNumber()) > 0n) break; } catch { /* anvil still starting */ }
    await sleep(500);
  }
  const rawRpc = (method, params = []) => pub.request({ method, params });
  const as = (address) => createWalletClient({ account: address, chain: celo, transport: forkTransport(rpc) });
  const local = (account) => createWalletClient({ account, chain: celo, transport: forkTransport(rpc) });
  const fundCelo = (address, amount = '100') => rawRpc('anvil_setBalance', [address, toHex(parseUnits(amount, 18))]);

  const pk = {
    player: generatePrivateKey(),
    owner: generatePrivateKey(),
    appSigner: generatePrivateKey(),
    voucherSigner: generatePrivateKey(),
  };
  const accounts = Object.fromEntries(Object.entries(pk).map(([name, key]) => [name, privateKeyToAccount(key)]));
  for (const a of Object.values(accounts)) await fundCelo(a.address);

  async function impersonate(address) {
    await fundCelo(address);
    await rawRpc('anvil_impersonateAccount', [address]);
    return as(address);
  }

  async function fundG(to, amountWei) {
    const pool = await impersonate(ADDR.engagement); // the Engagement pool holds ~47M G$
    const hash = await pool.writeContract({ address: ADDR.token, abi: erc20, functionName: 'transfer', args: [to, amountWei] });
    await pub.waitForTransactionReceipt({ hash });
  }

  async function whitelist(address) {
    const avatar = await impersonate(ADDR.avatar);
    const hash = await avatar.writeContract({ address: ADDR.identity, abi: identityAbi, functionName: 'addWhitelisted', args: [address] });
    await pub.waitForTransactionReceipt({ hash });
  }

  async function grantEngagementAdmin(address) {
    const role = keccak256(toHex('ADMIN_ROLE'));
    const roleData = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [role, ACCESS_CONTROL_LOCATION]));
    const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [address, roleData]));
    await rawRpc('anvil_setStorageAt', [ADDR.engagement, slot, `0x${'00'.repeat(31)}01`]);
  }

  async function registerApp() {
    const owner = local(accounts.owner);
    let hash = await owner.writeContract({
      address: ADDR.engagement, abi: engagementAbi, functionName: 'applyApp',
      args: [accounts.appSigner.address, accounts.owner.address, 80, 60,
        'Moonshard: a pixel action-platformer that rewards verified GoodDollar citizens every day.',
        'https://moonshard.example', 'ops@moonshard.example'],
    });
    await pub.waitForTransactionReceipt({ hash });
    await grantEngagementAdmin(accounts.owner.address);
    hash = await owner.writeContract({ address: ADDR.engagement, abi: engagementAbi, functionName: 'approve', args: [accounts.appSigner.address] });
    await pub.waitForTransactionReceipt({ hash });
  }

  async function deployVault() {
    let artifact;
    try {
      artifact = JSON.parse(await readFile(new URL('../../contracts/out/MoonshardVault.sol/MoonshardVault.json', import.meta.url), 'utf8'));
    } catch {
      throw new Error('Missing contract artifact. Run: (cd contracts && forge build)');
    }
    const hash = await local(accounts.owner).deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [ADDR.token, accounts.voucherSigner.address, accounts.owner.address, parseUnits('1000', 18), parseUnits('5000', 18)],
    });
    const { contractAddress } = await pub.waitForTransactionReceipt({ hash });
    return contractAddress;
  }

  await whitelist(accounts.player.address);
  await registerApp();
  const vault = await deployVault();
  await fundG(vault, parseUnits('20000', 18));

  // API in-process, on a virtual clock the scripts can advance (settlement waits for UTC midnight).
  let offset = 0;
  const now = () => Date.now() + offset;
  const config = {
    port: apiPort, jwtSecret: 'fork-e2e-secret', corsOrigins: '*', databaseUrl: '', rpcUrl: rpc, chainId: 42220,
    contracts: { identity: ADDR.identity, ubi: ADDR.ubi, token: ADDR.token, engagement: ADDR.engagement, vault },
    voucherSignerKey: pk.voucherSigner,
    appSignerKey: pk.appSigner,
  };
  const db = await createDb('');
  const chain = createChain(config);
  const { app, ctx } = createApp({ db, chain, config, now });
  const server = await new Promise((resolve) => { const s = createServer(app).listen(apiPort, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, token) {
    const res = await fetch(`${url}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }

  async function login(account, host = 'browser') {
    const n = await call('GET', '/auth/nonce');
    const message = loginMessage(n.body.nonce, n.body.issuedAt);
    const signature = await account.signMessage({ message });
    const r = await call('POST', '/auth/verify', { address: account.address, message, signature, host });
    if (r.status !== 200) throw new Error(`login failed ${JSON.stringify(r.body)}`);
    return r.body;
  }

  return {
    rpc, pub, as, local, accounts, rawRpc, fundCelo, fundG, whitelist,
    contracts: { ...ADDR, vault },
    api: { url, ctx, call, advance: (ms) => { offset += ms; } },
    login, grantEngagementAdmin,
    async shutdown() {
      await new Promise((r) => server.close(r));
      await db.close();
      anvil.kill();
    },
  };
}
