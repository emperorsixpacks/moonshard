import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness } from "./helpers.js";

// Finding 11. A body over 64 kb, an unsupported charset or content-encoding, or malformed JSON is the CLIENT's
// mistake. They used to come back as 500 internal_error with a stack trace in the log, which looks like a server
// fault, fills the log with attacker-chosen noise, and trips alerting on 5xx. They are 4xx now, with a stable code.

/** Runs `fn` with console.error / console.debug recorded instead of printed. */
async function capturingConsole(fn) {
  const calls = { error: [], debug: [] };
  const real = { error: console.error, debug: console.debug };
  console.error = (...a) => calls.error.push(a);
  console.debug = (...a) => calls.debug.push(a);
  try { return { result: await fn(), calls }; } finally { console.error = real.error; console.debug = real.debug; }
}

const post = (h, path, { body = "{}", headers = {} } = {}) =>
  fetch(`${h.base}/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body })
    .then(async (res) => ({ status: res.status, body: await res.json().catch(() => null) }));

test("a body over 64 kb is a 413 payload_too_large, not a logged 500", async () => {
  const h = await makeHarness();
  try {
    const { result, calls } = await capturingConsole(() => post(h, "/auth/verify", { body: JSON.stringify({ pad: "x".repeat(70_000) }) }));
    assert.equal(result.status, 413);
    assert.deepEqual(result.body, { error: "payload_too_large" });
    assert.equal(calls.error.length, 0, "no stack trace for a client mistake");
  } finally { await h.close(); }
});

test("an unsupported charset or content-encoding is a 415 unsupported_media", async () => {
  const h = await makeHarness();
  try {
    const { result: charset, calls } = await capturingConsole(() =>
      post(h, "/auth/verify", { headers: { "content-type": "application/json; charset=bogus" } }));
    assert.equal(charset.status, 415);
    assert.deepEqual(charset.body, { error: "unsupported_media" });

    const { result: encoding, calls: calls2 } = await capturingConsole(() =>
      post(h, "/auth/verify", { headers: { "content-encoding": "weird" } }));
    assert.equal(encoding.status, 415);
    assert.deepEqual(encoding.body, { error: "unsupported_media" });
    assert.equal(calls.error.length + calls2.error.length, 0);
  } finally { await h.close(); }
});

test("malformed JSON stays a 400 bad_json, quietly", async () => {
  const h = await makeHarness();
  try {
    const { result, calls } = await capturingConsole(() => post(h, "/auth/verify", { body: "{bad" }));
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { error: "bad_json" });
    assert.equal(calls.error.length, 0);
  } finally { await h.close(); }
});

test("any other 4xx raised by the framework passes through with its status (a path that cannot be decoded is a 400)", async () => {
  const h = await makeHarness();
  try {
    const { result, calls } = await capturingConsole(() => post(h, "/runs/%E0%A4%A/submit"));
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { error: "bad_request" });
    assert.equal(calls.error.length, 0);
  } finally { await h.close(); }
});

test("client errors are logged at debug level only", async () => {
  const h = await makeHarness();
  const previous = process.env.LOG_LEVEL;
  try {
    delete process.env.LOG_LEVEL;
    const quiet = await capturingConsole(() => post(h, "/auth/verify", { body: "{bad" }));
    assert.equal(quiet.calls.debug.length, 0, "silent by default");

    process.env.LOG_LEVEL = "debug";
    const loud = await capturingConsole(() => post(h, "/auth/verify", { body: "{bad" }));
    assert.equal(loud.result.status, 400);
    assert.equal(loud.calls.error.length, 0, "never at error level");
    assert.equal(loud.calls.debug.length, 1);
    assert.match(String(loud.calls.debug[0].join(" ")), /400.*bad_json.*\/api\/auth\/verify/);
  } finally {
    if (previous === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previous;
    await h.close();
  }
});

test("a real server fault is still a logged 500 internal_error, with no detail in the response", async () => {
  const h = await makeHarness();
  try {
    h.db.query = () => Promise.reject(new Error("db exploded: secret detail"));
    const { result, calls } = await capturingConsole(() => h.api.get("/stats"));
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: "internal_error" });
    assert.equal(calls.error.length, 1);
    assert.match(String(calls.error[0][1]), /db exploded/);
  } finally { await h.close(); }
});

test("an application error and a chain outage keep their own answers", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    const { result, calls } = await capturingConsole(() => h.api.post("/runs/start", { mode: "NOPE" }, { token: p.token }));
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { error: "bad_mode" });
    h.chain.identity = async () => { throw new Error("rpc down"); };
    h.clock.advance(60 * 60_000);
    const down = await h.api.get("/me", { token: p.token });
    assert.equal(down.status, 503);
    assert.deepEqual(down.body, { error: "chain_unavailable" });
    assert.equal(calls.error.length, 0);
  } finally { await h.close(); }
});
