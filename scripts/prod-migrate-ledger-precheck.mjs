#!/usr/bin/env node
/**
 * ADR-120 ledger pre-check for .github/workflows/prod-migrate-one.yml.
 *
 * This process does not open a database connection and does not apply SQL.
 * The workflow dumps supabase_migrations.schema_migrations to a TSV file and
 * passes the target version in the MIGRATION environment variable.
 *
 * TSV rows are `version<TAB>name`. An earlier repo migration counts as
 * applied when any row has the same 14-digit version, or a name equal to the
 * file stem (`<version>_<name>`) or that stem without its `<version>_` prefix.
 * The target is refused when any row matches it the same way, so a migration
 * already recorded under an apply timestamp cannot be applied twice.
 *
 * Lexicographic order on the fixed-width version is the migration order.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = /^[0-9]{14}$/;
const MIGRATION_FILE = /^([0-9]{14})_(.+)\.sql$/;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");

export function parseMigrationFilename(filename) {
  if (typeof filename !== "string") return null;
  const match = MIGRATION_FILE.exec(filename);
  if (!match) return null;
  return {
    filename,
    version: match[1],
    stem: filename.slice(0, -".sql".length),
    unprefixed: match[2],
  };
}

export function parseLedgerTsv(text) {
  if (typeof text !== "string") {
    throw new Error("ledger text must be a string");
  }
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const tab = line.indexOf("\t");
    const version = (tab === -1 ? line : line.slice(0, tab)).trim();
    const name = tab === -1 ? "" : line.slice(tab + 1).trim();
    if (!VERSION.test(version)) {
      throw new Error(`ledger row ${index + 1} has a non-14-digit version`);
    }
    rows.push({ version, name });
  }
  return rows;
}

function rejected(errors) {
  return { ok: false, errors, missing: [], earlierCount: 0, target: null };
}

function ledgerMatch(identity, versions, names) {
  if (versions.has(identity.version)) return { matched: true, by: "version" };
  if (names.has(identity.stem)) return { matched: true, by: "name", name: identity.stem };
  if (names.has(identity.unprefixed)) {
    return { matched: true, by: "name", name: identity.unprefixed };
  }
  return { matched: false };
}

/**
 * @param {{ targetVersion: string, files: string[], ledgerRows: { version: string, name: string }[] }} input
 */
export function evaluateProdMigrateLedger({ targetVersion, files, ledgerRows }) {
  if (typeof targetVersion !== "string" || !VERSION.test(targetVersion)) {
    return rejected(["migration must be a 14-digit version"]);
  }
  if (!Array.isArray(files) || !Array.isArray(ledgerRows)) {
    return rejected(["ledger pre-check inputs are invalid"]);
  }

  const unexpected = files.filter((file) => parseMigrationFilename(file) === null);
  if (unexpected.length > 0) {
    return rejected([
      `migration filenames must be <14-digit-version>_<name>.sql: ${unexpected.sort().join(", ")}`,
    ]);
  }

  const identities = files.map((file) => parseMigrationFilename(file));
  const owners = new Map();
  for (const identity of identities) {
    for (const key of [identity.stem, identity.unprefixed]) {
      const list = owners.get(key) ?? [];
      list.push(identity.filename);
      owners.set(key, list);
    }
  }
  const ambiguous = [];
  for (const [key, filenames] of owners) {
    const unique = [...new Set(filenames)].sort();
    if (unique.length > 1) ambiguous.push(`${key} (${unique.join(", ")})`);
  }
  if (ambiguous.length > 0) {
    return rejected([`ambiguous migration names: ${ambiguous.sort().join("; ")}`]);
  }

  for (const row of ledgerRows) {
    if (!row || typeof row.version !== "string" || !VERSION.test(row.version)) {
      return rejected(["ledger row has a non-14-digit version"]);
    }
    if (typeof row.name !== "string") return rejected(["ledger row name must be a string"]);
  }

  const targets = identities.filter((identity) => identity.version === targetVersion);
  if (targets.length !== 1) {
    return rejected([`expected exactly 1 file for ${targetVersion}, found ${targets.length}`]);
  }
  const target = targets[0];

  const versions = new Set(ledgerRows.map((row) => row.version));
  const names = new Set(ledgerRows.map((row) => row.name).filter((name) => name !== ""));
  const errors = [];
  const targetMatch = ledgerMatch(target, versions, names);
  if (targetMatch.matched) {
    const how = targetMatch.by === "version" ? "version" : `name '${targetMatch.name}'`;
    errors.push(`${targetVersion} is already in the ledger (matched by ${how})`);
  }

  const earlier = identities
    .filter((identity) => identity.version < targetVersion)
    .sort((left, right) =>
      left.version === right.version
        ? left.filename.localeCompare(right.filename)
        : left.version.localeCompare(right.version),
    );
  const missing = earlier
    .filter((identity) => !ledgerMatch(identity, versions, names).matched)
    .map((identity) => identity.stem);
  if (missing.length > 0) {
    errors.push(`earlier migrations not in ledger:\n${missing.join("\n")}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    missing,
    earlierCount: earlier.length,
    target,
  };
}

function printFailure(stderr, message) {
  const [head, ...rest] = message.split("\n");
  stderr(`::error::${head}`);
  for (const line of rest) stderr(line);
}

export function runPrecheckCli({
  argv,
  env,
  readFile = readFileSync,
  readDir = readdirSync,
  stdout = console.log,
  stderr = console.error,
}) {
  let ledgerPath = "";
  let migrationsDir = DEFAULT_MIGRATIONS_DIR;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ledger") {
      ledgerPath = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--migrations") {
      migrationsDir = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--help") {
      stdout(
        "Usage: MIGRATION=<14-digit-version> node scripts/prod-migrate-ledger-precheck.mjs --ledger <file> [--migrations <dir>]",
      );
      return 0;
    } else {
      printFailure(stderr, `unknown argument: ${arg}`);
      return 2;
    }
  }
  if (!ledgerPath || !migrationsDir) {
    printFailure(stderr, "missing --ledger or --migrations");
    return 2;
  }

  const migration = typeof env.MIGRATION === "string" ? env.MIGRATION.trim() : "";
  let ledgerText;
  let filenames;
  try {
    ledgerText = readFile(ledgerPath, "utf8");
    filenames = readDir(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
  } catch (error) {
    printFailure(stderr, error instanceof Error ? error.message : "ledger pre-check failed");
    return 1;
  }

  let ledgerRows;
  try {
    ledgerRows = parseLedgerTsv(ledgerText);
  } catch (error) {
    printFailure(stderr, error instanceof Error ? error.message : "ledger pre-check failed");
    return 1;
  }

  stdout(`ledger rows: ${ledgerRows.length}`);
  const result = evaluateProdMigrateLedger({
    targetVersion: migration,
    files: filenames,
    ledgerRows,
  });
  if (!result.ok) {
    for (const error of result.errors) printFailure(stderr, error);
    return 1;
  }
  stdout(`target ${result.target.filename} is not in the ledger`);
  stdout(`all ${result.earlierCount} earlier repo migrations are in the ledger`);
  return 0;
}

function invokedDirectly() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (invokedDirectly()) {
  process.exit(
    runPrecheckCli({
      argv: process.argv.slice(2),
      env: process.env,
    }),
  );
}
