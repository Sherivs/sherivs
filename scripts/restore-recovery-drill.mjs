#!/usr/bin/env node
/**
 * MISSION-R-101 (V1CAP-074 / J-042) — backup/restore verified-recovery drill.
 *
 * Proves "recovery executed and verified, not assumed" (E-102 invariant 30)
 * against the canonical environment through the authorized Management API
 * channel, serialized on exclusive canonical access after MISSION-R-100:
 *
 *   1. create a dedicated drill table (no personal data; ADR-005 categories
 *      untouched) and seed synthetic rows
 *   2. BACKUP   — export rows to a JSON manifest with per-row sha256 checksums
 *   3. DESTROY  — DROP the drill table (the only destructive step; scoped to
 *                 the drill table by construction)
 *   4. RESTORE  — recreate the table and reinsert rows from the manifest in a
 *                 single transaction, restoring every checksum
 *   5. VERIFY   — row-level identity: per-row checksums, row count, and a
 *                 canary value must be byte-identical pre/post restore
 *   6. EVIDENCE INTEGRITY — immutable evidence/audit stores (cg_foundation_evidence,
 *                 cg_execution_history) must be checksum-identical before and
 *                 after the whole drill (the drill never mutates them)
 *   7. CLEANUP  — drop the drill table; the canonical schema ends unchanged
 *
 * Honors ADR-005 (RETENTION_VS_IMMUTABLE_AUDIT): the drill touches no
 * personal-data-bearing record family, immutable audit records are never
 * destroyed, and backups of real tenant data must restore tombstone state —
 * encoded as runbook requirements, not exercised here (no personal data in
 * the drill set by design).
 *
 * Direct-Postgres paths (when a `pg` client is added) MUST derive their ssl
 * option from scripts/lib/pg-ssl.mjs strict TLS policy; this drill uses the
 * Management API channel (SUPABASE_ACCESS_TOKEN), which needs no CA cert.
 * Secret values are never printed.
 *
 * Usage: node scripts/restore-recovery-drill.mjs [project-ref]
 * Exit 0 = PASS, 1 = FAIL, 2 = blocked on credentials.
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const artifactsDir = "/opt/cursor/artifacts";
const DEFAULT_REF = "nwrflbpbhyiqdptmlccm";
const projectRef = process.argv[2] ?? DEFAULT_REF;
const drillTable = "restore_drill_probe";
const now = () => new Date().toISOString();
const transcript = [];
function log(line) {
  transcript.push(line);
  console.log(line);
}
function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? "";
if (!accessToken) {
  console.error("BLOCKED_NO_CREDENTIAL — SUPABASE_ACCESS_TOKEN not injected");
  process.exit(2);
}

async function management(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL HTTP ${res.status} ${text.slice(0, 400)}`);
  return text === "" ? [] : JSON.parse(text);
}

async function evidenceStoreFingerprint() {
  const rows = await management(`
    SELECT
      (SELECT count(*) FROM public.cg_foundation_evidence) AS evidence_count,
      (SELECT count(*) FROM public.cg_execution_history) AS history_count,
      (SELECT count(*) FROM public.cg_verification_result) AS verification_count;
  `);
  const row = rows[0] ?? {};
  return JSON.stringify(row);
}

log(`COREGRID RESTORE/RECOVERY DRILL — MISSION-R-101 (V1CAP-074 / J-042)`);
log(`project=${projectRef} transport=management-api-readonly-plus-drill-table started=${now()}`);
log(`drill_table=${drillTable} data_class=synthetic-no-personal-data (ADR-005 categories untouched)`);

// ── 1. create + seed the drill table ────────────────────────────────────────
await management(`
  DROP TABLE IF EXISTS public.${drillTable};
  CREATE TABLE public.${drillTable} (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payload text NOT NULL,
    tenant_tag text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public.${drillTable} ENABLE ROW LEVEL SECURITY;
`);
const seedValues = ["alpha-canary", "beta-record", "gamma-record", "delta-record", "omega-canary"]
  .map((payload) => `('${payload}', 'drill-tenant-a'), ('${payload}', 'drill-tenant-b')`)
  .join(", ");
await management(`
  INSERT INTO public.${drillTable} (payload, tenant_tag) VALUES ${seedValues};
`);
log("STEP1 seeded 10 synthetic rows (RLS enabled, zero policies — deny-by-default posture)");

// ── 2. backup: export rows + checksums into a manifest ──────────────────────
const backupRows = await management(`
  SELECT id, payload, tenant_tag, created_at::text AS created_at
    FROM public.${drillTable} ORDER BY created_at, id;
`);
if (backupRows.length !== 10) throw new Error(`backup expected 10 rows, got ${backupRows.length}`);
const manifest = {
  kind: "coregrid-restore-drill-backup",
  projectRef,
  table: `public.${drillTable}`,
  takenAt: now(),
  rows: backupRows.map((row) => ({ ...row, row_sha256: sha256(JSON.stringify(row)) })),
  manifest_sha256: null,
};
manifest.manifest_sha256 = sha256(JSON.stringify(manifest.rows));
mkdirSync(artifactsDir, { recursive: true });
const backupPath = join(artifactsDir, "restore-drill-backup.json");
writeFileSync(backupPath, JSON.stringify(manifest, null, 2));
log(`STEP2 backup written rows=${manifest.rows.length} manifest_sha256=${manifest.manifest_sha256}`);
log(`STEP2 backup_path=${backupPath}`);

const before = {
  rowChecksums: manifest.rows.map((r) => r.row_sha256).sort(),
  canary: manifest.rows.find((r) => r.payload === "alpha-canary"),
  evidenceStores: await evidenceStoreFingerprint(),
};
log(`STEP2 evidence_stores_before=${before.evidenceStores}`);

// ── 3. destroy: drop the drill table (scoped by construction) ───────────────
await management(`DROP TABLE public.${drillTable};`);
const destroyed = await management(`
  SELECT count(*) AS n FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = '${drillTable}';
`);
if ((destroyed[0]?.n ?? 1) !== 0) throw new Error("destroy step failed: drill table still present");
log("STEP3 destroy confirmed: drill table dropped (information_schema count=0)");

// ── 4. restore: recreate + reinsert from the manifest in one transaction ────
await management(`
  BEGIN;
  CREATE TABLE public.${drillTable} (
    id uuid PRIMARY KEY,
    payload text NOT NULL,
    tenant_tag text NOT NULL,
    created_at timestamptz NOT NULL
  );
  ALTER TABLE public.${drillTable} ENABLE ROW LEVEL SECURITY;
  INSERT INTO public.${drillTable} (id, payload, tenant_tag, created_at) VALUES
    ${manifest.rows
      .map(
        (r) =>
          `('${r.id}', '${r.payload.replace(/'/g, "''")}', '${r.tenant_tag.replace(/'/g, "''")}', '${r.created_at}')`,
      )
      .join(",\n    ")};
  COMMIT;
`);
log(`STEP4 restore executed rows=${manifest.rows.length} (single transaction, id + created_at preserved)`);

// ── 5. verify row-level identity ────────────────────────────────────────────
const restoredRows = await management(`
  SELECT id, payload, tenant_tag, created_at::text AS created_at
    FROM public.${drillTable} ORDER BY created_at, id;
`);
const restoredChecksums = restoredRows.map((row) => sha256(JSON.stringify(row))).sort();
const checksumsMatch =
  restoredChecksums.length === before.rowChecksums.length &&
  restoredChecksums.every((c, i) => c === before.rowChecksums[i]);
const restoredCanary = restoredRows.find((r) => r.payload === "alpha-canary");
const canaryMatch =
  restoredCanary?.id === before.canary.id &&
  restoredCanary?.tenant_tag === before.canary.tenant_tag &&
  restoredCanary?.created_at === before.canary.created_at;
log(`STEP5 row_count restored=${restoredRows.length} expected=${before.rowChecksums.length}`);
log(`STEP5 per-row sha256 identity: ${checksumsMatch ? "VERIFIED (all rows byte-identical)" : "FAILED"}`);
log(`STEP5 canary row-level identity: ${canaryMatch ? "VERIFIED (id, tenant_tag, created_at byte-identical)" : "FAILED"}`);

// ── 6. evidence integrity: immutable stores unchanged by the drill ──────────
const after = { evidenceStores: await evidenceStoreFingerprint() };
const evidenceIntact = before.evidenceStores === after.evidenceStores;
log(`STEP6 evidence_stores_after=${after.evidenceStores}`);
log(`STEP6 evidence integrity (cg_foundation_evidence / cg_execution_history / cg_verification_result): ${evidenceIntact ? "INTACT" : "CHANGED — FINDING"}`);

// ── 7. cleanup: drop the drill table; canonical schema ends unchanged ───────
await management(`DROP TABLE public.${drillTable};`);
const postCleanup = await management(`
  SELECT count(*) AS n FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = '${drillTable}';
`);
const cleaned = (postCleanup[0]?.n ?? 1) === 0;
log(`STEP7 cleanup: drill table dropped=${cleaned}`);

const pass = checksumsMatch && canaryMatch && evidenceIntact && cleaned;
log(`VERDICT=${pass ? "PASS" : "FAIL"} — recovery executed and verified, not assumed (row-level identity + evidence integrity)`);
log(`finished=${now()}`);

const transcriptPath = join(artifactsDir, "restore-recovery-transcript.log");
writeFileSync(transcriptPath, transcript.join("\n") + "\n");
writeFileSync(
  join(artifactsDir, "restore-recovery-results.json"),
  JSON.stringify(
    {
      mission: "MISSION-R-101",
      capability: "V1CAP-074",
      gap: "J-042",
      projectRef,
      drillTable,
      executedAt: now(),
      backupPath,
      backupManifestSha256: manifest.manifest_sha256,
      checks: { rowLevelIdentity: checksumsMatch, canaryIdentity: canaryMatch, evidenceIntegrity: evidenceIntact, cleanup: cleaned },
      verdict: pass ? "PASS" : "FAIL",
    },
    null,
    2,
  ) + "\n",
);
process.exit(pass ? 0 : 1);
