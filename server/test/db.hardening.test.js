import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDb, createPgPool, migrate, pgPoolConfig } from "../src/db.js";

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------------------------
// Finding 4: TLS. pg merges the parsed connection string OVER the config object, so `?sslmode=require` replaced
// `ssl: { ca }` and the documented private-CA setup silently lost its CA; and with no sslmode there was no TLS at all.
// pgPoolConfig() parses the URL itself and decides `ssl` last. What pg will really use is read back from a Client:
// its connectionParameters are what the pool's connections are built from.
// ---------------------------------------------------------------------------------------------

const CA = "-----BEGIN CERTIFICATE-----\nMIIBtestonlyNotARealCertificateButPEMShaped\n-----END CERTIFICATE-----\n";
const PASSWORD = "hunter2-Zq9";
const REMOTE = `postgres://app:${PASSWORD}@db.example.com:5432/moonshard`;

const quietLog = () => {
  const lines = [];
  return { lines, log: { error: (...a) => lines.push(a.join(" ")), warn: (...a) => lines.push(a.join(" ")) } };
};

function build(url, env = {}) {
  const warnings = [];
  const config = pgPoolConfig(url, { env, warn: (m) => warnings.push(m) });
  return { config, warnings, params: new pg.Client(config).connectionParameters };
}

test("TLS premise: handing pg both a connection string with sslmode and an ssl object loses the object (the bug)", () => {
  // This is the old db.js. If pg ever stops doing this, pgPoolConfig's care is merely redundant, not wrong.
  const old = new pg.Client({ connectionString: `${REMOTE}?sslmode=require`, ssl: { ca: CA } }).connectionParameters;
  assert.equal(old.ssl.ca, undefined, "the CA was dropped");
});

test("TLS: sslmode x DATABASE_CA, the four combinations", () => {
  // 1. neither: plain connection. Allowed (a private network), but loud for a remote host.
  const plain = build(REMOTE);
  assert.equal(plain.params.ssl, false);
  assert.equal(plain.warnings.length, 1);

  // 2. sslmode=require, public CA: verified TLS against the system trust store.
  const required = build(`${REMOTE}?sslmode=require`);
  assert.deepEqual(required.params.ssl, { rejectUnauthorized: true });
  assert.equal(required.warnings.length, 0);

  // 3. sslmode=require + DATABASE_CA: the case that used to lose the CA.
  const withCa = build(`${REMOTE}?sslmode=require`, { DATABASE_CA: CA });
  assert.deepEqual(withCa.params.ssl, { ca: CA, rejectUnauthorized: true });
  assert.equal(withCa.warnings.length, 0);

  // 4. DATABASE_CA alone: a CA is only meaningful for TLS, so TLS is on.
  const caOnly = build(REMOTE, { DATABASE_CA: CA });
  assert.deepEqual(caOnly.params.ssl, { ca: CA, rejectUnauthorized: true });
  assert.equal(caOnly.warnings.length, 0);
});

test("TLS: every strict sslmode means verified TLS, and verification is explicit so NODE_TLS_REJECT_UNAUTHORIZED=0 cannot undo it", () => {
  for (const mode of ["require", "verify-full", "verify-ca", "prefer", "allow"]) {
    const { params } = build(`${REMOTE}?sslmode=${mode}`);
    assert.equal(params.ssl.rejectUnauthorized, true, mode);
  }
});

test("TLS: verification can never be switched off", () => {
  assert.throws(() => pgPoolConfig(`${REMOTE}?sslmode=no-verify`, { env: {}, warn() {} }), /verif/i);
  assert.throws(() => pgPoolConfig(REMOTE, { env: { PGSSLMODE: "no-verify" }, warn() {} }), /verif/i);
  assert.throws(() => pgPoolConfig(`${REMOTE}?sslmode=banana`, { env: {}, warn() {} }), /sslmode/);
  // libpq-compat mode would turn `require` into unverified TLS inside pg-connection-string: it is not passed on
  const compat = build(`${REMOTE}?sslmode=require&uselibpqcompat=true`);
  assert.equal(compat.params.ssl.rejectUnauthorized, true);
  // an ssl object in the URL cannot be smuggled in through the other TLS parameters either
  for (const param of ["sslrootcert=/etc/ca.pem", "sslcert=/c.pem", "sslkey=/k.pem", "sslnegotiation=direct"]) {
    assert.throws(() => pgPoolConfig(`${REMOTE}?${param}`, { env: {}, warn() {} }), /DATABASE_CA|not supported/, param);
  }
});

