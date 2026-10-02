import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshCooldown } from "../src/auth.js";

/* The per-key cooldown behind /me/refresh and /runs/start: it admits a key once per window, and can say how long is left. */

const make = (cooldownMs = 10_000) => {
  let t = 1_000_000;
  const cooldown = createRefreshCooldown({ now: () => t, cooldownMs });
  return { cooldown, advance: (ms) => { t += ms; } };
};

test("a key that was never admitted has nothing to wait for", () => {
  const { cooldown } = make();
  assert.equal(cooldown.retryAfterMs("alice"), 0);
});

test("after a key is admitted, the wait counts down to zero at the end of the window", () => {
  const { cooldown, advance } = make(10_000);
  assert.equal(cooldown.tryAcquire("alice"), true);
  assert.equal(cooldown.retryAfterMs("alice"), 10_000);
  advance(4_000);
  assert.equal(cooldown.retryAfterMs("alice"), 6_000);
  advance(5_999);
  assert.equal(cooldown.retryAfterMs("alice"), 1);
  advance(1);
  assert.equal(cooldown.retryAfterMs("alice"), 0);
  assert.equal(cooldown.tryAcquire("alice"), true, "and at that moment the key is admitted again");
});

test("a refused call neither restarts the window nor changes the wait", () => {
  const { cooldown, advance } = make(10_000);
  cooldown.tryAcquire("alice");
  advance(3_000);
  assert.equal(cooldown.tryAcquire("alice"), false);
  assert.equal(cooldown.retryAfterMs("alice"), 7_000);
  advance(3_000);
  assert.equal(cooldown.tryAcquire("alice"), false);
  assert.equal(cooldown.retryAfterMs("alice"), 4_000);
});

test("keys do not share a wait", () => {
  const { cooldown, advance } = make(10_000);
  cooldown.tryAcquire("alice");
  advance(2_000);
  cooldown.tryAcquire("bob");
  assert.equal(cooldown.retryAfterMs("alice"), 8_000);
  assert.equal(cooldown.retryAfterMs("bob"), 10_000);
});
