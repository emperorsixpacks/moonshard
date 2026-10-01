import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch } from '../../src/gd/api.js';
import { clearSession, getToken, saveSession } from '../../src/gd/session.js';
import { signIn } from '../../src/gd/auth.js';
import { explainError } from '../../src/gd/format.js';
import { normalizeError } from '../../src/gd/wallet.js';
import { createPendingConfirms } from '../../src/gd/pending.js';

/* Regression tests for an independent review of the client's money paths (see docs/EXECUTION_NOTES.md). */

const H1 = `0x${'11'.repeat(32)}`;
const H2 = `0x${'22'.repeat(32)}`;
const failure = (status, code = 'x') => Object.assign(new Error(code), { status });

/* ---- api: a 2xx that is not JSON (SPA fallback, captive portal, proxy error page) is not a success ---- */

test('a 2xx response whose body is not JSON is an error, not an empty success', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  await assert.rejects(apiFetch('/auth/verify', { fetchImpl }), (err) => err.message === 'bad_response' && err.status === 200);
});

test('a JSON error body is still read when the status is an error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: 'already_claimed' }) });
  await assert.rejects(apiFetch('/x', { fetchImpl }), (err) => err.message === 'already_claimed' && err.status === 409);
});

test('an error status with an unreadable body still reports the status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } });
  await assert.rejects(apiFetch('/x', { fetchImpl }), (err) => err.status === 502);
});

/* ---- session: a rejected write must not leave the OLD session winning ---- */

test('when localStorage rejects the write but holds an older session, the newer in-memory session wins', () => {
  clearSession();
  const holder = new Map([['moonshard.session.v1', JSON.stringify({ token: 'OLD-TOKEN', address: '0xold', host: 'browser', expiresAt: Date.now() + 3_600_000 })]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => holder.get(k) ?? null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: (k) => holder.delete(k),
    },
  });
  try {
    saveSession({ token: 'NEW-TOKEN', address: '0xnew', host: 'browser' });
    assert.equal(getToken(), 'NEW-TOKEN');
  } finally {
    delete globalThis.localStorage;
    clearSession();
  }
});

test('once storage works again the in-memory copy no longer shadows it', () => {
  clearSession();
  const holder = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => holder.get(k) ?? null, setItem: (k, v) => holder.set(k, v), removeItem: (k) => holder.delete(k) },
  });
  try {
    saveSession({ token: 'A', address: '0xa', host: 'browser' });
    saveSession({ token: 'B', address: '0xb', host: 'browser' });
    assert.equal(getToken(), 'B');
    clearSession();
    assert.equal(getToken(), null);
  } finally {
    delete globalThis.localStorage;
    clearSession();
  }
});

/* ---- auth ---- */

test('sign-in remembers the address it asked the wallet to sign for, even if the account switches mid-prompt', async () => {
  clearSession();
  let current = '0xaaaa000000000000000000000000000000000001';
  const calls = [];
  const api = async (path, opts = {}) => {
    calls.push([path, opts.body]);
    if (path === '/auth/nonce') return { nonce: 'ab'.repeat(32), issuedAt: '2026-10-05T12:00:00.000Z' };
    return { token: 'jwt', address: opts.body.address, verified: false, status: 'unverified' };
  };
  const wallet = {
    getState: () => ({ address: current }),
    signMessage: async () => { current = '0xbbbb000000000000000000000000000000000002'; return '0xsig'; },
  };
  await signIn({ wallet, host: 'browser', api });
  assert.equal(calls[1][1].address, '0xaaaa000000000000000000000000000000000001');
  clearSession();
});

test('sign-in refuses a response without a token or address, and stores nothing', async () => {
  clearSession();
  const wallet = { getState: () => ({ address: '0xabc' }), signMessage: async () => '0xsig' };
  for (const bad of [{}, { token: 'jwt' }, { address: '0xabc' }]) {
    const api = async (path) => (path === '/auth/nonce' ? { nonce: 'cd'.repeat(32), issuedAt: 'x' } : bad);
    await assert.rejects(signIn({ wallet, host: 'browser', api }), /bad_response/);
    assert.equal(getToken(), null);
  }
});

/* ---- error text: never leak codes or internals, never mislabel real failures ---- */

test('unmapped machine codes and SDK internals become a generic message', () => {
  for (const msg of ['duration_exceeds_elapsed', 'tx_not_found', "Cannot read properties of undefined (reading 'status')", 'some_new_code']) {
    assert.equal(explainError(new Error(msg)).includes(msg), false, msg);
  }
  assert.equal(explainError(new Error('some_new_code')), 'Something went wrong. Please try again.');
});

test('known codes the UI can actually meet have human text', () => {
  for (const code of ['rate_limited', 'bad_response', 'network_error', 'wallet_timeout', 'vault_mismatch', 'tx_not_found']) {
    const text = explainError(new Error(code));
    assert.notEqual(text, 'Something went wrong. Please try again.', code);
    assert.equal(text.includes(code), false, code);
  }
});

