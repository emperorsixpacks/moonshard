import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingConfirms } from '../../src/gd/pending.js';

const H1 = `0x${'11'.repeat(32)}`;
const H2 = `0x${'22'.repeat(32)}`;
const H3 = `0x${'33'.repeat(32)}`;

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

function harness({ token = 'tok', handler } = {}) {
  let t = 1_000_000;
  const calls = [];
  const state = { token };
  const api = async (path, opts) => {
    calls.push({ path, body: opts.body, token: opts.token });
    return handler(path, opts, calls.length);
  };
  const store = memoryStore();
  const pending = createPendingConfirms({ api, tokenFn: () => state.token, now: () => t, storage: store });
  return { pending, calls, state, advance: (ms) => { t += ms; }, store };
}

const failure = (status, code = 'x') => Object.assign(new Error(code), { status });

test('a confirmed tx is sent to the right endpoint with the session token and is not queued', async () => {
  const h = harness({ handler: async () => ({ ok: true, blessing: true }) });
  const r = await h.pending.confirm('ubi', H1);
  assert.deepEqual({ confirmed: r.confirmed, queued: r.queued }, { confirmed: true, queued: false });
  assert.equal(r.response.blessing, true);
  assert.deepEqual(h.calls[0], { path: '/ubi/confirm', body: { txHash: H1 }, token: 'tok' });
  assert.equal(h.pending.list().length, 0);
});

test('each kind uses its own endpoint', async () => {
  const h = harness({ handler: async () => ({ ok: true }) });
  await h.pending.confirm('engagement', H1);
  await h.pending.confirm('spoil', H2);
  assert.deepEqual(h.calls.map((c) => c.path), ['/engagement/confirm', '/spoils/confirm']);
});

test('network failure / 5xx / throttling / expired session / tx not visible yet are queued, not lost', async () => {
  for (const status of [0, 500, 503, 429, 401, 404]) {
    const h = harness({ handler: async () => { throw failure(status); } });
    const r = await h.pending.confirm('ubi', H1);
    assert.deepEqual({ confirmed: r.confirmed, queued: r.queued }, { confirmed: false, queued: true }, `status ${status}`);
    assert.equal(h.pending.list().length, 1, `status ${status}`);
  }
});

test('a final answer from the server (400/403/409/422) drops the tx instead of retrying forever', async () => {
  for (const status of [400, 403, 409, 422]) {
    const h = harness({ handler: async () => { throw failure(status, 'tx_not_today'); } });
    const r = await h.pending.confirm('ubi', H1);
    assert.equal(r.confirmed, false);
    assert.equal(r.queued, false);
    assert.equal(r.error, 'tx_not_today');
    assert.equal(h.pending.list().length, 0, `status ${status}`);
  }
});

test('without a session the tx is queued and the API is not called', async () => {
  const h = harness({ token: null, handler: async () => ({ ok: true }) });
  const r = await h.pending.confirm('ubi', H1);
  assert.equal(r.queued, true);
  assert.equal(h.calls.length, 0);
});

test('the same tx is never queued twice', async () => {
  const h = harness({ handler: async () => { throw failure(0); } });
  await h.pending.confirm('ubi', H1);
  await h.pending.confirm('ubi', H1);
  assert.equal(h.pending.list().length, 1);
});

test('retryAll confirms queued txs once the server is back and clears them', async () => {
  let down = true;
  const h = harness({ handler: async () => { if (down) throw failure(0); return { ok: true }; } });
  await h.pending.confirm('ubi', H1);
  await h.pending.confirm('spoil', H2);
  assert.equal(h.pending.list().length, 2);
  assert.equal(await h.pending.retryAll(), 0);
  assert.equal(h.pending.list().length, 2);
  down = false;
  assert.equal(await h.pending.retryAll(), 2);
  assert.equal(h.pending.list().length, 0);
});

test('retryAll drops a tx the server now rejects for good, keeps one that is still failing transiently', async () => {
  const h = harness({
    handler: async (_p, opts) => {
      if (opts.body.txHash === H1) throw failure(403, 'not_your_tx');
      throw failure(503);
    },
  });
  await h.pending.confirm('ubi', H1).catch(() => {});
  h.pending.add('ubi', H1);
  h.pending.add('spoil', H2);
  await h.pending.retryAll();
  const left = h.pending.list().map((x) => x.txHash);
  assert.deepEqual(left, [H2]);
});

test('entries older than 24 h are discarded without calling the API', async () => {
  const h = harness({ handler: async () => { throw failure(0); } });
  await h.pending.confirm('ubi', H1);
  h.advance(25 * 3600_000);
  h.calls.length = 0;
  assert.equal(await h.pending.retryAll(), 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.pending.list().length, 0);
});

test('the queue keeps only the 20 newest entries', async () => {
  const h = harness({ handler: async () => { throw failure(0); } });
  for (let i = 0; i < 25; i++) {
    h.advance(1000);
    h.pending.add('ubi', `0x${String(i).padStart(64, '0')}`);
  }
  const list = h.pending.list();
  assert.equal(list.length, 20);
  assert.equal(list.at(-1).txHash, `0x${String(24).padStart(64, '0')}`);
  assert.ok(!list.some((x) => x.txHash === `0x${String(0).padStart(64, '0')}`));
});

test('overlapping retryAll calls do not send a confirmation twice', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ handler: async () => { await gate; return { ok: true }; } });
  h.pending.add('ubi', H3);
  const a = h.pending.retryAll();
  const b = h.pending.retryAll();
  release();
  await Promise.all([a, b]);
  assert.equal(h.calls.length, 1);
});

test('queued entries survive a reload (they are persisted)', async () => {
  const h = harness({ handler: async () => { throw failure(0); } });
  await h.pending.confirm('ubi', H1);
  const reloaded = createPendingConfirms({ api: async () => ({ ok: true }), tokenFn: () => 'tok', now: () => 1_000_000, storage: h.store });
  assert.deepEqual(reloaded.list().map((x) => x.txHash), [H1]);
});

test('corrupt stored data is ignored, not fatal', () => {
  const store = memoryStore();
  store.setItem('moonshard.pending.v1', '{not json');
  const p = createPendingConfirms({ api: async () => ({}), tokenFn: () => 'tok', now: () => 1, storage: store });
  assert.deepEqual(p.list(), []);
});
