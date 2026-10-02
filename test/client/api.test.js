import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFetch } from '../../src/gd/api.js';

const resp = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('builds the URL, sends bearer token and JSON body', async () => {
  let seen;
  const out = await apiFetch('/runs/start', {
    method: 'POST', token: 'tok', body: { a: 1 }, base: 'https://x.test',
    fetchImpl: async (url, init) => { seen = { url, init }; return resp(200, { ok: true }); },
  });
  assert.equal(seen.url, 'https://x.test/api/runs/start');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(seen.init.body, '{"a":1}');
  assert.deepEqual(out, { ok: true });
});

test('an API root with a trailing slash (a very easy thing to paste into a build setting) still reaches /api/...', async () => {
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return resp(200, { ok: true }); };
  for (const base of ['https://x.test/', 'https://x.test//', 'https://x.test', '']) await apiFetch('/config', { base, fetchImpl });
  assert.deepEqual(seen, ['https://x.test/api/config', 'https://x.test/api/config', 'https://x.test/api/config', '/api/config']);
});

test('HTTP errors become Error(code) with status and body', async () => {
  await assert.rejects(
    apiFetch('/x', { fetchImpl: async () => resp(409, { error: 'already_claimed', reason: 'r' }) }),
    (err) => err.message === 'already_claimed' && err.status === 409 && err.body.reason === 'r',
  );
});

test('network failure is status 0', async () => {
  await assert.rejects(
    apiFetch('/x', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    (err) => err.status === 0,
  );
});

test('slow server is aborted and reported as timeout, status 0', async () => {
  const fetchImpl = (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    apiFetch('/x', { fetchImpl, timeoutMs: 20 }),
    (err) => err.message === 'timeout' && err.status === 0,
  );
});
