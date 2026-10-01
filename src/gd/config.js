const env = import.meta.env ?? {};

export const GD = {
  apiUrl: env.VITE_API_URL || '',
  chainId: 42220,
  rpcUrl: env.VITE_CELO_RPC_URL || 'https://forno.celo.org',
  env: env.VITE_GD_ENV || 'production',
  reownProjectId: env.VITE_REOWN_PROJECT_ID || '',
};

/** Mirror server GAME.SHARD_RATE / daily cap in G$; `/api/config` is authoritative at runtime. */
export const SHARD_RATE_GD = 2;
export const DAILY_SHARD_CAP_GD = 100;

export const explorerTx = (hash) => `https://celoscan.io/tx/${hash}`;
