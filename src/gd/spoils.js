import { parseAbi } from 'viem';
import { submitTracked } from './tx.js';

const vaultAbi = parseAbi([
  'function claim(address to, uint256 id, uint256 amount, uint64 deadline, bytes signature)',
]);

/**
 * Redeem a server-signed voucher on MoonshardVault (the voucher pays `voucher.to`).
 * `onHash` fires as soon as the wallet has sent the transaction; the caller confirms the hash with the server
 * (pending-confirmation queue). Resolves `{ hash }`, or `{ hash, unconfirmed: true }` if only the receipt wait failed.
 */
export async function redeemSpoil({ wallet, vault, voucher, onHash }) {
  const { walletClient, publicClient } = wallet.clients();
  const { request } = await publicClient.simulateContract({
    account: walletClient.account,
    address: vault,
    abi: vaultAbi,
    functionName: 'claim',
    args: [voucher.to, BigInt(voucher.id), BigInt(voucher.amount), BigInt(voucher.deadline), voucher.signature],
  });
  return submitTracked(async (sent) => {
    const hash = await walletClient.writeContract(request);
    sent(hash);
    return publicClient.waitForTransactionReceipt({ hash });
  }, onHash);
}
