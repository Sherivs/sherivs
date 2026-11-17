#!/usr/bin/env node
/**
 * Sherivs migration ledger drift check (mission M0).
 *
 * Compares the migrations recorded as applied in a database with the files in
 * database/supabase/migrations plus the reviewed register of SQL kept elsewhere
 * (database/supabase/applied-out-of-folder.json).
 *
 * A ledger row matches a file by its full name, by version plus name, or, when a migration was
 * applied under an apply-time version, by its bare name, provided exactly one file carries that
 * name. Duplicate ledger rows are reported as warnings.
 *
 * FAIL when the ledger holds a migration with no file and no register entry, or the folder holds
 * a file the ledger has not recorded. Legacy ledger rows named with a bare UUID (dashboard-era
 * changes later captured by a platform capture migration) are reported, not failed.
 *
 * The ledger comes from one of:
 *   --ledger <file.json>            [{ "version": "...", "name": "..." }, ...]
 *   MIGRATION_LEDGER_DB_URL         a READ-ONLY connection string; runs one SELECT
 * With neither, it prints STATUS=BLOCKED and exits 0: it never guesses, and never writes.
 *
 * Usage: node scripts/verify-migration-ledger.mjs [--ledger file.json] [--json]
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A ledger row matches a file stem by its own name, or by version plus name. */
export function ledgerKeys(row) {
  const name = String(row?.name ?? "");
  const version = String(row?.version ?? "");
  return [name, `${version}_${name}`];
}

const VERSION_PREFIX = /^\d{14}_/;

/** The name without a leading 14-digit version. */
export function bareName(value) {
  return String(value ?? "").replace(VERSION_PREFIX, "");
}

export function compareLedger({ ledger, fileStems, outOfFolder }) {
  const stems = new Set(fileStems);
  const stemsByBareName = new Map();
  for (const stem of fileStems) {
    const key = bareName(stem);
    stemsByBareName.set(key, [...(stemsByBareName.get(key) ?? []), stem]);
  }
  const seenNames = new Map();
  const matchedByBareName = [];
  const registered = new Set(outOfFolder.map((e) => e.ledgerName));
  const matchedStems = new Set();
  const ledgerWithoutFile = [];
  const registeredOutOfFolder = [];
  const legacyUnnamed = [];
  for (const row of ledger) {
    const keys = ledgerKeys(row);
    const nameKey = bareName(row.name);
    seenNames.set(nameKey, (seenNames.get(nameKey) ?? 0) + 1);
    const hit = keys.find((k) => stems.has(k));
    const byName = stemsByBareName.get(nameKey) ?? [];
    if (hit) {
      matchedStems.add(hit);
    } else if (byName.length === 1 && !UUID.test(nameKey)) {
      matchedStems.add(byName[0]);
      matchedByBareName.push(`${row.version}:${row.name} -> ${byName[0]}`);
    } else if (keys.some((k) => registered.has(k))) {
      registeredOutOfFolder.push(keys.find((k) => registered.has(k)));
    } else if (UUID.test(String(row.name))) {
      legacyUnnamed.push(`${row.version}:${row.name}`);
    } else {
      ledgerWithoutFile.push(`${row.version}:${row.name}`);
    }
  }
  const filesNotInLedger = fileStems.filter((s) => !matchedStems.has(s)).sort();
  const staleRegister = [...registered].filter((n) => !registeredOutOfFolder.includes(n)).sort();
  const ok =
    ledgerWithoutFile.length === 0 && filesNotInLedger.length === 0 && staleRegister.length === 0;
  return {
    status: ok ? "PASS" : "FAIL",
    counts: { ledger: ledger.length, files: fileStems.length, matched: matchedStems.size },
    ledgerWithoutFile: ledgerWithoutFile.sort(),
    filesNotInLedger,
    matchedByBareName: matchedByBareName.sort(),
    duplicateLedgerNames: [...seenNames]
      .filter(([, n]) => n > 1)
      .map(([name]) => name)
      .sort(),
    registeredOutOfFolder: registeredOutOfFolder.sort(),
    staleRegister,
    legacyUnnamed: legacyUnnamed.sort(),
  };
}

export function readRepoState(root) {
  const dir = join(root, "database", "supabase", "migrations");
  const fileStems = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.slice(0, -4))
    .sort();
  const register = JSON.parse(
    readFileSync(join(root, "database", "supabase", "applied-out-of-folder.json"), "utf8"),
  );
  const missingSql = register.entries
    .flatMap((e) => [e.sqlPath, e.rollbackPath])
    .filter((p) => !existsSync(join(root, p)));
  return { fileStems, outOfFolder: register.entries, missingSql };
}

async function loadLedger(argv, env) {
  const flag = argv.indexOf("--ledger");
  if (flag !== -1 && argv[flag + 1]) {
    return JSON.parse(readFileSync(argv[flag + 1], "utf8"));
  }
  const url = env.MIGRATION_LEDGER_DB_URL;
  if (!url) return null;
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
    const result = await client.query(
      "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version",
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const repo = readRepoState(root);
  if (repo.missingSql.length > 0) {
    console.log(`STATUS=FAIL register points at missing files: ${repo.missingSql.join(", ")}`);
    process.exit(1);
  }
  const ledger = await loadLedger(process.argv.slice(2), process.env);
  if (ledger === null) {
    console.log(
      "STATUS=BLOCKED no ledger source. Pass --ledger <file.json> or set MIGRATION_LEDGER_DB_URL " +
        "to a read-only connection string. Nothing was checked against a database.",
    );
    process.exit(0);
  }
  const report = compareLedger({ ledger, ...repo });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `ledger=${report.counts.ledger} files=${report.counts.files} matched=${report.counts.matched} ` +
        `out-of-folder=${report.registeredOutOfFolder.length} legacy-unnamed=${report.legacyUnnamed.length}`,
    );
    for (const x of report.ledgerWithoutFile)
      console.log(`FAIL applied, no file or register entry: ${x}`);
    for (const x of report.filesNotInLedger) console.log(`FAIL file not recorded as applied: ${x}`);
    for (const x of report.staleRegister) console.log(`FAIL register entry not in ledger: ${x}`);
    console.log(`STATUS=${report.status}`);
  }
  process.exit(report.status === "PASS" ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.log(`STATUS=FAIL ${error?.name ?? "Error"}`);
    process.exit(1);
  });
}
