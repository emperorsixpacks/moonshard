// The public stats page tells the truth about what each number is:
//   what the chain backs (UBI claims, boss bounties, Spoils paid, G$ spent in the Moon Shop, verified humans) is kept apart from what the game only
//   reports (runs, wallets, players who started a run: a free wallet counts there)
//   "verified humans" says it counts everyone ever verified, and a verified person playing TODAY is its own tile
//   a server that predates a counter shows a dash, not NaN
//   node test/client/browser/stats.mjs        (run from the repository root)
import { bootGame } from './lib.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };

const day = (i) => `2026-10-0${i + 1}`;
const STATS = {
  verifiedPlayers: 12, walletsConnected: 40, runsToday: 7, activeToday: 5, verifiedActiveToday: 3,
  ubiClaimsTotal: 9, ubiClaimsToday: 2, engagementClaims: 1, spoilsIssuedG: '1100', spoilsPaidG: '1000',
  shopPurchases: 4, shopSpentG: '270', referralsInvited: 6, referralsVerified: 3, referrers: 2,
  series: Array.from({ length: 7 }, (_, i) => ({ day: day(i), runs: i, active: i, ubiClaims: i % 3 })),
  updatedAt: '2026-10-07T12:00:00.000Z',
};

const tiles = (page, id) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} .tile`)]
  .map((t) => [t.querySelector('span').textContent, t.querySelector('b').textContent]), `#${id}`);
const serve = (page, body) => page.route('**/api/stats', (route) => route.fulfill({
  status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
}));

const g = await bootGame({ api: true });
try {
  log('▶ the stats page');
  await serve(g.page, STATS);
  await g.page.goto(`${g.web}/stats.html`);
  await g.page.waitForSelector('#chain .tile', { timeout: 30_000 });
  const chain = new Map(await tiles(g.page, 'chain'));
  const reported = new Map(await tiles(g.page, 'reported'));
  const headings = await g.page.evaluate(() => [...document.querySelectorAll('h2.group')].map((h) => h.textContent));

  check(headings.length === 2 && /CONFIRMED ON-CHAIN/.test(headings[0]) && /REPORTED BY THE GAME/.test(headings[1]), 'two groups: confirmed on-chain, and reported by the game');
  check(chain.get('VERIFIED PLAYERS TODAY') === '3', 'a verified person playing today has its own tile');
  check(chain.get('VERIFIED HUMANS, EVER') === '12', 'verified humans says it counts everyone ever verified');
  check(![...chain.keys(), ...reported.keys()].includes('VERIFIED HUMANS'), 'nothing is called plain "verified humans"');
  for (const label of ['G$ UBI CLAIMS VIA MOONSHARD', 'UBI CLAIMS TODAY', 'BOSS BOUNTIES CLAIMED', 'SPOILS PAID OUT (G$)', 'G$ SPENT IN THE MOON SHOP']) {
    check(chain.has(label), `${label} is among the confirmed numbers`);
  }
  for (const label of ['RUNS TODAY', 'PLAYERS WHO STARTED A RUN TODAY', 'WALLETS CONNECTED', 'SPOILS ISSUED (G$)']) {
    check(reported.has(label) && !chain.has(label), `${label} is among the reported numbers, not the confirmed ones`);
  }
  check(reported.get('RUNS TODAY') === '7' && reported.get('WALLETS CONNECTED') === '40', 'the numbers are the server\'s');
  check(chain.get('G$ SPENT IN THE MOON SHOP') === '270' && chain.get('MOON SHOP PURCHASES') === '4', 'what players spent in the Moon Shop is shown, from the chain');
  check(chain.get('VERIFIED FRIENDS BROUGHT BY INVITES') === '3' && chain.get('PLAYERS WHO BROUGHT A VERIFIED FRIEND') === '2', 'the friends invites brought who the identity contract vouches for are among the confirmed numbers');
  check(reported.get('WALLETS THAT JOINED VIA AN INVITE') === '6' && !chain.has('WALLETS THAT JOINED VIA AN INVITE'), 'wallets that joined through an invite (verified or not) are reported, not confirmed');
  const legend = await g.page.evaluate(() => document.querySelector('.legend').textContent);
  check(/Runs \(any wallet\)/.test(legend) && /Players \(any wallet\)/.test(legend) && /UBI claims \(on-chain\)/.test(legend), 'the chart says which series are from any wallet');

  log('▶ a server that predates a counter');
  const { verifiedActiveToday, ...older } = STATS;
  await g.page.unroute('**/api/stats');
  await serve(g.page, older);
  await g.page.goto(`${g.web}/stats.html`);
  await g.page.waitForSelector('#chain .tile', { timeout: 30_000 });
  const olderChain = new Map(await tiles(g.page, 'chain'));
  check(olderChain.get('VERIFIED PLAYERS TODAY') === '–', 'the missing counter shows a dash');
  check(![...olderChain.values()].some((v) => /NaN/.test(v)), 'and nothing shows NaN');
  check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
} finally { await g.close(); }

if (failures.length) {
  console.log(`\n❌ stats check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ stats check passed');
