import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/**
 * Postgres in production (DATABASE_URL), in-memory PGlite when the URL is empty.
 * Both speak the same SQL; results expose `{ rows }`.
 */
export async function createDb(databaseUrl) {
  let db;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    // TLS stays verified. Use `?sslmode=require` in DATABASE_URL, and set DATABASE_CA (PEM text) only
    // when the host uses a private CA. Never disable certificate verification.
    const ssl = process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : undefined;
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl });
    db = {
      query: (sql, params = []) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const out = await fn({ query: (s, p = []) => client.query(s, p) });
          await client.query("COMMIT");
          return out;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const lite = new PGlite();
    db = {
      query: (sql, params = []) => lite.query(sql, params),
      exec: (sql) => lite.exec(sql),
      tx: (fn) => lite.transaction((t) => fn({ query: (s, p = []) => t.query(s, p) })),
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}

async function migrate(db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const { rows } = await db.query("SELECT name FROM _migrations");
  const done = new Set(rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
    await db.query("INSERT INTO _migrations(name) VALUES ($1)", [f]);
  }
}
