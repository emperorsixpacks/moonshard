import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { makeHarness } from "./helpers.js";

// Finding 14: small things a scanner or a curious visitor sees.

const get = (h, path, headers = {}) => fetch(`${h.base}${path}`, { headers });

/** Builds an app the way a deployment with this NODE_ENV and CORS_ORIGINS would, and records the warnings it prints. */
async function harnessWith({ nodeEnv, corsOrigins }) {
  const warnings = [];
  const real = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    const h = await makeHarness({ env: { NODE_ENV: nodeEnv }, config: { corsOrigins } });
    return { h, warnings };
  } finally { console.warn = real; }
}

test("the X-Powered-By header does not announce Express", async () => {
  const h = await makeHarness();
  try {
    for (const path of ["/health", "/api/config", "/api/stats", "/nope"]) {
      assert.equal((await get(h, path)).headers.get("x-powered-by"), null, path);
    }
    assert.equal(h.ctx.config.corsOrigins, "*", "premise: the default harness leaves CORS_ORIGINS unset");
  } finally { await h.close(); }
});

test("CORS in development (CORS_ORIGINS unset) still reflects the caller's origin", async () => {
  const { h } = await harnessWith({ nodeEnv: undefined, corsOrigins: "*" });
  try {
    const res = await get(h, "/api/config", { origin: "http://localhost:5173" });
    assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
    for (const nodeEnv of ["development", "test"]) {
      const other = await harnessWith({ nodeEnv, corsOrigins: "*" });
      try {
        const r = await get(other.h, "/api/config", { origin: "https://anywhere.example" });
        assert.equal(r.headers.get("access-control-allow-origin"), "https://anywhere.example", nodeEnv);
      } finally { await other.h.close(); }
    }
  } finally { await h.close(); }
});

test("CORS in production with CORS_ORIGINS unset sends no CORS headers at all, and says why at start-up", async () => {
  const { h, warnings } = await harnessWith({ nodeEnv: "production", corsOrigins: "*" });
  try {
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /CORS_ORIGINS/);

    const res = await get(h, "/api/config", { origin: "https://evil.example" });
    assert.equal(res.status, 200, "the API itself keeps working");
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);

    const preflight = await fetch(`${h.base}/api/runs/start`, {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
    assert.equal(preflight.headers.get("access-control-allow-headers"), null);
  } finally { await h.close(); }
});

test("an explicit CORS_ORIGINS list works in production, for the listed origins only", async () => {
  const { h, warnings } = await harnessWith({ nodeEnv: "production", corsOrigins: ["https://moonshard.example"] });
  try {
    assert.equal(warnings.length, 0);
    const ok = await get(h, "/api/config", { origin: "https://moonshard.example" });
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://moonshard.example");
    const other = await get(h, "/api/config", { origin: "https://evil.example" });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  } finally { await h.close(); }
});

test("a literal * in CORS_ORIGINS is the same as unset: reflected in development, nothing in production", async () => {
  const dev = await harnessWith({ nodeEnv: undefined, corsOrigins: ["*"] });
  const prod = await harnessWith({ nodeEnv: "production", corsOrigins: ["*"] });
  try {
    assert.equal((await get(dev.h, "/api/config", { origin: "https://a.example" })).headers.get("access-control-allow-origin"), "https://a.example");
    assert.equal((await get(prod.h, "/api/config", { origin: "https://a.example" })).headers.get("access-control-allow-origin"), null);
    assert.equal(prod.warnings.length, 1);
  } finally { await dev.h.close(); await prod.h.close(); }
});

test("session tokens are accepted only with the algorithm the server signs with", async () => {
  const h = await makeHarness();
  try {
    const p = await h.newPlayer();
    assert.equal((await h.api.get("/me", { token: p.token })).status, 200);
    const claims = { sub: p.address, host: "browser" };
    const hs512 = jwt.sign(claims, h.config.jwtSecret, { algorithm: "HS512", expiresIn: 60 });
    const forged = await h.api.get("/me", { token: hs512 });
    assert.equal(forged.status, 401);
    assert.equal(forged.body.error, "invalid_session");
    const hs256 = jwt.sign(claims, h.config.jwtSecret, { algorithm: "HS256", expiresIn: 60 });
    assert.equal((await h.api.get("/me", { token: hs256 })).status, 200);
  } finally { await h.close(); }
});
