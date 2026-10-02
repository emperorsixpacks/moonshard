import test from "node:test";
import assert from "node:assert/strict";
import { assertSecureConfig } from "../src/boot.js";

// A production boot must refuse configurations that start fine and then quietly lose or withhold money-relevant data.
// Review findings: with NODE_ENV=production and no DATABASE_URL the API ran on an in-memory database (scores, settled
// days and unredeemed Spoils vanish on the next restart) and said only "db in-memory"; with VAULT_ADDRESS set and no
// VOUCHER_SIGNER_KEY it settled prizes, showed them to the winners, and could never sign one ("unavailable").

const SECRET = "a-long-random-looking-secret-0123456789abcdef";
const VAULT = "0x1111111111111111111111111111111111111111";
const good = (over = {}) => ({ jwtSecret: SECRET, databaseUrl: "postgres://u:p@db.example/moonshard?sslmode=require", contracts: { vault: VAULT }, voucherSignerKey: "0xabc", ...over });
const production = { NODE_ENV: "production" };
const warnings = () => { const seen = []; return { warn: (m) => seen.push(m), seen }; };

test("a complete production configuration boots without a word", () => {
  const w = warnings();
  assert.doesNotThrow(() => assertSecureConfig(good(), { env: production, warn: w.warn }));
  assert.deepEqual(w.seen, []);
});

test("production without a database is refused, and the message says why and what to set", () => {
  for (const databaseUrl of ["", undefined, "   "]) {
    assert.throws(
      () => assertSecureConfig(good({ databaseUrl }), { env: production }),
      (err) => /DATABASE_URL/.test(err.message) && /lost|vanish|memory/i.test(err.message),
      JSON.stringify(databaseUrl),
    );
  }
});

test("...unless the person says on purpose that this production-mode server is a throwaway demo", () => {
  assert.doesNotThrow(() => assertSecureConfig(good({ databaseUrl: "" }), { env: { ...production, ALLOW_IN_MEMORY_DB: "1" } }));
  assert.throws(() => assertSecureConfig(good({ databaseUrl: "" }), { env: { ...production, ALLOW_IN_MEMORY_DB: "0" } }), /DATABASE_URL/);
});

test("outside production an in-memory database is the normal development setup", () => {
  for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test" }]) {
    assert.doesNotThrow(() => assertSecureConfig(good({ databaseUrl: "" }), { env }), JSON.stringify(env));
  }
});

test("production with a vault but no key to sign vouchers is refused", () => {
  for (const voucherSignerKey of ["", undefined]) {
    assert.throws(
      () => assertSecureConfig(good({ voucherSignerKey }), { env: production }),
      (err) => /VOUCHER_SIGNER_KEY/.test(err.message) && /VAULT_ADDRESS/.test(err.message),
      JSON.stringify(voucherSignerKey),
    );
  }
});

test("...but with no vault there is nothing to sign: a server without Spoils is a valid (if limited) deployment", () => {
  assert.doesNotThrow(() => assertSecureConfig(good({ contracts: { vault: "" }, voucherSignerKey: "" }), { env: production }));
  assert.doesNotThrow(() => assertSecureConfig(good({ contracts: {}, voucherSignerKey: undefined }), { env: production }));
});

test("outside production a vault without a signer boots with a loud warning instead", () => {
  const w = warnings();
  assert.doesNotThrow(() => assertSecureConfig(good({ voucherSignerKey: "" }), { env: {}, warn: w.warn }));
  assert.equal(w.seen.length, 1);
  assert.match(w.seen[0], /VOUCHER_SIGNER_KEY/);
});

test("the JWT secret rules still come first", () => {
  assert.throws(() => assertSecureConfig(good({ jwtSecret: "short" }), { env: production }), /JWT_SECRET/);
});
