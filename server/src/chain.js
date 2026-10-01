import { createPublicClient, http, parseAbi, zeroAddress } from "viem";

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

export const vaultAbi = parseAbi([
  "function claimed(uint256) view returns (bool)",
  "event Claimed(uint256 indexed id, address indexed to, uint256 amount)",
]);

const NOT_FOUND = /NotFound/;

/** @param {import("../config.js").config} config */
export function createChain(config) {
  const client = createPublicClient({ transport: http(config.rpcUrl) });
  const { identity: identityAddr, engagement: engagementAddr, vault: vaultAddr } = config.contracts;

  return {
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

    async canClaimEngagement(app, user) {
      try {
        const ok = await client.readContract({
          address: engagementAddr, abi: engagementAbi, functionName: "canClaim", args: [app, user],
        });
        return { ok, reason: ok ? null : "not_claimable" };
      } catch (err) {
        return { ok: false, reason: err?.cause?.reason || err?.shortMessage || err?.message || "not_claimable" };
      }
    },

    async voucherClaimed(id) {
      if (!vaultAddr) return false;
      return client.readContract({ address: vaultAddr, abi: vaultAbi, functionName: "claimed", args: [BigInt(id)] });
    },
  };
}
