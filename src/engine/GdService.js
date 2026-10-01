import { apiFetch } from '../gd/api.js';
import { signIn } from '../gd/auth.js';
import { clearSession, getToken, loadSession } from '../gd/session.js';
import { createWalletManager, normalizeError } from '../gd/wallet.js';
import { GD } from '../gd/config.js';
import { detectHost, hostLanguage } from '../gd/host.js';
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

/** The pieces of server/chain data that refresh independently. `ok`/`fail` = number of the newest refresh that succeeded/failed. */
const FIELDS = ['rewards', 'bounty', 'spoils', 'ubi'];
const freshMeta = () => Object.fromEntries(FIELDS.map((f) => [f, { ok: 0, fail: 0 }]));
/** Network failure, timeout or server trouble: "the server is not there", as opposed to an answer about this request. */
const isUnreachable = (err) => err?.status === 0 || err?.status >= 500;
/** Actions that end in an on-chain transaction (their wait is longer than a wallet prompt). */
const TX_ACTIONS = new Set(['ubi', 'bounty', 'redeem']);
/** A transaction that was sent but is not recorded yet blocks repeating the same action for this long. */
const AWAIT_MS = 15 * 60 * 1000;
const sameHash = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

class GdServiceManager {
  constructor() {
    this.listeners = new Set();
    this.host = detectHost();
    this.language = hostLanguage();
    this.pending = pending;
    // Lazy chunks: the GoodDollar SDKs are only fetched when a wallet action needs them (tests swap these).
    this.loaders = {
      ubi: () => import('../gd/ubi.js'),
      identity: () => import('../gd/identity.js'),
      engagement: () => import('../gd/engagement.js'),
      spoils: () => import('../gd/spoils.js'),
    };
    this.s = {
      sessionAddress: null, status: 'anonymous', verified: false, identityLoaded: false, offline: false,
      needsReconnect: false, sessionExpired: false,
      busy: null, rewards: null, ubi: null, bounty: null, spoils: [], vault: null,
    };
    // Refreshes can overlap (panel open, run end, claim, wallet events). Each one gets a number; a field is only
    // replaced by a newer answer, and a failure marks the field stale instead of replacing it with "nothing".
    this.seq = 0;
    this.meta = freshMeta();
    this.lastRefresh = Promise.resolve();
    this.started = false; // wallet events are only acted on once start-up has settled the session
    this.walletSeen = null;
    // A wallet prompt can hang forever. After these limits the panel is freed (the action itself keeps going in the
    // background, and another attempt of the same action is refused until it finishes).
    this.timeouts = { wallet: 120_000, tx: 300_000 };
    this.inflight = new Set();
    // Transactions that were sent but are not recorded by the server yet (key -> { hash, at, address }).
    this.awaiting = {};
    wallet.subscribe((w) => this.onWallet(w));
    this.ready = this.init();
  }