test("TLS: sslmode=disable is honoured (loudly), but not together with a CA; ssl=true means verified TLS", () => {
  const off = build(`${REMOTE}?sslmode=disable`);
  assert.equal(off.params.ssl, false);
  assert.equal(off.warnings.length, 1);
  assert.throws(() => pgPoolConfig(`${REMOTE}?sslmode=disable`, { env: { DATABASE_CA: CA }, warn() {} }), /DATABASE_CA/);
  assert.deepEqual(build(`${REMOTE}?ssl=true`).params.ssl, { rejectUnauthorized: true });
  assert.equal(build(`${REMOTE}?ssl=0`).params.ssl, false);
});

test("TLS: PGSSLMODE in the environment is read the way libpq reads it, URL first", () => {
  assert.deepEqual(build(REMOTE, { PGSSLMODE: "require" }).params.ssl, { rejectUnauthorized: true });
  assert.equal(build(`${REMOTE}?sslmode=disable`, { PGSSLMODE: "require" }).params.ssl, false, "the URL wins");
  assert.equal(build(REMOTE, { PGSSLMODE: "" }).params.ssl, false);
});

test("TLS: the no-TLS warning is for remote hosts only, says how to fix it, and never prints the password", () => {
  for (const url of [
    "postgres://u:p@localhost:5432/d",
    "postgres://u:p@LOCALHOST/d",
    "postgres://u:p@127.0.0.1/d",
    "postgres://u:p@127.1.2.3/d",
    "postgres://u:p@[::1]:5432/d",
    "postgres:///d?host=/var/run/postgresql",
    "postgres://u:p@%2Fvar%2Frun%2Fpostgresql/d",
  ]) {
    assert.equal(build(url).warnings.length, 0, url);
  }
  const { warnings } = build(REMOTE);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /sslmode=require/);
  assert.match(warnings[0], /db\.example\.com/);
  assert.ok(!warnings[0].includes(PASSWORD), "the password stays out of the log");
  // a private-network Postgres also gets the warning: it is the operator's call to accept it
  assert.equal(build("postgres://u:p@postgres.railway.internal:5432/railway").warnings.length, 1);
});

test("TLS: the rest of the connection string reaches pg untouched", () => {
  const { params, config } = build(
    `postgres://app:${encodeURIComponent("p@ss/w:rd")}@db.example.com:6543/moonshard?sslmode=require&application_name=moonshard-api`,
  );
  assert.equal(params.host, "db.example.com");
  assert.equal(params.port, 6543);
  assert.equal(params.user, "app");
  assert.equal(params.password, "p@ss/w:rd");
  assert.equal(params.database, "moonshard");
  assert.equal(params.application_name, "moonshard-api");
  assert.ok(!/sslmode/.test(config.connectionString), "no TLS parameter is left for pg to merge over ssl");
});

test("TLS: a malformed URL or CA fails with a message that does not echo the secret", () => {
  for (const url of ["not a url", "postgres://u:hunter2-Zq9@[bad/d"]) {
    try {
      pgPoolConfig(url, { env: {}, warn() {} });
      assert.fail(`expected ${url} to be rejected`);
    } catch (err) {
      assert.ok(!String(err.message).includes("hunter2"), err.message);
      assert.match(err.message, /DATABASE_URL/);
    }
  }
  assert.throws(() => pgPoolConfig(`${REMOTE}?sslmode=require`, { env: { DATABASE_CA: "not a certificate" }, warn() {} }), /DATABASE_CA.*PEM/s);
});

