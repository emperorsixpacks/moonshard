import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { GAME } from "../config.js";

export const MIN_JWT_SECRET_LENGTH = 32;

const HOW_TO_FIX = "Generate one with: openssl rand -base64 32";

/**
 * Throws unless the configuration is safe to serve real traffic with. Called once at boot (index.js),
 * not from createApp, so tests can build apps with throwaway secrets.
 *
 * JWT_SECRET signs sessions and run tickets, so a guessable one lets anyone forge both. The value
 * shipped in .env.example is a 32-character placeholder, so length alone would not catch a verbatim copy.
 * @param {{jwtSecret?: string}} config
 */
export function assertSecureConfig(config) {
  const secret = typeof config?.jwtSecret === "string" ? config.jwtSecret : "";
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set to a random value of at least ${MIN_JWT_SECRET_LENGTH} characters (it signs sessions and run tickets). ${HOW_TO_FIX}`,
    );
  }
  if (/change_me/i.test(secret)) {
    throw new Error(`JWT_SECRET is still the placeholder from .env.example. ${HOW_TO_FIX}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Vault caps vs. the prizes this server signs
// ---------------------------------------------------------------------------------------------------------------

const vaultCapsAbi = parseAbi([
  "function maxPerVoucher() view returns (uint256)",
  "function dailyCap() view returns (uint256)",
]);

/** How long the boot-time read of the caps may take. Boot never waits for it; this only bounds a hung endpoint. */
export const VAULT_CAPS_TIMEOUT_MS = 8_000;

const G = (wei) => formatUnits(wei, 18);

/** The vault reads over JSON-RPC at `config.rpcUrl`: one attempt, so a dead endpoint fails fast. */
function defaultVaultReader(config) {
  const client = createPublicClient({ transport: http(config.rpcUrl, { timeout: VAULT_CAPS_TIMEOUT_MS, retryCount: 0 }) });
  return ({ address, functionName }) => client.readContract({ address, abi: vaultCapsAbi, functionName });
}

/**
 * Compares the vault's on-chain caps with the vouchers this server will sign, and warns loudly when a voucher
 * could never be redeemed: the vault reverts any voucher above `maxPerVoucher` (OverVoucherCap) and any day's
 * claims above `dailyCap` (OverDailyCap), while the server signs the prizes and shows them to the winners anyway.
 *
 * Never throws and is not meant to be awaited by boot: with no vault configured, or an RPC that is down or slow,
 * it returns `{ checked: false, reason }` after saying so.
 *
 * @param {{ config: any, prizes?: bigint[], read?: Function, log?: Console, timeoutMs?: number }} opts
 *   `read({ address, functionName })` resolves to the uint256 (injectable for tests).
 */
export async function checkVaultCaps({ config, prizes = GAME.PRIZES, read, log = console, timeoutMs = VAULT_CAPS_TIMEOUT_MS }) {
  const vault = config?.contracts?.vault;
  if (!vault) return { checked: false, reason: "no_vault" };

  let maxPerVoucher;
  let dailyCap;
  try {
    const reader = read ?? defaultVaultReader(config);
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs); });
    try {
      [maxPerVoucher, dailyCap] = await Promise.race([
        Promise.all([reader({ address: vault, functionName: "maxPerVoucher" }), reader({ address: vault, functionName: "dailyCap" })]),
        timeout,
      ]);
    } finally { clearTimeout(timer); }
  } catch (err) {
    log.warn(`[moonshard] could not read the vault caps from ${vault} (${err?.shortMessage || err?.message || err}); skipping the check of the prizes against them`);
    return { checked: false, reason: "rpc_error" };
  }

  const harvest = BigInt(GAME.DAILY_SHARD_CAP) * GAME.SHARD_RATE; // the largest shard-harvest voucher a player can earn
  const prizeTotal = prizes.reduce((sum, p) => sum + p, 0n);
  const largest = prizes.reduce((m, p) => (p > m ? p : m), harvest);
  const problems = [];

  if (largest > maxPerVoucher) {
    const what = largest === harvest && !prizes.includes(harvest) ? "the shard harvest" : "the top daily prize";
    problems.push({
      code: "max_per_voucher",
      message:
        `[moonshard] WARNING: ${what} is ${G(largest)} G$ but the vault's maxPerVoucher is ${G(maxPerVoucher)} G$. ` +
        "Vouchers above the cap revert on-chain (OverVoucherCap), so those winners can never be paid. " +
        `Raise it with the owner's setCaps(newMaxPerVoucher, newDailyCap) on ${vault}.`,
    });
  }
  if (prizeTotal > dailyCap) {
    problems.push({
      code: "daily_cap",
      message:
        `[moonshard] WARNING: one day's prizes add up to ${G(prizeTotal)} G$ but the vault's dailyCap is ${G(dailyCap)} G$. ` +
        "Claims past the cap revert on-chain (OverDailyCap) until the next UTC day. " +
        `dailyCap must be at least ${G(prizeTotal)} + ${G(harvest)} x the verified players you expect to harvest on one day ` +
        `(prizes + shard harvests); raise it with the owner's setCaps(newMaxPerVoucher, newDailyCap) on ${vault}.`,
    });
  }
  for (const problem of problems) log.warn(problem.message);

  if (problems.length === 0) {
    const room = harvest > 0n ? (dailyCap - prizeTotal) / harvest : 0n;
    log.info(
      `[moonshard] vault caps ok: maxPerVoucher ${G(maxPerVoucher)} G$, dailyCap ${G(dailyCap)} G$ ` +
      `(room for ${G(prizeTotal)} G$ of prizes and ${room} full shard harvest${room === 1n ? "" : "s"} per UTC day)`,
    );
  }
  return { checked: true, maxPerVoucher, dailyCap, problems };
}
