// Registers Moonshard as an app in GoodDollar's Engagement Rewards contract (Celo mainnet).
//
// Usage (the owner runs this, funded with a little CELO for gas):
//   OWNER_KEY=0x.. APP_ADDRESS=0x.. APP_URL=https://.. APP_EMAIL=you@.. node scripts/register-engagement-app.mjs
//
// APP_ADDRESS is the address of APP_SIGNER_KEY on the server (it only signs attestations and holds no funds).
// After this transaction GoodDollar must approve the app before bounty claims work.
//
// 80 / 60 means: 80% of the reward goes to user + inviter, and 60% of that to the user; the rest goes to the app.
// So of a 5,000 G$ claim the player receives 2,400 G$ (5,000 x 80% x 60%), not 5,000. The attestation names no
// inviter, so the inviter's 1,600 G$ and the app's own 1,000 G$ both go to the app (2,600 G$ in all). The API reads
// rewardAmount() and this app's two percentages from the contract and tells the player the 2,400, so if either is
// changed on-chain later (a new pool reward, updateAppSettings) the game follows without a code change.
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';
import { REWARDS_CONTRACT } from '@goodsdks/engagement-sdk';

const { OWNER_KEY, APP_ADDRESS, APP_URL, APP_EMAIL } = process.env;
if (!OWNER_KEY || !APP_ADDRESS || !APP_URL || !APP_EMAIL) {
  throw new Error('Set OWNER_KEY, APP_ADDRESS, APP_URL and APP_EMAIL');
}

const abi = parseAbi([
  'function applyApp(address app, address rewardReceiver, uint8 userAndInviterPercentage, uint8 userPercentage, string description, string url, string email)',
]);

const account = privateKeyToAccount(OWNER_KEY);
const transport = http(process.env.CELO_RPC_URL || 'https://forno.celo.org');
const pub = createPublicClient({ chain: celo, transport });
const wallet = createWalletClient({ account, chain: celo, transport });

const hash = await wallet.writeContract({
  address: REWARDS_CONTRACT,
  abi,
  functionName: 'applyApp',
  args: [
    APP_ADDRESS,
    account.address,
    80,
    60,
    'Moonshard: a pixel action-platformer that rewards verified GoodDollar citizens every day.',
    APP_URL,
    APP_EMAIL,
  ],
});
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`applyApp ${receipt.status}: ${hash}`);
console.log('Next: ask GoodDollar to approve the app (Discord ubi.gd/GoodBuildersDiscord or Telegram t.me/gooddollarbounties).');
