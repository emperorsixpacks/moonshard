import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

// ---------------------------------------------------------------------------------------------
// TLS. How a Postgres connection is secured is decided here, once, and never weaker than "verified".
//
// pg merges the parsed connection string OVER the config object it is given, so passing `ssl: { ca }` next to a URL
// that says `?sslmode=require` silently replaces the CA with `{}`. So this module takes every TLS parameter out of the
// URL, decides `ssl` itself, and hands pg a URL that has nothing left to say about TLS.
//
//   DATABASE_URL                        DATABASE_CA   ->  ssl
//   no sslmode                          unset             false (plain; a loud warning unless the host is local)
//   no sslmode                          PEM text          { ca, rejectUnauthorized: true }
//   sslmode=require|verify-full|...     unset             { rejectUnauthorized: true }
//   sslmode=require|verify-full|...     PEM text          { ca, rejectUnauthorized: true }
//
// require, verify-ca, verify-full, prefer and allow all mean "TLS, certificate and host name verified" here (never
// weaker than libpq's meaning of any of them). sslmode=disable turns TLS off. sslmode=no-verify is refused.
// ---------------------------------------------------------------------------------------------

const VERIFIED_SSLMODES = new Set(["require", "verify-full", "verify-ca", "prefer", "allow"]);
/** TLS URL parameters pg would turn into an ssl object that replaces ours. Anything unlisted that starts with "ssl" is refused. */
const SSL_URL_PARAMS = ["sslmode", "ssl", "uselibpqcompat"];

const refuse = (what, why) => new Error(`Database TLS: ${what} ${why}`);

/** The host to judge "is this connection local?" by. Never throws on something pg would accept. */
function hostOf(head, params, env) {
  const override = params.get("host");
  if (override) return override;
  let text = head;
  if (/ |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(text)) text = encodeURI(text).replace(/%25(\d\d)/g, "%$1");
  let url;
  let dummy = false;
  try {
    url = new URL(text);
  } catch {
    try {
      url = new URL(text.replace("@/", "@___DUMMY___/"));
      dummy = true;
    } catch {
      // Not echoed: the string holds the password.
      throw new Error("DATABASE_URL is not a valid connection string (expected postgres://user:password@host:port/database)");
    }
  }
  let host = "";
  if (!dummy) {
    try { host = decodeURIComponent(url.hostname); } catch { host = url.hostname; }
    host = host.replace(/^\[(.+)\]$/, "$1");
  }
  return host || env.PGHOST || "";
}

/**
 * Node's TLS layer silently ignores a CA it cannot read, which would leave a connection failing with a vague
 * "unable to verify the first certificate" at the first query. Say what is wrong when the server starts instead.
 * The usual mistake is an env var whose line breaks were lost (pasted on one line, or written as \n).
 */
function assertCaPem(ca) {
  const blocks = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  if (blocks.length === 0) {
    throw new Error("DATABASE_CA must be the CA certificate as PEM text (-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----).");
  }
  for (const block of blocks) {
    try {
      new X509Certificate(block);
    } catch {
      throw new Error("DATABASE_CA holds a certificate that cannot be read. As PEM text it needs real line breaks: a value pasted on one line, or with \\n written out, is not valid.");
    }
  }
}

function isLocalHost(host) {
  const h = String(host).toLowerCase();
  return h === "" || h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\.\d+\.\d+\.\d+$/.test(h) || h.startsWith("/");
}

/** Railway Postgres private and TCP-proxy hostnames (suffix match only; notrailway.internal must not match). */
function isRailwayHost(host) {
  const h = String(host).toLowerCase();
  return h.endsWith(".railway.internal") || h.endsWith(".rlwy.net");
}

function railwayTlsWithoutCaMessage(host) {
  const h = String(host).toLowerCase();
  const base =
    "DATABASE_CA must be set to Railway Postgres's CA certificate (PEM text with real line breaks). " +
    "Export it with: railway ssh --service <Postgres service name> -- export-ssl-ca. See docs/DEPLOY.md section 3.";
  if (h.endsWith(".rlwy.net")) {
    return `${base} Prefer the private DATABASE_URL reference (*.railway.internal), not the public TCP proxy.`;
  }
  return base;
}

/**
 * The pg.Pool config for `databaseUrl`: `{ connectionString, ssl }` with every TLS decision taken here.
 * `env` is where DATABASE_CA and PGSSLMODE are read from; `warn` receives the no-TLS warning.
 */
