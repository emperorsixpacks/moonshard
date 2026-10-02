import path from 'node:path';

/**
 * The Vite plugin behind `npm run dev:local`. It exists only in the launcher's own dev server, so the game's source, its
 * normal dev server and its production build are untouched. It does four things:
 *   1. gives the page a test wallet: requests that need the key go to the launcher, which signs on the local fork with a
 *      throwaway key (no browser extension needed, and no key in the page);
 *   2. hands the game that wallet directly. A wallet extension in the person's browser (MetaMask, Rabby, ...) owns
 *      window.ethereum and cannot be dislodged, and the game must not end up asking a real wallet to sign, so
 *      src/gd/wallet.js is rewritten, in this dev server only, to read the test wallet first and not to offer the
 *      wallets that announce themselves (EIP-6963);
 *   3. swaps src/gd/identity.js (the link to GoodDollar's hosted face scan) for identity-standin.js, a page on the
 *      launcher where a click passes;
 *   4. puts a small badge on the page so a screenshot of this session cannot be mistaken for the real thing.
 */

/** The one place the game reads the injected wallet. */
const WALLET_READ = 'globalThis.window?.ethereum';
/** The switch for wallets that announce themselves (EIP-6963): off here, so the real extensions are never offered. */
const ANNOUNCED_ON = 'const OFFER_ANNOUNCED_WALLETS = true;';

/**
 * src/gd/wallet.js with the test wallet read first. Throws unless the file reads the wallet in exactly the one expected
 * place: if the game changes, this must stop the launcher, not silently fall back to whatever wallet the browser has.
 */
export function useTestWallet(code) {
  const found = code.split(WALLET_READ).length - 1;
  if (found !== 1) {
    throw new Error(`local test launcher: src/gd/wallet.js must read the injected wallet in exactly one place (${WALLET_READ}) but does so ${found} times. Update scripts/local-dev/plugin.mjs, otherwise the game could ask a real wallet to sign.`);
  }
  const switches = code.split(ANNOUNCED_ON).length - 1;
  if (switches !== 1) {
    throw new Error(`local test launcher: src/gd/wallet.js must switch announced wallets on in exactly one place (${ANNOUNCED_ON}) but does so ${switches} times. Update scripts/local-dev/plugin.mjs (OFFER_ANNOUNCED_WALLETS), otherwise the game could offer a real wallet.`);
  }
  return code
    .replace(WALLET_READ, `(globalThis.window?.__MS_LOCAL_DEV?.provider ?? ${WALLET_READ})`)
    .replace(ANNOUNCED_ON, 'const OFFER_ANNOUNCED_WALLETS = false;');
}

export function walletShim({ helper, address, sessionId }) {
  return `(function () {
  var helper = ${JSON.stringify(helper)};
  var address = ${JSON.stringify(address)};
  var sessionId = ${JSON.stringify(sessionId)};
  // A new launch is a new chain with a new test player: the last launch's login and queued confirmations are meaningless.
  try {
    if (localStorage.getItem('moonshard.localdev.session') !== sessionId) {
      localStorage.removeItem('moonshard.session.v1');
      localStorage.removeItem('moonshard.pending.v1');
      sessionStorage.removeItem('moonshard.gate.v1');
      localStorage.setItem('moonshard.localdev.session', sessionId);
    }
  } catch (e) { /* storage unavailable: nothing to clear */ }
  var provider = {
    isMoonshardLocalDev: true,
    on: function () {},
    removeListener: function () {},
    request: async function (args) {
      var method = args.method;
      var params = args.params || [];
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
      if (method === 'eth_chainId') return '0xa4ec';
      if (method === 'wallet_switchEthereumChain') return null;
      var res = await fetch(helper + '/wallet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: method, params: params }),
      });
      var body = await res.json();
      if (body.error) {
        var err = new Error(body.error.message);
        err.code = body.error.code;
        throw err;
      }
      return body.result;
    },
  };
  // The game reads the test wallet from here (see useTestWallet). window.ethereum is only filled in when nothing owns it:
  // a wallet extension that does is left alone.
  window.__MS_LOCAL_DEV = { helper: helper, address: address, provider: provider };
  if (!('ethereum' in window)) {
    try { Object.defineProperty(window, 'ethereum', { value: provider, configurable: true, writable: true }); } catch (e) { /* owned elsewhere */ }
  }
  document.addEventListener('DOMContentLoaded', function () {
    var badge = document.createElement('a');
    badge.href = helper + '/dev';
    badge.target = '_blank';
    badge.textContent = 'LOCAL TEST · forked chain · face scan is a stand-in · see your G$';
    badge.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483000;font:11px/1.4 monospace;color:#0b130b;background:#ffd166;padding:4px 8px;border-radius:4px;text-decoration:none;opacity:.92';
    document.body.appendChild(badge);
  });
})();`;
}

export function localDevPlugin({ root, getHelperUrl, address, sessionId }) {
  const realIdentity = path.resolve(root, 'src/gd/identity.js');
  const realWallet = path.resolve(root, 'src/gd/wallet.js');
  const standIn = path.resolve(root, 'scripts/local-dev/identity-standin.js');
  return {
    name: 'moonshard-local-dev',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !/gd\/identity(\.js)?$/.test(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && path.resolve(resolved.id) === realIdentity ? standIn : null;
    },
    transform(code, id) {
      if (path.resolve(id.split('?')[0]) !== realWallet) return null;
      return { code: useTestWallet(code), map: null };
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (ctx.path !== '/index.html' && ctx.path !== '/') return html;
        return [{ tag: 'script', children: walletShim({ helper: getHelperUrl(), address, sessionId }), injectTo: 'head-prepend' }];
      },
    },
  };
}
