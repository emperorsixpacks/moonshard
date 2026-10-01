import { apiFetch } from '../gd/api.js';
import { signIn } from '../gd/auth.js';
import { clearSession, getToken, loadSession } from '../gd/session.js';
import { createWalletManager, normalizeError } from '../gd/wallet.js';
import { GD } from '../gd/config.js';
import { detectHost, hostLanguage } from '../gd/host.js';
import { fetchRewardsStatus } from '../gd/rewards.js';
import { setBlessed } from '../gd/blessing.js';
import { pending } from '../gd/pending.js';
import { explainError, shortAddress } from '../gd/format.js';
import { storage } from './Storage.js';

async function loadWalletConnect() {
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const provider = await EthereumProvider.init({
    projectId: GD.reownProjectId,
    chains: [GD.chainId],
    showQrModal: true,
    metadata: { name: 'Moonshard', description: 'Moonshard: The High Forest', url: window.location.origin, icons: [] },
  });
  await provider.connect(); // opens the QR modal; resolves once paired
  return provider;
}

const wallet = createWalletManager({ getFallbackProvider: GD.reownProjectId ? loadWalletConnect : null });

class GdServiceManager {
  constructor() {
    this.listeners = new Set();
    this.host = detectHost();
    this.language = hostLanguage();
    this.claimSDK = null;
    this.pending = pending;
    // Lazy chunks: the GoodDollar SDKs are only fetched when a wallet action needs them (tests swap these).
    this.loaders = {
      ubi: () => import('../gd/ubi.js'),
      identity: () => import('../gd/identity.js'),
      engagement: () => import('../gd/engagement.js'),
      spoils: () => import('../gd/spoils.js'),
    };
    this.s = {
      sessionAddress: null, status: 'anonymous', verified: false, offline: false, needsReconnect: false,
      busy: null, rewards: null, ubi: null, bounty: null, spoils: [], vault: null,
    };
    wallet.subscribe(() => this.notify());
    this.ready = this.init();
  }