export function pgPoolConfig(databaseUrl, { env = process.env, warn = (m) => console.warn(m) } = {}) {
  const text = String(databaseUrl);
  const q = text.indexOf("?");
  const head = q === -1 ? text : text.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : text.slice(q + 1));

  for (const name of params.keys()) {
    if (/^ssl/i.test(name) && !SSL_URL_PARAMS.includes(name)) {
      throw refuse(`the "${name}" parameter is`, "not supported. Put the CA certificate (PEM text) in DATABASE_CA and use sslmode=require.");
    }
  }
  const urlMode = params.get("sslmode");
  const sslParam = params.get("ssl");
  const host = hostOf(head, params, env);
  const touched = SSL_URL_PARAMS.some((name) => params.has(name));
  for (const name of SSL_URL_PARAMS) params.delete(name);
  const search = params.toString();
  const connectionString = touched ? (search ? `${head}?${search}` : head) : text;

  const ca = typeof env.DATABASE_CA === "string" && env.DATABASE_CA.trim() ? env.DATABASE_CA : null;
  if (ca) assertCaPem(ca);

  // What the operator asked for: the URL first, then the PGSSLMODE variable (as libpq reads them).
  const mode = (urlMode || env.PGSSLMODE || "").toLowerCase();
  let wantTls;
  if (mode === "no-verify" || (!urlMode && sslParam === "no-verify")) {
    throw refuse("sslmode=no-verify", "turns certificate verification off, which this server never does. Use sslmode=require, and DATABASE_CA when the host has a private CA.");
  } else if (mode === "disable") {
    wantTls = false;
  } else if (VERIFIED_SSLMODES.has(mode)) {
    wantTls = true;
  } else if (mode) {
    throw refuse(`sslmode=${mode}`, "is not a known mode (use require, verify-full or disable).");
  } else if (sslParam === "true" || sslParam === "1") {
    wantTls = true;
  } else if (sslParam === "false" || sslParam === "0") {
    wantTls = false;
  } else if (sslParam != null) {
    throw refuse(`ssl=${sslParam}`, "is not understood (use sslmode=require).");
  } else {
    wantTls = Boolean(ca); // a CA only means something for TLS
  }
  if (!wantTls && ca && (mode === "disable" || sslParam != null)) {
    throw new Error("DATABASE_CA is set but TLS is switched off in DATABASE_URL (sslmode=disable / ssl=0). Remove one of them.");
  }

  if (wantTls && !ca && isRailwayHost(host)) {
    throw new Error(railwayTlsWithoutCaMessage(host));
  }

  const ssl = wantTls ? { ...(ca ? { ca } : {}), rejectUnauthorized: true } : false;
  if (!ssl && !isLocalHost(host)) {
    const fix =
      isRailwayHost(host)
        ? "Append ?sslmode=require to DATABASE_URL and set DATABASE_CA (Railway uses a private CA; sslmode=require without DATABASE_CA is refused). See docs/DEPLOY.md section 3."
        : "Append ?sslmode=require to DATABASE_URL (and set DATABASE_CA to the CA certificate PEM if the host uses a private CA).";
    warn(
      `[moonshard] WARNING: the database connection to ${host} is NOT encrypted: the password and all data cross the network in clear text. ${fix}`,
    );
  }
  return { connectionString, ssl };
}

// ---------------------------------------------------------------------------------------------
// Pool and database handle
// ---------------------------------------------------------------------------------------------

/** A pg.Pool for `databaseUrl` that logs, instead of dying on, a connection Postgres drops while it is idle. */
export function createPgPool(pg, databaseUrl, { env = process.env, log = console } = {}) {
  const pool = new pg.Pool(pgPoolConfig(databaseUrl, { env, warn: (m) => log.warn(m) }));
  // Postgres restarting, failing over or timing out an idle connection makes the pool emit 'error'. With no listener
  // Node turns that into an uncaught exception and the whole API goes down. The pool has already removed the dead
  // client; the next query opens a fresh one.
  pool.on("error", (err) => {
    log.error(`[moonshard] postgres: an idle connection was lost and dropped from the pool (${err?.message || err}); new queries reconnect`);
  });
  return pool;
}

/** The `{ query, exec, tx, close }` handle every module uses, over a pg.Pool. */
export function pgDb(pool) {
  return {
    query: (sql, params = []) => pool.query(sql, params),
    exec: (sql) => pool.query(sql), // no parameters: the simple protocol, which accepts several statements
    async tx(fn) {
      const client = await pool.connect();
      // A checked-out client has no pool listener. If its connection drops during the transaction it emits 'error',
      // and with nobody listening that would take the process down; the failing query already rejects.
      let broken = false;
      const onError = () => { broken = true; };
      client.on("error", onError);
      try {
        await client.query("BEGIN");
        const out = await fn({ query: (s, p = []) => client.query(s, p), exec: (s) => client.query(s) });
        await client.query("COMMIT");
        return out;
      } catch (err) {
        // On a dead connection the rollback fails too; the caller must see the original error, not that one.
        try { await client.query("ROLLBACK"); } catch { broken = true; }
        throw err;
      } finally {
        client.removeListener("error", onError);
        client.release(broken); // true: close this connection instead of returning it to the pool
      }
    },
    close: () => pool.end(),
  };
}

/**
 * Postgres in production (DATABASE_URL), in-memory PGlite when the URL is empty.
 * Both speak the same SQL; results expose `{ rows }`.
 */
export async function createDb(databaseUrl, { env = process.env, log = console } = {}) {
  let db;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    db = pgDb(createPgPool(pg, databaseUrl, { env, log }));
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const lite = new PGlite();
    db = {
      query: (sql, params = []) => lite.query(sql, params),
      exec: (sql) => lite.exec(sql),
      tx: (fn) => lite.transaction((t) => fn({ query: (s, p = []) => t.query(s, p), exec: (s) => t.exec(s) })),
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}

// ---------------------------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------------------------

const MIGRATION_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('moonshard.migrations', 0))";

/**
 * Applies the .sql files of `dir` that are not in _migrations yet, in name order. Each file and its _migrations row
 * are ONE transaction: a failure leaves neither behind, and a crash can never leave a file applied but unrecorded
 * (which would make the next start re-run it and fail). The advisory lock, and the re-check under it, make two
 * instances starting together (a rolling deploy) apply a file once instead of racing.
 */
export async function migrate(db, dir = MIGRATIONS_DIR) {
  await db.tx(async (t) => {
    await t.query(MIGRATION_LOCK);
    await t.exec("CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await db.tx(async (t) => {
      await t.query(MIGRATION_LOCK);
      const done = await t.query("SELECT 1 FROM _migrations WHERE name = $1", [f]);
      if (done.rows.length > 0) return;
      await t.exec(sql);
      await t.query("INSERT INTO _migrations(name) VALUES ($1)", [f]);
    });
  }
}