  async init() {
    const session = loadSession();
    if (session) {
      const token = session.token;
      this.s.sessionAddress = session.address;
      this.s.status = 'unknown'; // known only once the server has answered
      const restored = await wallet.restore(session.address);
      // A player may sign in while we were reconnecting the wallet: that sign-in owns the state from then on.
      if (getToken() === token) {
        this.s.needsReconnect = !restored;
        try {
          await this.fetchIdentity(true, { token });
          if (getToken() === token) await this.refreshAll();
        } catch (err) {
          if (err?.status === 401) this.authLost(token);
          else this.s.offline = true;
        }
      }
    }
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('gdfv')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('gdfv');
      window.history.replaceState({}, '', url);
    }
    this.started = true;
    this.notify();
  }

  /**
   * The wallet is the player's to change at any time, but the server session belongs to ONE account. When the wallet
   * stops showing that account (switched, locked, disconnected) nothing read from it may be shown as the player's;
   * when it shows that account again everything is reloaded.
   */
  onWallet(w) {
    const prev = this.walletSeen;
    this.walletSeen = { connected: w.connected, address: w.address, wrongChain: w.wrongChain };
    const session = this.s.sessionAddress;
    // while connecting, the sign-in itself decides what the session is
    if (this.started && session && !this.inflight.has('connect')) {
      if (!(w.connected && w.address === session)) {
        this.s.needsReconnect = true;
        this.clearUbi();
      } else if (this.s.needsReconnect || prev?.wrongChain !== w.wrongChain) {
        this.s.needsReconnect = false;
        this.refreshAll().catch(() => {});
      }
    }
    this.notify();
  }

  /** Forget the UBI status, and make anything older that is still in flight out of date. */
  clearUbi() {
    this.meta.ubi = { ok: ++this.seq, fail: 0 };
    this.s.ubi = null;
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
    const sessionAddress = this.s.sessionAddress;
    const hasToken = Boolean(getToken());
    // The client session can run out while the page is open: never report a connection that has no token.
    const connected = Boolean(sessionAddress) && hasToken;
    const lapsed = Boolean(sessionAddress) && !hasToken;
    const address = (connected ? sessionAddress : null) || w.address;
    return {
      connected,
      address,
      shortAddress: address ? shortAddress(address) : '',
      status: connected ? this.s.status : 'anonymous',
      verified: connected && this.s.verified,
      wrongChain: w.wrongChain,
      hasWallet: (typeof window !== 'undefined' && Boolean(window.ethereum)) || Boolean(GD.reownProjectId),
      needsReconnect: connected && this.s.needsReconnect,
      offline: this.s.offline,
      sessionExpired: this.s.sessionExpired || lapsed,
      busy: this.s.busy,
      host: this.host,
      language: this.language,
      rewards: connected ? this.s.rewards : null,
      ubi: connected ? this.s.ubi : null,
      bounty: connected ? this.s.bounty : null,
      spoils: connected ? this.s.spoils : [],
      vault: connected ? this.s.vault : null,
      stale: Object.fromEntries(FIELDS.map((f) => [f, connected && this.meta[f].fail > this.meta[f].ok])),
      pendingCount: this.pending.size(),
      awaiting: connected ? this.awaitingStatus() : { ubi: null, bounty: null, spoils: {} },
      blessing: connected && Boolean(this.s.rewards?.blessing),
    };
  }

  /** The hash of a sent transaction the server has not recorded yet (and that is recent enough to still be on its way). */
  awaitingHash(key) {
    const entry = this.awaiting[key];
    if (!entry) return null;
    const queued = this.pending.list().some((x) => sameHash(x.txHash, entry.hash));
    if (!queued || Date.now() - entry.at > AWAIT_MS) {
      delete this.awaiting[key];
      return null;
    }
    return entry.address === this.s.sessionAddress ? entry.hash : null;
  }

  awaitingStatus() {
    const spoils = {};
    for (const key of Object.keys(this.awaiting)) {
      const hash = key.startsWith('redeem:') ? this.awaitingHash(key) : null;
      if (hash) spoils[key.slice('redeem:'.length)] = hash;
    }
    return { ubi: this.awaitingHash('ubi'), bounty: this.awaitingHash('bounty'), spoils };
  }

  assertNotAwaiting(key) {
    if (this.awaitingHash(key)) throw new Error('already_submitted');
  }

  applyIdentity(me) {
    this.s.sessionAddress = me.address;
    this.s.status = me.status || (me.verified ? 'verified' : 'unverified');
    this.s.verified = Boolean(me.verified);
    this.s.identityLoaded = true;
    this.s.sessionExpired = false;
    this.s.offline = false;
    storage.setWalletAccount(me.address);
  }

  /**
   * `token` is the session the request is made for. If a different sign-in has happened by the time the answer
   * arrives, that answer is for the old session and is ignored (returns null).
   */
  async fetchIdentity(force, { token = getToken(), strict = false } = {}) {
    let me;
    try {
      me = await apiFetch(force ? '/me/refresh' : '/me', { method: force ? 'POST' : 'GET', token, body: force ? {} : undefined });
    } catch (err) {
      // /me/refresh is rate-limited; the cached answer is good enough unless the caller needs to say so (strict)
      if (err?.status !== 429 || strict) throw err;
      me = await apiFetch('/me', { token });
    }
    if (getToken() !== token) return null;
    this.applyIdentity(me);
    return me;
  }

  /** Forget everything that belongs to a signed-in account (the data, not the wallet connection). */
  resetData() {
    this.s = { ...this.s, rewards: null, ubi: null, bounty: null, spoils: [], vault: null };
    this.meta = freshMeta();
    setBlessed(false);
  }

  dropSession({ expired = false } = {}) {
    clearSession();
    this.resetData();
    this.s = {
      ...this.s,
      sessionAddress: null, status: 'anonymous', verified: false, identityLoaded: false,
      needsReconnect: false, offline: false, sessionExpired: expired,
    };
    storage.setWalletAccount(null);
  }

  /**
   * The server (or the clock) says the session is over. `usedToken` is the token the failing request carried: if
   * the player has signed in again since, that request belonged to the old session and must not end the new one.
   */
  authLost(usedToken) {
    const current = getToken();
    if (usedToken && current && current !== usedToken) return false;
    if (!this.s.sessionAddress && !current) return false;
    this.dropSession({ expired: true });
    this.notify();
    return true;
  }

  /** Throws `invalid_session` (and ends the session) when there is no usable session. Call before any on-chain step. */
  requireSession() {
    const token = getToken();
    if (token && this.s.sessionAddress) return token;
    if (this.s.sessionAddress) this.authLost(null);
    throw new Error('invalid_session');
  }

  refreshAll(opts) {
    this.lastRefresh = this.runRefresh(opts);
    return this.lastRefresh;
  }

  async runRefresh({ force = false } = {}) {
    const token = getToken();
    if (!token) {
      // the 12 h client session ran out (or storage was cleared) while the page stayed open
      if (this.s.sessionAddress) this.authLost(null);
      return;
    }
    const seq = ++this.seq;
    const live = () => getToken() === token; // false after a disconnect, an expiry or a newer sign-in

    if (force || !this.s.identityLoaded) {
      try {
        await this.fetchIdentity(force, { token });
      } catch (err) {
        if (err?.status === 401) {
          this.authLost(token);
        } else {
          this.s.offline = true;
          this.notify();
        }
        return;
      }
      if (!live()) return;
    }

    await this.pending.retryAll({ onUnauthorized: (used) => this.authLost(used) }).catch(() => {});
    if (!live()) return;

    const verified = this.s.verified;
    const jobs = {
      rewards: apiFetch('/rewards/status', { token }),
      ...(verified
        ? {
          bounty: apiFetch('/engagement/status', { token }),
          spoils: apiFetch('/spoils', { token }),
          ubi: this.readUbi(),
        }
        : {}),
    };
    const names = Object.keys(jobs);
    const settled = await Promise.allSettled(Object.values(jobs));
    if (settled.some((r) => r.status === 'rejected' && r.reason?.status === 401)) {
      this.authLost(token);
      return;
    }
    if (!live()) return;

    settled.forEach((r, i) => this.applyField(seq, names[i], r.status === 'fulfilled' ? { ok: true, value: r.value } : { ok: false, error: r.reason }));
    if (!verified) {
      for (const f of ['bounty', 'spoils', 'ubi']) this.applyField(seq, f, { ok: true, value: f === 'spoils' ? { spoils: [], vault: null } : null });
    }
    const api = settled.filter((_, i) => names[i] !== 'ubi'); // the UBI read goes to the chain, not to our API
    this.s.offline = api.length > 0 && api.every((r) => r.status === 'rejected' && isUnreachable(r.reason));
    this.notify();
  }

  /** Newest answer wins, per field; a failed answer keeps the last good value and only marks it stale. */
  applyField(seq, field, outcome) {
    const m = this.meta[field];
    if (outcome.ok) {
      if (seq <= m.ok) return;
      m.ok = seq;
      if (field === 'rewards') {
        this.s.rewards = outcome.value;
        setBlessed(outcome.value?.blessing);
      } else if (field === 'spoils') {
        this.s.spoils = outcome.value?.spoils ?? [];
        this.s.vault = outcome.value?.vault ?? null;
      } else {
        this.s[field] = outcome.value;
      }
    } else if (seq > m.fail) {
      m.fail = seq;
    }
  }

  /** The UBI status, or null when there is nothing to read with this wallet right now. Throws if the chain read fails. */
  async readUbi() {
    const w = wallet.getState();
    // only ever read the entitlement of the account this session belongs to
    if (!w.connected || w.wrongChain || w.address !== this.s.sessionAddress) return null;
    try {
      const { prepareUbi, ubiStatus } = await this.loaders.ubi();
      return await ubiStatus(await prepareUbi(wallet));
    } catch (err) {
      console.warn('[gd] ubi status failed', err?.message);
      throw err;
    }
  }

  /**
   * Runs one player action. Never rejects. If the wallet does not answer within the limit the panel is freed with
   * `wallet_timeout`; the action itself is not cancelled (an answer that arrives later is still recorded), so the
   * same action cannot be started again until it has settled (`wallet_busy`).
   */
  async run(label, fn) {
    if (this.inflight.has(label)) return { ok: false, error: 'wallet_busy', message: explainError('wallet_busy') };
    const token = getToken();
    this.setBusy(label);
    const attempt = (async () => {
      try {
        return { ok: true, ...(await fn()) };
      } catch (raw) {
        const err = normalizeError(raw);
        // a 401 while signing in is "bad signature", not a lost session
        if (raw?.status === 401 && label !== 'connect') this.authLost(token);
        return { ok: false, error: err.message, message: explainError(raw?.status !== undefined ? raw : err) };
      }
    })();
    this.inflight.add(label);
    attempt.finally(() => this.inflight.delete(label));
    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false, error: 'wallet_timeout', message: explainError('wallet_timeout') }),
        TX_ACTIONS.has(label) ? this.timeouts.tx : this.timeouts.wallet,
      );
    });
    try {
      return await Promise.race([attempt, timedOut]);
    } finally {
      clearTimeout(timer);
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
      this.resetData(); // a new sign-in never inherits another account's data
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

  /** "I'm done, check again": forces a fresh identity check and says what happened (rate limits and outages included). */
  recheck() {
    return this.run('recheck', async () => {
      const token = this.requireSession();
      await this.fetchIdentity(true, { token, strict: true });
      await this.refreshAll();
      return { verified: this.s.verified };
    });
  }

  /**
   * ClaimSDK.claim() sends the whole page to the face scan when the chain says the wallet is not whitelisted. If our
   * cached identity is out of date that would happen in the middle of a claim, so re-check first. Server trouble does
   * not block the claim: the SDK checks the chain itself, and a paid claim is confirmed later.
   */
  async confirmStillVerified(token) {
    let me;
    try {
      me = await this.fetchIdentity(true, { token });
    } catch (err) {
      if (err?.status === 401) throw err;
      return;
    }
    if (!me) throw new Error('invalid_session');
    if (!me.verified) throw new Error('verification_required');
  }

  verifyHuman() {
    return this.run('verify', async () => {
      this.requireSession();
      await this.ensureWallet();
      const { faceVerificationLink } = await this.loaders.identity();
      window.location.href = await faceVerificationLink(wallet);
      return {};
    });
  }

  /**
   * After an on-chain success the player has been paid, so nothing below may turn it into an error: the server
   * confirmation is queued and retried if it fails, and the follow-up refresh never throws.
   * Reports what happened to the confirmation so the UI can say the truth (confirmed / retrying / refused /
   * the player has to reconnect first). `unconfirmed` = the transaction was sent but its receipt was not seen.
   * Until the server has recorded the transaction, the same action cannot be repeated (`key`).
   */
  async afterPaid(kind, hash, { unconfirmed = false, key = kind } = {}) {
    const token = getToken();
    this.awaiting[key] = { hash, at: Date.now(), address: this.s.sessionAddress };
    const confirm = await this.pending.confirm(kind, hash);
    const reconnectNeeded = !confirm.confirmed && (confirm.status === 401 || confirm.error === 'unauthorized');
    // after confirm(): the queued entry has recorded which account was paid
    if (reconnectNeeded) this.authLost(token);
    else await this.refreshAll().catch(() => {});
    return {
      hash,
      submitted: unconfirmed,
      confirmed: confirm.confirmed,
      confirmPending: !confirm.confirmed && confirm.queued && !reconnectNeeded,
      confirmRejected: !confirm.confirmed && !confirm.queued ? (confirm.error || 'rejected') : null,
      reconnectNeeded,
    };
  }

  claimUbi() {
    return this.run('ubi', async () => {
      const token = this.requireSession();
      this.assertNotAwaiting('ubi');
      await this.ensureWallet();
      const { claimUbi, prepareUbi } = await this.loaders.ubi();
      await this.confirmStillVerified(token);
      const claimSDK = await prepareUbi(wallet); // built for the account the wallet shows right now...
      await this.ensureWallet(); // ...which must still be the signed-in one
      const out = await claimUbi({ claimSDK, onHash: (h) => this.pending.add('ubi', h) });
      return this.afterPaid('ubi', out.hash, { unconfirmed: out.unconfirmed });
    });
  }

  claimBounty() {
    return this.run('bounty', async () => {
      const token = this.requireSession();
      this.assertNotAwaiting('bounty');
      const runId = this.s.bounty?.pendingRunId;
      if (!runId) throw new Error('boss_not_cleared');
      await this.ensureWallet();
      const { claimBounty } = await this.loaders.engagement();
      const out = await claimBounty({ wallet, api: apiFetch, token, runId, onHash: (h) => this.pending.add('engagement', h) });
      return this.afterPaid('engagement', out.hash, { unconfirmed: out.unconfirmed, key: 'bounty' });
    });
  }

  redeem(spoilId) {
    return this.run('redeem', async () => {
      this.requireSession();
      const key = `redeem:${spoilId}`;
      this.assertNotAwaiting(key);
      const spoil = this.s.spoils.find((x) => x.id === spoilId);
      if (!spoil?.voucher || !this.s.vault) throw new Error('not_claimable');
      const vault = this.s.vault.address;
      // The build can pin the vault it was configured with: a server answer pointing elsewhere is refused.
      if (GD.vault && String(vault).toLowerCase() !== GD.vault.toLowerCase()) throw new Error('vault_mismatch');
      await this.ensureWallet();
      const { redeemSpoil } = await this.loaders.spoils();
      const out = await redeemSpoil({ wallet, vault, voucher: spoil.voucher, onHash: (h) => this.pending.add('spoil', h) });
      return this.afterPaid('spoil', out.hash, { unconfirmed: out.unconfirmed, key });
    });
  }
}

export const gdService = new GdServiceManager();
