import test from "node:test";
import assert from "node:assert/strict";
import { makeHarness } from "./helpers.js";

test("health and public config", async () => {
  const h = await makeHarness();
  try {
    const health = await fetch(`${h.base}/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    const cfg = await h.api.get("/config");
    assert.equal(cfg.status, 200);
    assert.deepEqual(cfg.body.prizesG, ["1000", "600", "300"]);
    assert.equal(cfg.body.shardRateG, "2");
    assert.equal(cfg.body.dailyShardCap, 50);
    assert.equal(cfg.body.chainId, 42220);
    assert.match(cfg.body.engagement.app, /^0x[0-9a-fA-F]{40}$/);
  } finally {
    await h.close();
  }
});

test("unknown JSON body returns 400, not a stack trace", async () => {
  const h = await makeHarness();
  try {
    const res = await fetch(`${h.base}/api/config`, { method: "POST", headers: { "content-type": "application/json" }, body: "{bad" });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "bad_json" });
  } finally {
    await h.close();
  }
});
