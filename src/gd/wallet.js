import { createPublicClient, createWalletClient, custom, http, toHex } from 'viem';
import { celo } from 'viem/chains';
import { GD } from './config.js';

/** A genuine "the user said no" (EIP-1193 4001, or the wallets' standard wording), looked for through the cause chain. */
const isRejection = (err) => {
  for (let e = err, depth = 0; e && depth < 6; e = e.cause, depth++) {
    if (e.code === 4001 || e.code === 'ACTION_REJECTED') return true;
    if (/\buser (rejected|denied|cancell?ed)\b/i.test(e.message || '')) return true;
  }
  return false;
};

/**
 * Whether wallets that announce themselves (EIP-6963) are offered. The local test launcher (scripts/local-dev/plugin.mjs)
 * turns this off in its own dev server: there, the game must only ever use its test wallet.
 */
const OFFER_ANNOUNCED_WALLETS = true;

/** Where the wallet the player picked is remembered, so a reload reconnects to that same one. */
const REMEMBERED_WALLET = 'moonshard.wallet.v1';

/** An icon is shown only when it is an image inside the page itself (a data: URL), never one fetched from elsewhere. */
const safeIcon = (icon) => (typeof icon === 'string' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(icon) ? icon : null);

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, some webviews)
  }
}

/**
 * EIP-6963: every wallet extension announces itself on the page with a name, an icon and its own provider, so several can
 * be installed side by side. window.ethereum holds at most one of them (the one that wrote it last) or, when two fight over
 * it, a broken one (MetaMask: "Cannot redefine property: ethereum"), and the other wallets cannot be reached through it.
 * `onChange` is called when a wallet appears (an extension can load after the page).
 * @returns {{ list: () => { id: string, name: string, icon: string|null, provider: object }[], stop: () => void }}
 */
export function discoverWallets(page = globalThis.window, onChange = () => {}) {
  const found = new Map();
  if (typeof page?.addEventListener !== 'function') return { list: () => [], stop() {} };
  const onAnnounce = (event) => {
    const { info, provider } = event?.detail ?? {};
    if (!info?.rdns || typeof provider?.request !== 'function') return;
    found.set(String(info.rdns), { id: String(info.rdns), name: String(info.name || info.rdns), icon: safeIcon(info.icon), provider });
    onChange();
  };
  page.addEventListener('eip6963:announceProvider', onAnnounce);
  try {
    page.dispatchEvent(new Event('eip6963:requestProvider'));
  } catch { /* a page without DOM events */ }
  return { list: () => [...found.values()], stop: () => page.removeEventListener('eip6963:announceProvider', onAnnounce) };
}