test('offline is not reported as a slow server, and a real timeout still is', () => {
  assert.match(explainError(Object.assign(new Error('network_error'), { status: 0 })), /reach|offline|connection/i);
  assert.match(explainError(Object.assign(new Error('timeout'), { status: 0 })), /slow/i);
});

test('a viem-style shortMessage is shown (it is a human summary), the raw message is not', () => {
  const err = Object.assign(new Error('The total cost exceeds the balance.\n\nRequest Arguments: ...secret-ish detail...'), {
    shortMessage: 'The total cost exceeds the balance of the account.',
  });
  assert.equal(explainError(err), 'The total cost exceeds the balance of the account.');
});

test('"not_claimable" never reaches the player as a raw reason', () => {
  assert.equal(explainError({ message: 'not_claimable', body: { reason: 'not_claimable' } }).includes('not_claimable'), false);
});

test('only a genuine user rejection is called a cancellation', () => {
  assert.equal(normalizeError(Object.assign(new Error('User rejected the request.'), { code: 4001 })).message, 'rejected');
  assert.equal(normalizeError(new Error('User denied transaction signature')).message, 'rejected');
  // real failures that merely contain the same words must keep their meaning
  assert.notEqual(normalizeError(new Error('Permission denied by the RPC node')).message, 'rejected');
  assert.notEqual(normalizeError(new Error('execution reverted: VoucherCancelled')).message, 'rejected');
});

/* ---- pending queue ---- */

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

function queue({ api, address = () => '0xme' } = {}) {
  let t = 1_000_000;
  return {
    pending: createPendingConfirms({ api, tokenFn: () => 'tok', addressFn: address, now: () => t, storage: memoryStore() }),
    advance: (ms) => { t += ms; },
  };
}

test('a missing or malformed hash is never queued and never breaks later entries', async () => {
  const q = queue({ api: async () => { throw failure(0); } });
  const r = await q.pending.confirm('ubi', undefined);
  assert.equal(r.confirmed, false);
  assert.equal(r.queued, false);
  q.pending.add('ubi', 'not-a-hash');
  assert.equal(q.pending.list().length, 0);
  await q.pending.confirm('ubi', H1); // fails -> queued
  await assert.doesNotReject(q.pending.confirm('ubi', H2));
  assert.equal(q.pending.list().length, 2);
});

test('entries belong to the account that made them: another account does not retry or drop them', async () => {
  const calls = [];
  let me = '0xaaa';
  const q = queue({ api: async (_p, o) => { calls.push(o.body.txHash); return { ok: true }; }, address: () => me });
  q.pending.add('ubi', H1);
  me = '0xbbb';
  assert.equal(await q.pending.retryAll(), 0);
  assert.deepEqual(calls, []);
  assert.equal(q.pending.list().length, 1); // still waiting for its owner
  me = '0xaaa';
  assert.equal(await q.pending.retryAll(), 1);
  assert.equal(q.pending.list().length, 0);
});

test('retrying a long queue is parallel, so one dead API cannot hold the UI for N x timeout', async () => {
  let inflight = 0;
  let peak = 0;
  const q = queue({
    api: async () => {
      inflight++;
      peak = Math.max(peak, inflight);
      await new Promise((r) => setTimeout(r, 15));
      inflight--;
      throw failure(0);
    },
  });
  for (let i = 0; i < 6; i++) q.pending.add('ubi', `0x${String(i + 1).padStart(64, '0')}`);
  await q.pending.retryAll();
  assert.ok(peak >= 4, `expected parallel retries, peak concurrency was ${peak}`);
});

test('retry requests carry a short timeout', async () => {
  let seen;
  const q = queue({ api: async (_p, o) => { seen = o.timeoutMs; return { ok: true }; } });
  q.pending.add('ubi', H1);
  await q.pending.retryAll();
  assert.ok(seen > 0 && seen <= 6000, `timeoutMs was ${seen}`);
});

test('a dead session found while retrying is reported once, with the token that was used, and the entries wait', async () => {
  const seen = [];
  const q = queue({ api: async () => { throw failure(401, 'invalid_session'); } });
  q.pending.add('ubi', H1);
  q.pending.add('ubi', H2);
  await q.pending.retryAll({ onUnauthorized: (token) => seen.push(token) });
  assert.deepEqual(seen, ['tok'], 'once, not once per entry');
  assert.equal(q.pending.list().length, 2, 'they wait for the next sign-in');
});

test('no session callback when nothing was unauthorized', async () => {
  const seen = [];
  const q = queue({ api: async () => { throw failure(0); } });
  q.pending.add('ubi', H1);
  await q.pending.retryAll({ onUnauthorized: (token) => seen.push(token) });
  assert.deepEqual(seen, []);
});
