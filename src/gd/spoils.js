import { parseAbi } from 'viem';

const vaultAbi = parseAbi([
  'function claim(address to, uint256 id, uint256 amount, uint64 deadline, bytes signature)',
]);

/** Redeem a server-signed voucher on MoonshardVault (the voucher pays `voucher.to`). */
export async function redeemSpoil({ wallet, vault, voucher }) {
  const { walletClient, publicClient } = wallet.clients();
  const { request } = await publicClient.simulateContract({
    account: walletClient.account,
    address: vault,
    abi: vaultAbi,
    functionName: 'claim',
    args: [voucher.to, BigInt(voucher.id), BigInt(voucher.amount), BigInt(voucher.deadline), voucher.signature],
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('tx_failed');
  return { hash }; // the caller confirms it with the server (pending-confirmation queue)
}