  async init() {
    const session = loadSession();
    if (session) {
      this.s.sessionAddress = session.address;
      this.s.needsReconnect = !(await wallet.restore(session.address));
      try {
        await this.fetchIdentity(true);
        await this.refreshAll();
      } catch (err) {
        if (err?.status === 401) this.dropSession();
        else this.s.offline = true;
      }
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('gdfv')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('gdfv');
      window.history.replaceState({}, '', url);
    }
    this.notify();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.getStatus());
    return () => this.listeners.delete(fn);
  }

  notify() {
    const status = this.getStatus();
    this.listeners.forEach((fn) => { try { fn(status); } catch (e) { console.error(e); } });
  }

  setBusy(label) {
    this.s.busy = label;
    this.notify();
  }

  getStatus() {
    const w = wallet.getState();
    const address = this.s.sessionAddress || w.address;
    const connected = Boolean(this.s.sessionAddress);
    return {
      connected,
      address,
      shortAddress: address ? shortAddress(address) : '',
      status: this.s.status,
      verified: this.s.verified,
      wrongChain: w.wrongChain,
      hasWallet: (typeof window !== 'undefined' && Boolean(window.ethereum)) || Boolean(GD.reownProjectId),
      needsReconnect: connected && this.s.needsReconnect,
      offline: this.s.offline,
      busy: this.s.busy,
      host: this.host,
      language: this.language,
      rewards: this.s.rewards,
      ubi: this.s.ubi,
      bounty: this.s.bounty,
      spoils: this.s.spoils,
      vault: this.s.vault,
      blessing: Boolean(this.s.rewards?.blessing),
    };
  }

  applyIdentity(me) {
    this.s.sessionAddress = me.address;
    this.s.status = me.status || (me.verified ? 'verified' : 'unverified');
    this.s.verified = Boolean(me.verified);
    this.s.offline = false;
    storage.setWalletAccount(me.address);
  }

  async fetchIdentity(force) {
    const token = getToken();
    let me;
    try {
      me = await apiFetch(force ? '/me/refresh' : '/me', { method: force ? 'POST' : 'GET', token, body: force ? {} : undefined });
    } catch (err) {
      if (err?.status !== 429) throw err;
      me = await apiFetch('/me', { token });
    }
    this.applyIdentity(me);
    return me;
  }

  dropSession() {
    clearSession();
    this.claimSDK = null;
    this.s = { ...this.s, sessionAddress: null, status: 'anonymous', verified: false, rewards: null, ubi: null, bounty: null, spoils: [], vault: null };
    setBlessed(false);
    storage.setWalletAccount(null);
  }

  async refreshAll({ force = false } = {}) {
    const token = getToken();
    if (!token) return;
    // `offline` means the identity never loaded (API unreachable at start-up). Retry it here so the panel and
    // the scenes recover on their own once the API is back, instead of waiting for a manual re-check or reload.
    if (force || this.s.offline) {
      await this.fetchIdentity(force).catch((err) => { if (err?.status === 401) this.dropSession(); });
    }
    await this.pending.retryAll().catch(() => {});
    const rewards = await fetchRewardsStatus();
    this.s.rewards = rewards;
    setBlessed(rewards?.blessing);
    if (this.s.verified) {
      const [eng, spoils] = await Promise.all([
        apiFetch('/engagement/status', { token }).catch(() => null),
        apiFetch('/spoils', { token }).catch(() => null),
      ]);
      this.s.bounty = eng;
      this.s.spoils = spoils?.spoils ?? [];
      this.s.vault = spoils?.vault ?? null;
      await this.refreshUbi();
    } else {
      this.s.bounty = null;
      this.s.spoils = [];
      this.s.ubi = null;
    }
    this.notify();
  }

  async refreshUbi() {
    if (!wallet.getState().connected || wallet.getState().wrongChain) {
      this.s.ubi = null;
      return;
    }
    try {
      const { prepareUbi, ubiStatus } = await this.loaders.ubi();
      this.claimSDK = await prepareUbi(wallet);
      this.s.ubi = await ubiStatus(this.claimSDK);
    } catch (err) {
      console.warn('[gd] ubi status failed', err?.message);
      this.s.ubi = null;
    }
  }

  async run(label, fn) {
    this.setBusy(label);
    try {
      return { ok: true, ...(await fn()) };
    } catch (raw) {
      const err = normalizeError(raw);
      if (raw?.status === 401) this.dropSession();
      return { ok: false, error: err.message, message: explainError(raw?.status !== undefined ? raw : err) };
    } finally {
      this.setBusy(null);
    }
  }

  async ensureWallet() {
    const w = wallet.getState();
    if (!w.connected) {
      const c = await wallet.connect();
      if (!c.ok) throw new Error(c.reason);
    }
    if (wallet.getState().address !== this.s.sessionAddress) throw new Error('wallet_mismatch');
    this.s.needsReconnect = false;
  }

  connect() {
    return this.run('connect', async () => {
      const c = await wallet.connect();
      if (!c.ok) throw new Error(c.reason);
      const res = await signIn({ wallet, host: this.host });
      this.applyIdentity(res);
      this.s.needsReconnect = false;
      await this.refreshAll();
      return { address: res.address };
    });
  }

  disconnect() {
    wallet.disconnect();
    this.dropSession();
    this.notify();
  }

  switchToCelo() {
    return this.run('switch', async () => {
      const ok = await wallet.switchToCelo();
      if (!ok) throw new Error('wrong_chain');
      await this.refreshAll();
      return {};
    });
  }

  verifyHuman() {
    return this.run('verify', async () => {
      await this.ensureWallet();
      const { faceVerificationLink } = await this.loaders.identity();
      window.location.href = await faceVerificationLink(wallet);
      return {};
    });
  }

  /**
   * After an on-chain success the player has been paid, so nothing below may turn it into an error: the server
   * confirmation is queued and retried if it fails, and the follow-up refresh never throws.
   */
  async afterPaid(kind, hash) {
    const confirm = await this.pending.confirm(kind, hash);
    await this.refreshAll().catch(() => {});
    return { hash, confirmPending: !confirm.confirmed && confirm.queued };
  }

  claimUbi() {
    return this.run('ubi', async () => {
      await this.ensureWallet();
      const { claimUbi, prepareUbi } = await this.loaders.ubi();
      this.claimSDK = this.claimSDK || (await prepareUbi(wallet));
      const { hash } = await claimUbi({ claimSDK: this.claimSDK });
      return this.afterPaid('ubi', hash);
    });
  }

  claimBounty() {
    return this.run('bounty', async () => {
      const runId = this.s.bounty?.pendingRunId;
      if (!runId) throw new Error('boss_not_cleared');
      await this.ensureWallet();
      const { claimBounty } = await this.loaders.engagement();
      const { hash } = await claimBounty({ wallet, api: apiFetch, token: getToken(), runId });
      return this.afterPaid('engagement', hash);
    });
  }

  redeem(spoilId) {
    return this.run('redeem', async () => {
      const spoil = this.s.spoils.find((x) => x.id === spoilId);
      if (!spoil?.voucher || !this.s.vault) throw new Error('not_claimable');
      await this.ensureWallet();
      const { redeemSpoil } = await this.loaders.spoils();
      const { hash } = await redeemSpoil({ wallet, vault: this.s.vault.address, voucher: spoil.voucher });
      return this.afterPaid('spoil', hash);
    });
  }
}

export const gdService = new GdServiceManager();
