import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { saveSession, loadSession, clearSession, getToken, getAddress } from '../../src/gd/session.js';

/** Install a fake `localStorage` global for the duration of `fn`, then restore whatever was there. */
async function withLocalStorage(descriptor, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, ...descriptor });
  try {
    return await fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
}

test('session round-trips with a lowercased address and clears', () => {
  clearSession();
  saveSession({ token: 'tok', address: '0xABCDEF', host: 'browser' });
  assert.equal(getToken(), 'tok');
  assert.equal(getAddress(), '0xabcdef');
  clearSession();
  assert.equal(loadSession(), null);
});

test('a session older than 12 hours is dropped', () => {
  clearSession();
  const t0 = 1_800_000_000_000;
  const now = mock.method(Date, 'now', () => t0);
  try {
    saveSession({ token: 'tok', address: '0xabc', host: 'browser' });
    now.mock.mockImplementation(() => t0 + 12 * 60 * 60 * 1000 - 1);
    assert.equal(getToken(), 'tok');
    now.mock.mockImplementation(() => t0 + 12 * 60 * 60 * 1000 + 1);
    assert.equal(getToken(), null);
  } finally {
    now.mock.restore();
    clearSession();
  }
});

test('localStorage that exists but rejects writes (quota / restricted storage) still keeps the session', async () => {
  clearSession();
  const rejecting = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {},
  };
  await withLocalStorage({ value: rejecting, writable: true }, () => {
    saveSession({ token: 'tok', address: '0xabc', host: 'minipay' });
    assert.equal(getToken(), 'tok');
    assert.equal(getAddress(), '0xabc');
    clearSession();
    assert.equal(getToken(), null);
  });
});

test('blocked storage (accessing localStorage throws) falls back to memory', async () => {
  clearSession();
  await withLocalStorage({ get() { throw new Error('SecurityError'); } }, () => {
    saveSession({ token: 'tok', address: '0xabc', host: 'goodwallet' });
    assert.equal(getToken(), 'tok');
    clearSession();
    assert.equal(getToken(), null);
  });
});

test('a working localStorage is used and shared with loadSession', async () => {
  clearSession();
  const data = new Map();
  const working = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
  await withLocalStorage({ value: working, writable: true }, () => {
    saveSession({ token: 'tok', address: '0xabc', host: 'browser' });
    assert.equal(data.size, 1);
    assert.equal(getToken(), 'tok');
    clearSession();
    assert.equal(data.size, 0);
  });
});