// The real thing: a Postgres stand-in that answers SSLRequest with a certificate signed by a private CA. Needs the
// `openssl` command to mint the throwaway CA, and is skipped where there is none.
async function makeTestCerts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonshard-tls-"));
  const openssl = (args) => new Promise((resolve, reject) => {
    execFile("openssl", args, { cwd: dir }, (err) => (err ? reject(err) : resolve()));
  });
  try {
    await openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "ca.key"]);
    await openssl(["req", "-x509", "-new", "-key", "ca.key", "-sha256", "-days", "2", "-subj", "/CN=Moonshard Test CA", "-out", "ca.pem"]);
    await openssl(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "server.key"]);
    await openssl(["req", "-new", "-key", "server.key", "-subj", "/CN=localhost", "-out", "server.csr"]);
    fs.writeFileSync(path.join(dir, "ext.cnf"), "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n");
    await openssl(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.pem", "-days", "2", "-sha256", "-extfile", "ext.cnf"]);
    const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
    return { ca: read("ca.pem"), key: read("server.key"), cert: read("server.pem") };
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("TLS end to end: a Postgres with a private CA connects with sslmode=require + DATABASE_CA, and refuses without the CA", async (t) => {
  const certs = await makeTestCerts();
  if (!certs) return t.skip("openssl is not available to mint a test CA");
  const { default: net } = await import("node:net");
  const { default: tls } = await import("node:tls");
  const sslRequest = 80877103;
  const startupReply = Buffer.concat([Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]), Buffer.from([0x5a, 0, 0, 0, 5, 0x49])]);
  const server = net.createServer((raw) => {
    raw.on("error", () => {});
    raw.once("data", (buf) => {
      if (buf.length !== 8 || buf.readInt32BE(4) !== sslRequest) return raw.destroy();
      raw.write("S");
      const secure = new tls.TLSSocket(raw, { isServer: true, key: certs.key, cert: certs.cert });
      secure.on("error", () => {});
      secure.once("data", () => secure.write(startupReply));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `postgres://u:p@localhost:${server.address().port}/d?sslmode=require`;
  const attempt = async (env) => {
    const pool = createPgPool(pg, url, { env, log: quietLog().log });
    try {
      (await pool.connect()).release();
      return "connected";
    } catch (err) {
      return err.message;
    } finally { await pool.end().catch(() => {}); }
  };
  try {
    assert.equal(await attempt({ DATABASE_CA: certs.ca }), "connected", "the private CA is honoured");
    assert.match(await attempt({}), /unable to verify|self.signed|certificate/i, "without the CA the certificate is not trusted");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

// ---------------------------------------------------------------------------------------------
// Finding 3: a connection that Postgres drops while it sits idle in the pool (restart, failover, idle timeout) emits
// 'error' on the pool; with no listener Node treats that as an uncaught exception and the API dies.
// ---------------------------------------------------------------------------------------------

test("pool: an 'error' on the pool is logged and does not throw", async () => {
  const { lines, log } = quietLog();
  const pool = createPgPool(pg, `postgres://app:${PASSWORD}@127.0.0.1:5432/d`, { env: {}, log });
  try {
    assert.ok(pool.listenerCount("error") >= 1, "the pool has an error listener");
    assert.doesNotThrow(() => pool.emit("error", new Error("terminating connection due to administrator command")));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /terminating connection due to administrator command/);
    assert.ok(!lines[0].includes(PASSWORD));
  } finally { await pool.end(); }
});

/** Runs `code` as an ES module in server/ and resolves with how it ended. */
function runChild(code, timeoutMs = 20_000) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // set by `node --test` for its own children
  return new Promise((resolve) => {
    execFile(process.execPath, ["--input-type=module", "-e", code], { cwd: SERVER_DIR, env, timeout: timeoutMs, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      resolve({ code: error ? (error.killed ? "timeout" : error.code) : 0, stdout, stderr });
    });
  });
}

// A stand-in Postgres: completes the start-up handshake, answers BEGIN, and drops the connection on the next
// statement (or, with idle=true, 50 ms after connecting).
const FAKE_PG = `
import net from "node:net";
import pg from "pg";
import { createPgPool, pgDb } from "./src/db.js";
const idle = process.env.FAKE_PG_MODE === "idle";
let sockets = [];
const srv = net.createServer((s) => {
  sockets.push(s);
  let started = false;
  s.on("error", () => {});
  s.on("data", (buf) => {
    if (!started) {
      started = true;
      s.write(Buffer.concat([Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]), Buffer.from([0x5a, 0, 0, 0, 5, 0x49])]));
      return;
    }
    if (buf[0] !== 0x51) return;
    if (/^BEGIN/.test(buf.subarray(5, buf.length - 1).toString())) {
      const tag = Buffer.from("BEGIN\\0");
      const done = Buffer.concat([Buffer.from([0x43, 0, 0, 0, 4 + tag.length]), tag]);
      s.write(Buffer.concat([done, Buffer.from([0x5a, 0, 0, 0, 5, 0x54])]));
    } else {
      setTimeout(() => s.destroy(), 20);
    }
  });
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const logged = [];
const pool = createPgPool(pg, "postgres://u:p@127.0.0.1:" + srv.address().port + "/d", { env: {}, log: { error: (...a) => logged.push(a.join(" ")), warn() {} } });
`;

test("pool: a real dropped idle connection no longer kills the process", async () => {
  const r = await runChild(`${FAKE_PG}
    const c = await pool.connect();
    c.release();
    setTimeout(() => sockets.forEach((s) => s.destroy()), 50);
    setTimeout(() => { console.log("ALIVE " + JSON.stringify(logged)); process.exit(0); }, 700);
  `);
  assert.equal(r.code, 0, `the process died:\n${r.stderr.slice(0, 600)}`);
  assert.match(r.stdout, /ALIVE/);
  assert.match(r.stdout, /Connection terminated unexpectedly/, "the drop was logged");
});

test("tx: a connection lost inside a transaction rejects with the real error and does not kill the process", async () => {
  const r = await runChild(`${FAKE_PG}
    const db = pgDb(pool);
    let message = null;
    try {
      await db.tx(async (t) => { await t.query("INSERT INTO t VALUES (1)"); });
    } catch (err) { message = err.message; }
    setTimeout(() => { console.log("ALIVE " + JSON.stringify({ message })); process.exit(0); }, 400);
  `);
  assert.equal(r.code, 0, `the process died:\n${r.stderr.slice(0, 600)}`);
  assert.match(r.stdout, /ALIVE/);
  assert.match(r.stdout, /Connection terminated unexpectedly/, "the caller sees the query error, not the rollback's");
});

// ---------------------------------------------------------------------------------------------
// Finding 14: a migration file and its _migrations row are one transaction.
// ---------------------------------------------------------------------------------------------

function migrationsDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moonshard-migrations-"));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}
const regclass = async (db, name) => (await db.query("SELECT to_regclass($1::text) AS t", [name])).rows[0].t;
const recorded = async (db) => (await db.query("SELECT name FROM _migrations ORDER BY name")).rows.map((r) => r.name);

test("migrate: if recording a file fails, the file's changes are rolled back with it", async () => {
  const db = await createDb("");
  try {
    const dir = migrationsDir({ "900_widgets.sql": "CREATE TABLE widgets (id int primary key);\nINSERT INTO widgets VALUES (1);" });
    const failsToRecord = {
      ...db,
      tx: (fn) => db.tx((t) => fn({
        ...t,
        query: (sql, params) => (/INSERT INTO _migrations/.test(sql) ? Promise.reject(new Error("disk full")) : t.query(sql, params)),
      })),
    };
    await assert.rejects(migrate(failsToRecord, dir), /disk full/);
    assert.equal(await regclass(db, "widgets"), null, "no half-applied migration left behind");
    assert.ok(!(await recorded(db)).includes("900_widgets.sql"));

    await migrate(db, dir); // a healthy retry applies it, exactly once
    assert.ok(await regclass(db, "widgets"));
    assert.equal((await recorded(db)).filter((n) => n === "900_widgets.sql").length, 1);
  } finally { await db.close(); }
});

test("migrate: a file that fails half way leaves nothing behind, and later files are not run", async () => {
  const db = await createDb("");
  try {
    const dir = migrationsDir({
      "900_a.sql": "CREATE TABLE mig_a (x int);",
      "901_bad.sql": "CREATE TABLE mig_b (x int);\nINSERT INTO does_not_exist VALUES (1);",
      "902_c.sql": "CREATE TABLE mig_c (x int);",
    });
    await assert.rejects(migrate(db, dir), /does_not_exist/);
    assert.ok(await regclass(db, "mig_a"), "the file before it stays applied");
    assert.equal(await regclass(db, "mig_b"), null);
    assert.equal(await regclass(db, "mig_c"), null);
    const names = await recorded(db);
    assert.ok(names.includes("900_a.sql"));
    assert.ok(!names.includes("901_bad.sql") && !names.includes("902_c.sql"));
  } finally { await db.close(); }
});

test("migrate: runners that start together apply a file once", async () => {
  const db = await createDb("");
  try {
    const dir = migrationsDir({ "900_once.sql": "CREATE TABLE mig_once (x int);" }); // not idempotent on purpose
    await Promise.all([migrate(db, dir), migrate(db, dir), migrate(db, dir)]);
    assert.equal((await recorded(db)).filter((n) => n === "900_once.sql").length, 1);
  } finally { await db.close(); }
});

test("migrate: running everything again changes nothing, and 002_indexes.sql can be replayed by hand", async () => {
  const db = await createDb("");
  try {
    const before = await recorded(db);
    await migrate(db);
    assert.deepEqual(await recorded(db), before);
    const sql = fs.readFileSync(path.join(SERVER_DIR, "migrations", "002_indexes.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql);
  } finally { await db.close(); }
});

test("tx hands out exec() for multi-statement SQL, and rolls it back with the transaction", async () => {
  const db = await createDb("");
  try {
    await db.tx(async (t) => { await t.exec("CREATE TABLE tx_a (x int); INSERT INTO tx_a VALUES (1), (2);"); });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tx_a")).rows[0].n, 2);
    await assert.rejects(db.tx(async (t) => {
      await t.exec("INSERT INTO tx_a VALUES (3); INSERT INTO tx_a VALUES (4);");
      throw new Error("abort");
    }), /abort/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tx_a")).rows[0].n, 2);
  } finally { await db.close(); }
});
