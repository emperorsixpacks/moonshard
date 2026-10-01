import { storage } from './Storage.js';
import { signInWithWallet, isUserAbortError } from '../nimiq/auth.js';
import { saveSession, clearSession, getSession, isConnected } from '../nimiq/session.js';
import { submitVerifiedScore } from '../nimiq/leaderboard.js';
import { getHostLanguage, defaultWalletLanguage } from '../nimiq/host.js';

class NimiqServiceManager {
  constructor() {
    this.address = null;
    this.deviceId = null;
    this.isNimiqPay = false;
    this.isInitialized = false;
    this.isSimulated = false;
    this.offline = false;
    this.listeners = new Set();

    this.language = defaultWalletLanguage(getHostLanguage());

    this.init();
  }

  async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    const session = getSession();
    if (session) {
      this.address = session.address;
      this.offline = false;
    }
    this.notify();
  }

  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.getStatus());
    return () => this.listeners.delete(callback);
  }

  notify() {
    const status = this.getStatus();
    this.listeners.forEach((cb) => {
      try {
        cb(status);
      } catch (e) {
        console.error(e);
      }
    });
  }

  getStatus() {
    return {
      connected: !!this.address,
      address: this.address,
      shortAddress: this.getShortAddress(),
      isNimiqPay: this.isNimiqPay,
      isSimulated: this.isSimulated,
      offline: this.offline,
      deviceId: this.deviceId,
      language: this.language,
    };
  }

  getShortAddress() {
    if (!this.address) return '';
    const clean = this.address.replace(/\s+/g, '');
    if (clean.length < 10) return clean;
    return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
  }

  async connect() {
    try {
      const result = await signInWithWallet();
      this.address = result.address;
      this.isNimiqPay = Boolean(result.nimiqPay);
      this.isSimulated = false;
      this.offline = false;
      saveSession({ token: result.token, address: result.address });
      storage.setNimiqAccount(this.address);
      this.notify();
      return { success: true, address: this.address, nimiqPay: this.isNimiqPay };
    } catch (err) {
      if (isUserAbortError(err)) {
        return { success: false, cancelled: true, error: 'Connection cancelled' };
      }
      const offline = isOfflineError(err);
      this.offline = offline;
      this.notify();
      return { success: false, offline, error: offline ? 'Server unreachable — sign-in requires the Moonshard API' : err.message || 'Login failed' };
    }
  }

  disconnect() {
    this.address = null;
    this.isNimiqPay = false;
    this.isSimulated = false;
    clearSession();
    storage.setNimiqAccount(null);
    this.notify();
  }

  /** Sign the run with the connected wallet and register it with the verified leaderboard. */
  async signScoreProof(score, mode = 'SURVIVAL', runMeta = {}) {
    if (!this.address) {
      const err = new Error('Connect your Nimiq wallet first');
      err.status = 401;
      throw err;
    }
    const result = await submitVerifiedScore({
      score,
      mode,
      durationMs: runMeta.durationMs || 0,
      kills: runMeta.kills || 0,
    }).catch((err) => {
      if (isOfflineError(err)) throw offlineError();
      throw err;
    });
    return { ok: true, ...result };
  }
}

function isOfflineError(err) {
  const msg = String(err?.message || '');
  return err?.status === 0 || msg.includes('fetch') || msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED');
}

function offlineError() {
  const err = new Error('Server unreachable — run not verified on-chain');
  err.status = 0;
  return err;
}

export const nimiqService = new NimiqServiceManager();