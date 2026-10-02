import { formatUnits } from 'viem';

/**
 * The player's G$ in and out, as the local test launcher shows it: raw token Transfer logs turned into rows, each source
 * named for what the game uses it for. Pure, so it can be tested without a chain.
 */

const SOURCES = {
  ubi: 'Daily UBI claim',
  engagement: 'First-boss bounty (Engagement Rewards)',
  vault: 'Spoils redeemed (MoonshardVault)',
};

export const shortAddress = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** Whole G$ with at most two decimals: "2,400", "114.5". */
export function formatG(wei) {
  return Number(formatUnits(BigInt(wei), 18)).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** What a payment from the player is: a Moon Shop purchase when it went into the prize vault (`item`: what it bought). */
function outgoingLabel(t, name, other) {
  if (name === 'vault') return t.item ? `Moon Shop: ${t.item} (into the prize vault)` : 'Paid into the prize vault (Moon Shop)';
  return `Sent to ${SOURCES[name] ?? shortAddress(other)}`;
}

/**
 * @param {{ args: { from: string, to: string, value: bigint }, blockNumber: bigint, logIndex: number, transactionHash: string,
 *           item?: string | null }[]} transfers `item`: for a payment into the vault, the item its transaction names
 * @param {{ player: string, known: { ubi?: string, engagement?: string, vault?: string } }} context the other contracts' addresses
 * @returns {{ direction: 'in' | 'out', label: string, amountG: string, tx: string, block: number }[]} newest first
 */
export function ledgerRows(transfers, { player, known }) {
  const me = player.toLowerCase();
  const nameOf = (address) => Object.entries(known).find(([, candidate]) => candidate && candidate.toLowerCase() === address)?.[0];
  return [...transfers]
    .sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex)
    .map((t) => {
      const from = t.args.from.toLowerCase();
      const to = t.args.to.toLowerCase();
      const incoming = to === me;
      const other = incoming ? from : to;
      const name = nameOf(other);
      return {
        direction: incoming ? 'in' : 'out',
        label: incoming ? (SOURCES[name] ?? `From ${shortAddress(other)}`) : outgoingLabel(t, name, other),
        amountG: formatG(t.args.value),
        tx: t.transactionHash,
        block: Number(t.blockNumber),
      };
    });
}
