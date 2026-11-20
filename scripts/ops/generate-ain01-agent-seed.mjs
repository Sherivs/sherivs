#!/usr/bin/env node
// AIN-01 (ADR-125): render the engine-actor registry seed from the agent packs and charters, and write it
// into the migration between its two marker pairs. Offline, no database, no network, no secret.
// Usage: node scripts/ops/generate-ain01-agent-seed.mjs [--check]
//   (no flag) rewrites the generated blocks in the migration; --check exits 1 when they differ.
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const migration = path.join(
  root,
  "database/supabase/migrations/20261117000970_sherivs_ain01_agents_as_engine_actors.sql",
);
const work = mkdtempSync(path.join(tmpdir(), "ain01-seed-"));
try {
  const out = path.join(work, "engine-actors.mjs");
  await build({
    entryPoints: [path.join(root, "frontend/src/lib/workforce-charter/engine-actors.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    logLevel: "error",
    tsconfig: path.join(root, "tsconfig.json"),
  });
  const mod = await import(pathToFileURL(out).href);
  const seed = mod.engineActorSeedSql(mod.engineAgentRecords());
  const tiers = mod.tierActionClassSeedSql();
  let sql = readFileSync(migration, "utf8");
  const swap = (text, begin, end, block) => {
    const a = text.indexOf(begin);
    const b = text.indexOf(end);
    if (a < 0 || b < a) throw new Error(`markers not found: ${begin}`);
    return text.slice(0, a) + block + text.slice(b + end.length);
  };
  sql = swap(sql, mod.SEED_BEGIN, mod.SEED_END, seed);
  sql = swap(
    sql,
    "-- BEGIN GENERATED AIN01 TIER CLASSES",
    "-- END GENERATED AIN01 TIER CLASSES",
    tiers,
  );
  if (process.argv.includes("--check")) {
    if (sql !== readFileSync(migration, "utf8")) {
      console.error("AIN01 seed drift: run node scripts/ops/generate-ain01-agent-seed.mjs");
      process.exit(1);
    }
    console.log("AIN01 seed in step with the agent definitions");
  } else {
    writeFileSync(migration, sql);
    console.log("AIN01 seed written");
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
