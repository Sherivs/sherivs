/**
 * Official Supabase DB-type generator for the CoreGrid contracts package.
 *
 * Single source of truth: `packages/contracts/src/database.ts` (consumed by the
 * web frontend and the Expo mobile app via `@coregrid/contracts`). This script
 * is the ONLY sanctioned way to regenerate those types.
 *
 * Legacy note (R-wave follow-up): the pre-R-wave output path
 * `frontend/src/integrations/supabase/types.ts` is a one-line re-export of the
 * package and is protected by `tests/unit/contracts-single-source.test.ts`.
 * This script never writes that path — a stray legacy regeneration would fail
 * the structural ratchet loudly instead of drifting silently.
 *
 * Usage:
 *   npm run types:generate           Regenerate + write the package file
 *   npm run types:generate -- --check   Generate, compare, report drift; write NOTHING
 *
 * Auth: requires SUPABASE_ACCESS_TOKEN in the environment (Supabase CLI
 * personal-access-token auth). No database writes are performed — generation
 * is a read-only introspection probe.
 *
 * Drift policy: if the regenerated output differs from the committed file, the
 * diff is reported loudly. Committing regenerated types against the canonical
 * project is a coordinator decision after review (schema regeneration is not
 * an autonomous agent action).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Canonical output target — the contracts package, never the legacy path. */
const OUTPUT_TARGET = "packages/contracts/src/database.ts";
/** Superseded output location; kept here ONLY as a write-guard reference. */
const LEGACY_OUTPUT_PATH = "frontend/src/integrations/supabase/types.ts";
/** Canonical Supabase project (public project ref, not a secret). */
const CANONICAL_PROJECT_REF = "nwrflbpbhyiqdptmlccm";
const SCHEMA = "public";

const checkOnly = process.argv.includes("--check");

function fail(message) {
  console.error(`types:generate: FAIL — ${message}`);
  process.exit(1);
}

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  fail(
    "SUPABASE_ACCESS_TOKEN is not set. Export a Supabase personal access token " +
      "(Supabase Dashboard → Account → Access Tokens) and retry.",
  );
}

function resolveProjectRef() {
  if (process.env.SUPABASE_PROJECT_ID) return process.env.SUPABASE_PROJECT_ID;
  const url = process.env.SUPABASE_URL;
  if (url) {
    const ref = url.replace(/^https?:\/\//, "").split(".")[0];
    if (ref && /^[a-z0-9]{20}$/.test(ref)) return ref;
  }
  return CANONICAL_PROJECT_REF;
}

const projectRef = resolveProjectRef();
const targetAbs = join(repoRoot, OUTPUT_TARGET);

if (resolve(targetAbs) === resolve(join(repoRoot, LEGACY_OUTPUT_PATH))) {
  fail("output target must never be the legacy path");
}

function run(cmd, args, { input } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`${cmd} could not be executed: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${cmd} ${args.join(" ")} exited ${result.status}\n${result.stderr}`);
  }
  return result.stdout;
}

console.log(`types:generate: generating ${SCHEMA}-schema types for project ${projectRef} (read-only introspection)`);
const raw = run("npx", [
  "supabase",
  "gen",
  "types",
  "typescript",
  "--project-id",
  projectRef,
  "--schema",
  SCHEMA,
]);
if (!raw.includes("export type Database")) {
  fail("generator output does not look like Supabase Database types — refusing to write");
}

// Format with the repo prettier config (.prettierrc) so regenerated output
// diffs cleanly against the committed file.
const formatted = run("npx", [
  "prettier",
  "--parser",
  "typescript",
  "--stdin-filepath",
  OUTPUT_TARGET,
], { input: raw }).trimEnd() + "\n";

const tableCount = [...formatted.matchAll(/^      (\w+): \{$/gm)].length;
console.log(`types:generate: generated ${formatted.length} bytes, ${tableCount} tables/functions`);

const committed = readFileSync(targetAbs, "utf8");
if (formatted === committed) {
  console.log(`types:generate: no drift — ${OUTPUT_TARGET} already matches canonical schema`);
  process.exit(0);
}

const committedCount = [...committed.matchAll(/^      (\w+): \{$/gm)].length;
const committedNames = new Set([...committed.matchAll(/^      (\w+): \{$/gm)].map((m) => m[1]));
const generatedNames = new Set([...formatted.matchAll(/^      (\w+): \{$/gm)].map((m) => m[1]));
const added = [...generatedNames].filter((n) => !committedNames.has(n));
const removed = [...committedNames].filter((n) => !generatedNames.has(n));

console.log(
  `types:generate: SCHEMA DRIFT DETECTED — ${committedCount} -> ${tableCount} tables/functions ` +
    `(+${added.length} new: ${added.slice(0, 8).join(", ")}${added.length > 8 ? ", …" : ""}` +
    `${removed.length ? `; -${removed.length} removed: ${removed.slice(0, 8).join(", ")}${removed.length > 8 ? ", …" : ""}` : ""})`,
);

if (checkOnly) {
  console.log("types:generate: --check mode — file left UNCHANGED. Review the diff, then re-run without --check to update the package.");
  process.exit(2);
}

console.log(
  "types:generate: NOTICE — writing regenerated types to " + OUTPUT_TARGET + "." +
    " Committing schema drift against the canonical project is a COORDINATOR decision after review; do not commit silently.",
);
writeFileSync(targetAbs, formatted);
console.log(`types:generate: wrote ${OUTPUT_TARGET}`);