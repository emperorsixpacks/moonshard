import { BaseError, ContractFunctionRevertedError, createPublicClient, http, parseAbi, zeroAddress } from "viem";

export const identityAbi = parseAbi([
  "function getWhitelistedRoot(address) view returns (address)",
  "function lastAuthenticated(address) view returns (uint256)",
  "function authenticationPeriod() view returns (uint256)",
]);

/** UBI scheme. Emitted on every real claim(); topic0 0x89ed2473...d1304 (checked against Celo mainnet logs). */
export const ubiAbi = parseAbi([
  "event UBIClaimed(address indexed claimer, uint256 amount)",
]);

export const engagementAbi = parseAbi([
  "function canClaim(address app, address user) view returns (bool)",
  "event RewardClaimed(address indexed app, address indexed user, address indexed inviter, uint256 appReward, uint256 userAmount, uint256 inviterAmount)",
]);

/** The G$ token: a Moon Shop purchase is a transfer() to the vault, proven by the token's own Transfer event. */
export const tokenAbi = parseAbi([
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const vaultAbi = parseAbi([
  "function claimed(uint256) view returns (bool)",
  "event Claimed(uint256 indexed id, address indexed to, uint256 amount)",
]);

const NOT_FOUND = /NotFound/;

/**
 * @param {import("../config.js").config} config
 * @param {{ client?: import("viem").PublicClient }} [options] `client` is for tests: a viem client over a fake transport
 */
export function createChain(config, { client = createPublicClient({ transport: http(config.rpcUrl) }) } = {}) {
  const { identity: identityAddr, engagement: engagementAddr, vault: vaultAddr } = config.contracts;

  return {
    /**
     * `isWhitelisted` / `root` come from getWhitelistedRoot(), which the contract answers only for an account that is
     * inside its re-verification window: THE liveness signal, and the only one the server uses.
     *
     * `expiresAt` (ms) is informational: last authentication + authenticationPeriod() days. authenticationPeriod() is
     * the LONGEST step of the contract's schedule (reverifyDaysOptions: 1, 7, 180 days by default), but an account
     * is re-verified after reverifyDaysOptions[its authCount] days, which is shorter until it has climbed the
     * schedule. So this is the latest the account could possibly lapse, not when it will. Reading the exact value
     * takes a third sequential RPC call (identities(root).authCount, then reverifyDaysOptions(authCount)) and
     * does not cover accounts still whitelisted through the old identity contract, so it is not read.
     */
    async identity(address) {
      const read = (functionName, args) =>
        client.readContract({ address: identityAddr, abi: identityAbi, functionName, args });
      const root = await read("getWhitelistedRoot", [address]);
      if (root === zeroAddress) {
        const last = await read("lastAuthenticated", [address]);
        return { isWhitelisted: false, root: null, expiresAt: null, expired: last > 0n };
      }
      const [last, periodDays] = await Promise.all([read("lastAuthenticated", [root]), read("authenticationPeriod", [])]);
      const expiresAt = last > 0n ? Number((last + periodDays * 86_400n) * 1000n) : null;
      return { isWhitelisted: true, root: root.toLowerCase(), expiresAt, expired: false };
    },

    verifySignature: (address, message, signature) => client.verifyMessage({ address, message, signature }),

    async getTx(hash) {
      try {
        const [tx, receipt] = await Promise.all([
          client.getTransaction({ hash }),
          client.getTransactionReceipt({ hash }),
        ]);
        const block = await client.getBlock({ blockNumber: receipt.blockNumber });
        return { tx, receipt, timestamp: Number(block.timestamp) };
      } catch (err) {
        if (NOT_FOUND.test(err?.name || "")) return null;
        throw err;
      }
    },

    blockNumber: () => client.getBlockNumber(),

    /**
     * Can this user claim from this app? ok: true / false when the contract answered (a "no" is a bool, or a revert with its
     * reason, such as a cooldown), and ok: null when the node did not answer at all (down, timed out): that is not a "no",
     * and must not read as one.
     */
    async canClaimEngagement(app, user) {
      try {
        const ok = await client.readContract({
          address: engagementAddr, abi: engagementAbi, functionName: "canClaim", args: [app, user],
        });
        return { ok, reason: ok ? null : "not_claimable" };
      } catch (err) {
        const reverted = err instanceof BaseError ? err.walk((e) => e instanceof ContractFunctionRevertedError) : null;
        if (!reverted) return { ok: null, reason: "chain_unavailable" };
        return { ok: false, reason: reverted.reason || reverted.shortMessage || "not_claimable" };
      }
    },

    async voucherClaimed(id) {
      if (!vaultAddr) return false;
      return client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "claimed", args: [BigInt(id)] });
    },
  };
}
