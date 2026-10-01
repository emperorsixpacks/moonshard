import test from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../src/db.js";

const TABLES = [
  "nonces", "users", "wallets", "runs", "run_checkpoints", "scores", "shard_days",
  "settled_days", "spoils", "spoil_claims", "ubi_claims", "blessings", "engagement_claims",
];

test("migrations create every table", async () => {
  const db = await createDb("");
  for (const t of TABLES) {
    const r = await db.query("SELECT to_regclass($1::text) AS t", [t]);
    assert.ok(r.rows[0].t, `missing table ${t}`);
  }
  const m = await db.query("SELECT count(*)::int AS n FROM _migrations");
  assert.equal(m.rows[0].n, 1);
  await db.close();
});

test("tx commits on success and rolls back on error", async () => {
  const db = await createDb("");
  await db.tx(async (t) => {
    await t.query("INSERT INTO users(subject) VALUES ($1)", ["0xaa"]);
  });
  await assert.rejects(
    db.tx(async (t) => {
      await t.query("INSERT INTO users(subject) VALUES ($1)", ["0xbb"]);
      throw new Error("boom");
    }),
    /boom/,
  );
  const r = await db.query("SELECT subject FROM users ORDER BY subject");
  assert.deepEqual(r.rows.map((x) => x.subject), ["0xaa"]);
  await db.close();
});
