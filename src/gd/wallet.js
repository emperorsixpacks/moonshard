import { createPublicClient, createWalletClient, custom, http, toHex } from 'viem';
import { celo } from 'viem/chains';
import { GD } from './config.js';

const isRejection = (err) =>
  err?.code === 4001 || err?.code === 'ACTION_REJECTED' || /reject|denied|cancel/i.test(err?.message || '');

/** Wallet rejections become Error('rejected'); everything else is passed through. */
export function normalizeError(err) {
  if (isRejection(err)) return new Error('rejected');
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * `getProvider` returns the injected EIP-1193 provider (MiniPay, browser wallets).
 * `getFallbackProvider` (optional, async) supplies one when nothing is injected, e.g. WalletConnect.
 */
export function createWalletManager({
  getProvider: getInjected = () => globalThis.window?.ethereum,
  getFallbackProvider = null,
  chainId = GD.chainId,
  rpcUrl = GD.rpcUrl,
} = {}) {
  let state = { connected: false, address: null, chainId: null, wrongChain: false };
  const listeners = new Set();
  let bound = null;
  let fallback = null;
  const getProvider = () => getInjected() || fallback;

  const notify = () => listeners.forEach((fn) => { try { fn({ ...state }); } catch (e) { console.error(e); } });
  const set = (patch) => { state = { ...state, ...patch }; notify(); };

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

  async function connect() {
    if (!getInjected() && !fallback && getFallbackProvider) {
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

  /** Reconnect without a prompt, only if the wallet still exposes `expectedAddress`. */
  async function restore(expectedAddress) {
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
