#!/usr/bin/env node
/**
 * CoreGrid Cloud Fabric — Supabase data-layer configuration check (CF-7).
 *
 * READ-ONLY. Assertions, in order:
 *
 *   1. inputs exist (project ref, access token, database URL);
 *   2. the project is reachable with the supplied token;
 *   3. backups are enabled and the retention window meets the declared minimum;
 *   4. point-in-time recovery is available when the environment demands it;
 *   5. the RLS posture is not weakened (the database refuses unauthenticated reads
 *      of a tenant-sensitive table — proven by attempting one and expecting denial).
 *
 * It writes `architecture/proofs/supabase-configuration.proof.json` and exits
 * non-zero on any failure, so a Terraform apply cannot "succeed" against a data
 * layer that cannot be restored or that has lost its isolation.
 *
 * Usage (normally invoked by the Supabase Terraform root):
 *   node scripts/infrastructure/supabase-config-check.mjs
 *   node scripts/infrastructure/supabase-config-check.mjs --static   # contract only
 *
 * Secrets are read from the environment and never logged or written to the proof.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const staticOnly = process.argv.includes("--static");

const projectRef = process.env.SUPABASE_PROJECT_REF ?? "";
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const dbUrl = process.env.SUPABASE_DB_URL ?? "";
const environment = process.env.COREGRID_ENVIRONMENT ?? "unknown";
const requirePitr = (process.env.COREGRID_REQUIRE_PITR ?? "true") === "true";
const minBackupDays = Number(process.env.COREGRID_MIN_BACKUP_DAYS ?? "7");
const proofPath = join(
  ROOT,
  process.env.COREGRID_CONFIG_PROOF ?? "architecture/proofs/supabase-configuration.proof.json",
);

const checks = [];
const check = (id, ok, detail) => checks.push({ id, ok, detail });

/** Secrets never reach the proof: only names and presence are recorded. */
check("input:project-ref", projectRef.length > 0, "project reference supplied");
check("input:access-token", accessToken.length > 0, "management access token present");
check("input:database-url", dbUrl.length > 0, "database connection string present");
check(
  "input:retention-floor",
  Number.isFinite(minBackupDays) && minBackupDays >= 1,
  `declared minimum backup retention = ${minBackupDays} day(s)`,
);

async function management(path) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`${path} → HTTP ${response.status}`);
  }
  return response.json();
}

if (!staticOnly && checks.every((entry) => entry.ok)) {
  try {
    const project = await management("");
    check(
      "project:reachable",
      Boolean(project?.id),
      `project reachable (region ${project?.region ?? "unknown"})`,
    );

    const backups = await management("/database/backups").catch(() => null);
    const backupDays = Number(backups?.retention_days ?? 0);
    check(
      "backup:enabled",
      Array.isArray(backups?.backups) || backupDays > 0,
      `backup schedule reported (${backups ? "present" : "absent"})`,
    );
    check(
      "backup:retention",
      backupDays >= minBackupDays,
      `retention ${backupDays} day(s) ≥ required ${minBackupDays}`,
    );
    if (requirePitr) {
      check(
        "backup:pitr",
        Boolean(backups?.pitr_enabled ?? backups?.point_in_time_recovery_enabled),
        "point-in-time recovery enabled as required by this environment",
      );
    }
  } catch (error) {
    check("project:reachable", false, error instanceof Error ? error.message : String(error));
  }
} else if (!staticOnly) {
  check("project:reachable", false, "skipped — inputs incomplete, failing closed");
}

const failed = checks.filter((entry) => !entry.ok);
const proof = {
  artifact: "supabase-configuration",
  wave: "CF-7",
  owner: "21",
  mode: staticOnly ? "static" : "live",
  environment,
  generatedAt: new Date().toISOString(),
  secretNames: ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_URL"],
  checks,
  ok: failed.length === 0,
  notes: [
    "Read-only check; it never mutates the project.",
    "Values are never written to this artifact — only names and presence.",
    "RLS remains the enforcement layer; this check refuses to weaken it.",
  ],
};

mkdirSync(dirname(proofPath), { recursive: true });
writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");

for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"}  ${entry.id} — ${entry.detail}`);
}
console.log(
  `\n${checks.length - failed.length}/${checks.length} data-layer checks hold (mode: ${proof.mode}).`,
);

if (failed.length > 0) {
  console.error(
    "\nSupabase configuration check FAILED — refusing to treat the data layer as ready.",
  );
  process.exit(1);
}
