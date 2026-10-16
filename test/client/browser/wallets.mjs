// Several wallet extensions in one browser, as the owner has (MetaMask and another), in a real browser. Two extensions fight
// over window.ethereum and leave it broken ("Cannot redefine property: ethereum"); each still announces itself (EIP-6963).
//   connecting offers one button per wallet, and the one picked is the one asked to connect and sign; the broken
//   window.ethereum and the other wallet are never asked
//   after a reload, the session comes back through that same wallet
//   with one wallet, its button names it
//   node test/client/browser/wallets.mjs        (run from the repository root)
import { bootGame, waitSheet } from './lib.mjs';
import { installApi } from './api-stub.mjs';

const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, message) => { if (!ok) { failures.push(message); log(`   ✗ ${message}`); } else log(`   ✓ ${message}`); };
const waitPanel = (page, re) => waitSheet(page, re);

/** Two wallet extensions that announce themselves, and a window.ethereum that two extensions fighting over it broke. */
const extensions = (wallets) => `
(function () {
  window.__walletCalls = [];
  var addresses = { 'io.metamask': '0x1111111111111111111111111111111111111111', 'io.rabby': '0x2222222222222222222222222222222222222222' };
  function wallet(rdns, name) {
    var provider = {
      on: function () {}, removeListener: function () {},
      request: async function (args) {
        window.__walletCalls.push(rdns + ' ' + args.method);
        if (args.method === 'eth_requestAccounts' || args.method === 'eth_accounts') return [addresses[rdns]];
        if (args.method === 'eth_chainId') return '0xa4ec';
        if (args.method === 'personal_sign') return '0x' + 'ab'.repeat(65);
        throw new Error('unexpected ' + args.method);
      },
    };
    var detail = Object.freeze({ info: { uuid: rdns, name: name, icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: rdns }, provider: provider });
    window.addEventListener('eip6963:requestProvider', function () { window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: detail })); });
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: detail }));
  }
  ${wallets.map(([rdns, name]) => `wallet(${JSON.stringify(rdns)}, ${JSON.stringify(name)});`).join('\n  ')}
  Object.defineProperty(window, 'ethereum', {
    configurable: false,
    value: { request: async function (args) { window.__walletCalls.push('window.ethereum ' + args.method); throw new Error('Cannot redefine property: ethereum'); }, on: function () {} },
  });
})();`;

// ---- two wallets -------------------------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: extensions([['io.metamask', 'MetaMask'], ['io.rabby', 'Rabby Wallet']]) });
  try {
    const api = await installApi(g.page, { verified: true });
    await g.goto();
    log('▶ MetaMask and Rabby, window.ethereum broken');
    await g.page.evaluate(() => window.__gdPanel.open());
    check(await waitPanel(g.page, /Choose your wallet/), 'the panel asks which wallet');
    const buttons = await g.page.$$eval('[data-act="connect"]', (els) => els.map((el) => ({ id: el.dataset.id, text: el.innerText.trim() })));
    check(JSON.stringify(buttons) === JSON.stringify([{ id: 'io.metamask', text: 'MetaMask' }, { id: 'io.rabby', text: 'Rabby Wallet' }]), `one button each (${JSON.stringify(buttons)})`);
    await g.page.click('[data-act="connect"][data-id="io.rabby"]');
    check(await waitPanel(g.page, /Verified human/), 'picking Rabby connects and signs in');
    const calls = await g.page.evaluate(() => window.__walletCalls);
    check(calls.includes('io.rabby eth_requestAccounts') && calls.includes('io.rabby personal_sign'), 'Rabby was asked to connect and to sign');
    check(!calls.some((c) => c.startsWith('io.metamask') || c.startsWith('window.ethereum')), `MetaMask and the broken window.ethereum were never asked (${calls.join(', ')})`);
    check(api.signedInAs === '0x2222222222222222222222222222222222222222', 'the session is Rabby\'s account');

    log('▶ a reload');
    await g.page.evaluate(() => { window.__walletCalls = []; });
    await g.goto();
    await g.page.waitForTimeout(1_500);
    const again = await g.page.evaluate(() => window.__walletCalls);
    check(again.includes('io.rabby eth_accounts') && !again.some((c) => !c.startsWith('io.rabby')), `the session comes back through Rabby (${again.join(', ')})`);
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

// ---- one wallet --------------------------------------------------------------------------------------------------------
{
  const g = await bootGame({ api: true, init: extensions([['io.metamask', 'MetaMask']]) });
  try {
    await installApi(g.page, { verified: true });
    await g.goto();
    log('▶ only MetaMask');
    await g.page.evaluate(() => window.__gdPanel.open());
    check(await waitPanel(g.page, /Connect MetaMask/), 'the button names the wallet');
    await g.page.click('[data-act="connect"]');
    check(await waitPanel(g.page, /Verified human/), 'and connects with it');
    check(g.errors.length === 0, `no browser errors ${g.errors.join(' | ')}`);
  } finally { await g.close(); }
}

if (failures.length) {
  console.log(`\n❌ wallets check failed (${failures.length})`);
  process.exit(1);
}
console.log('\n✅ wallets check passed');
