import { erc20Abi, parseUnits, stringToHex } from 'viem';
import { GD } from './config.js';
import { submitTracked } from './tx.js';

/**
 * What a Moon Shop purchase carries after the transfer's arguments: the text "moonshard:<item id>". The token ignores
 * calldata past its arguments, so this costs nothing; the server reads the item from it (server/src/shop.js), and anyone
 * can read it on a block explorer.
 */
export const itemTag = (itemId) => stringToHex(`moonshard:${itemId}`);

/** The G$ (wei) that `address` holds. */
export function readGBalance({ publicClient, address }) {
  return publicClient.readContract({ address: GD.token, abi: erc20Abi, functionName: 'balanceOf', args: [address] });
}

/**
 * Pays `item.priceG` G$ from the player's wallet into the prize vault, naming the item. The transfer is simulated first,
 * so a wallet without enough G$ is told before anything is sent. `onHash` fires as soon as the wallet has sent it; the caller
 * confirms the hash with the server (pending-confirmation queue). Resolves `{ hash }`, or `{ hash, unconfirmed: true }` if
 * only the receipt wait failed.
 */
export async function buyItem({ wallet, vault, item, onHash }) {
  const { walletClient, publicClient } = wallet.clients();
  const { request } = await publicClient.simulateContract({
    account: walletClient.account,
    address: GD.token,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [vault, parseUnits(String(item.priceG), 18)],
    dataSuffix: itemTag(item.id),
  });
  return submitTracked(async (sent) => {
    const hash = await walletClient.writeContract(request);
    sent(hash);
    return publicClient.waitForTransactionReceipt({ hash });
  }, onHash);
}
