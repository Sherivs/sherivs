#!/usr/bin/env node
/**
 * CoreGrid — run a SQL verification/query file via node-postgres.
 *
 * Usage:
 *   $env:DATABASE_URL="postgresql://..." ; node scripts/db-run.mjs database/queries/rls-isolation-check.sql
 *
 * Reads DATABASE_URL from the environment ONLY. The argument is either a path
 * to a SQL file (existing files always win) or, if no such file exists and the
 * argument does not end in ".sql", a literal inline SQL statement. Executes
 * it as one multi-statement query and prints any returned rows as JSON lines.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pgSslConfig } from "./lib/pg-ssl.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/db-run.mjs <path-to-sql-file | "inline SQL">');
  process.exit(2);
}
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is required (postgres connection string).");
  process.exit(2);
}

const sqlFile = join(ROOT, target);
let sql;
if (existsSync(sqlFile)) {
  sql = readFileSync(sqlFile, "utf8");
} else if (target.endsWith(".sql")) {
  console.error(`SQL file not found: ${target}`);
  process.exit(2);
} else {
  sql = target;
}

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: pgSslConfig(dbUrl),
});
await client.connect();
try {
  const result = await client.query(sql);
  if (result.command === "SELECT" && Array.isArray(result.rows)) {
    for (const row of result.rows) console.log(JSON.stringify(row));
  }
  console.log(`OK   ${target} (command=${result.command ?? "multi"})`);
} catch (err) {
  console.error(`FAIL ${target}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await client.end();
}
