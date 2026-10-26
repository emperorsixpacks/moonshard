const env = import.meta.env ?? {};

export const GD = {
  apiUrl: env.VITE_API_URL || '',
  chainId: 42220,
  rpcUrl: env.VITE_CELO_RPC_URL || 'https://forno.celo.org',
  env: env.VITE_GD_ENV || 'production',
  reownProjectId: env.VITE_REOWN_PROJECT_ID || '',
  // Magic (magic.link) publishable key: when set, a player can sign in with an email and get a wallet, no extension needed.
  magicKey: env.VITE_MAGIC_PUBLISHABLE_KEY || '',
  // Optional pin: when set, the app refuses to redeem from, or pay into, any other vault address than this one.
  vault: env.VITE_VAULT_ADDRESS || '',
  // Optional: the address invite links point at (https://playmoonshard.xyz), when it should not be the page the player is on.
  publicUrl: env.VITE_PUBLIC_URL || '',
  // The G$ token on Celo. Moon Shop payments are made on this token only, whatever a server answer says.
  token: '0x62B8B11039FcfE5aB0C56E502b1C372A3d2a9c7A',
};

/** Mirror server GAME.SHARD_RATE / daily cap in G$; `/api/config` is authoritative at runtime. */
export const SHARD_RATE_GD = 2;
export const DAILY_SHARD_CAP_GD = 100;

export const explorerTx = (hash) => `https://celoscan.io/tx/${hash}`;
export const explorerAddress = (address) => `https://celoscan.io/address/${address}`;