/** Wallet rejections become Error('rejected'); everything else is passed through. */
export function normalizeError(err) {
  if (isRejection(err)) return new Error('rejected');
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * `getProvider` returns the injected EIP-1193 provider (window.ethereum, for a wallet that does not announce itself).
 * `getFallbackProvider` (optional, async) supplies one when nothing is injected, e.g. WalletConnect.
 * `page` is where wallets announce themselves (EIP-6963); `state.wallets` lists them ({ id, name, icon }) and
 * `connect(id)` uses the one picked. With several and none picked yet, `connect()` answers `choose_wallet`.
 */
export function createWalletManager({
  getProvider: getInjected = () => globalThis.window?.ethereum,
  getFallbackProvider = null,
  chainId = GD.chainId,
  rpcUrl = GD.rpcUrl,
  page = globalThis.window,
  offerAnnounced = OFFER_ANNOUNCED_WALLETS,
  storage = defaultStorage(),
} = {}) {
  let state = { connected: false, address: null, chainId: null, wrongChain: false, wallets: [] };
  const listeners = new Set();
  let bound = null;
  let fallback = null;
  let chosen = null; // the provider of the announced wallet the player picked
  const getProvider = () => chosen || getInjected() || fallback;

  const notify = () => listeners.forEach((fn) => { try { fn({ ...state }); } catch (e) { console.error(e); } });
  const set = (patch) => { state = { ...state, ...patch }; notify(); };

  let announced = { list: () => [] };
  const publicList = () => announced.list().map(({ id, name, icon }) => ({ id, name, icon }));
  if (offerAnnounced) announced = discoverWallets(page, () => set({ wallets: publicList() }));
  state = { ...state, wallets: publicList() };

  const remembered = () => {
    try { return storage?.getItem(REMEMBERED_WALLET) ?? null; } catch { return null; }
  };
  /** Use the announced wallet `id` from now on, and remember it. False when no such wallet has announced itself. */
  function pick(id) {
    const wallet = announced.list().find((w) => w.id === id);
    if (!wallet) return false;
    chosen = wallet.provider;
    try { storage?.setItem(REMEMBERED_WALLET, id); } catch { /* not remembered: asked again next time */ }
    return true;
  }

  const readChainId = async (provider) => Number(await provider.request({ method: 'eth_chainId' }));

  function bind(provider) {
    if (bound === provider || typeof provider.on !== 'function') return;
    bound = provider;
    provider.on('accountsChanged', (accounts) => {
      if (!accounts?.length) set({ connected: false, address: null });
      else set({ address: String(accounts[0]).toLowerCase() });
    });
    provider.on('chainChanged', (hex) => {
      const id = Number(hex);
      set({ chainId: id, wrongChain: id !== chainId });
    });
  }

  async function switchToCelo() {
    const provider = getProvider();
    if (!provider) return false;
    try {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(chainId) }] });
    } catch (err) {
      if (err?.code !== 4902) return false;
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: toHex(chainId),
            chainName: 'Celo',
            nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
            rpcUrls: [rpcUrl],
            blockExplorerUrls: ['https://celoscan.io'],
          }],
        });
        // most wallets switch on add; switching again is harmless and covers the ones that do not
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: toHex(chainId) }] });
      } catch {
        return false;
      }
    }
    const now = await readChainId(provider);
    set({ chainId: now, wrongChain: now !== chainId });
    return now === chainId;
  }

  /** `walletId`: the announced wallet to use (from `state.wallets`); without one, the remembered or only wallet is used. */
  async function connect(walletId) {
    if (offerAnnounced) {
      const wallets = announced.list();
      if (walletId !== undefined && walletId !== null) {
        if (!pick(walletId)) return { ok: false, reason: 'no_wallet' };
      } else if (!chosen && wallets.length > 0) {
        if (!pick(remembered()) && !(wallets.length === 1 && pick(wallets[0].id))) return { ok: false, reason: 'choose_wallet' };
      }
    }
    if (!chosen && !getInjected() && !fallback && getFallbackProvider) {
      try {
        fallback = await getFallbackProvider();
      } catch (err) {
        return { ok: false, reason: isRejection(err) ? 'rejected' : 'wallet_error', message: err?.message };
      }
    }
    const provider = getProvider();
    if (!provider) return { ok: false, reason: 'no_wallet' };
    let accounts;
    try {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    } catch (err) {
      return { ok: false, reason: isRejection(err) ? 'rejected' : 'wallet_error', message: err?.message };
    }
    if (!accounts?.length) return { ok: false, reason: 'no_account' };
    bind(provider);
    const current = await readChainId(provider);
    set({ connected: true, address: String(accounts[0]).toLowerCase(), chainId: current, wrongChain: current !== chainId });
    if (current !== chainId) await switchToCelo();
    return { ok: true, address: state.address, wrongChain: state.wrongChain };
  }

  /** Reconnect without a prompt, only if the wallet still exposes `expectedAddress`: the remembered wallet, when it is here. */
  async function restore(expectedAddress) {
    if (offerAnnounced && !chosen) pick(remembered());
    const provider = getProvider();
    if (!provider) return false;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      const match = (accounts || []).find((a) => String(a).toLowerCase() === String(expectedAddress).toLowerCase());
      if (!match) return false;
      bind(provider);
      const current = await readChainId(provider);
      set({ connected: true, address: String(match).toLowerCase(), chainId: current, wrongChain: current !== chainId });
      return true;
    } catch {
      return false;
    }
  }

  function disconnect() {
    set({ connected: false, address: null, wrongChain: false });
  }

  function rawWalletClient() {
    const provider = getProvider();
    if (!provider || !state.address) throw new Error('no_wallet');
    return createWalletClient({ account: state.address, chain: celo, transport: custom(provider) });
  }

  /** viem clients for on-chain actions. Blocks when the wallet is on the wrong chain. */
  function clients() {
    const walletClient = rawWalletClient();
    if (state.wrongChain) throw new Error('wrong_chain');
    return { walletClient, publicClient: createPublicClient({ chain: celo, transport: http(rpcUrl) }) };
  }

  async function signMessage(message) {
    try {
      return await rawWalletClient().signMessage({ message });
    } catch (err) {
      throw normalizeError(err);
    }
  }

  return {
    connect, restore, disconnect, switchToCelo, clients, signMessage,
    getState: () => ({ ...state }),
    subscribe(fn) {
      listeners.add(fn);
      fn({ ...state });
      return () => listeners.delete(fn);
    },
  };
}
