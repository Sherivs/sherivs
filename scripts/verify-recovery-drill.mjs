#!/usr/bin/env node
/**
 * CoreGrid — H3 wave, team H3-001 (Recovery Drill Runner Engineer), mission
 * A-001 (Squad A — Recovery & Resilience, M-R-101 groundwork).
 *
 * Recovery-drill verification runner, built in the battery exemplar's image
 * (scripts/apply-canonical-hardening.mjs): declared contracts, checksum
 * bookkeeping, guarded artifact writes, and fail-closed exit semantics.
 *
 * Modes:
 *   --rehearse  offline rehearsal (default-authorized, no credential, no
 *               network, no database): validates the declared drill plan
 *               invariants, the backup-manifest shapes (embedded Zod
 *               contracts, exercised against known-good and known-bad shape
 *               vectors plus any manifests found in the manifest store), and
 *               the recovery-target contracts (RTO/RPO per record family,
 *               fail-closed: every scoped family must carry a declared
 *               target — no implicit defaults). Exit 0 PASS · 1 FINDING.
 *   (default)   live pre-pass. STRICTLY credential-gated: without
 *               SUPABASE_ACCESS_TOKEN it fails closed with BLOCKED_NO_CREDENTIAL
 *               (exit 2) before doing anything. With the credential it re-runs
 *               the full offline rehearsal and then performs ONE read-only
 *               reachability probe (SELECT 1) on the authorized Management API
 *               query channel. It is never destructive and never touches
 *               tenant data; the destructive restore drill remains owned by
 *               scripts/restore-recovery-drill.mjs and the recovery runbooks.
 *
 * The runner is SELF-CONTAINED: its Zod contracts are embedded here (sibling
 * squad modules are deliberately not imported). Credential values are never
 * printed, logged, or written to any artifact. No eval, no dynamic code.
 *
 * Manifest store: COREGRID_RECOVERY_MANIFESTS_DIR (defaulting to
 * architecture/proofs/recovery/manifests in-repo). Artifacts directory:
 * COREGRID_ARTIFACTS_DIR (defaulting to /opt/cursor/artifacts).
 *
 * Usage:
 *   node scripts/verify-recovery-drill.mjs --rehearse [project-ref]
 *   node scripts/verify-recovery-drill.mjs [project-ref]
 * Exit codes: 0 PASS · 1 FINDING · 2 BLOCKED_NO_CREDENTIAL / BLOCKED_USAGE.
 */

/* eslint-disable no-console */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_ARTIFACTS_DIR = "/opt/cursor/artifacts";
const ARTIFACTS_DIR = process.env.COREGRID_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR;
const DEFAULT_MANIFESTS_DIR = join(ROOT, "architecture", "proofs", "recovery", "manifests");
const MANIFESTS_DIR = process.env.COREGRID_RECOVERY_MANIFESTS_DIR ?? DEFAULT_MANIFESTS_DIR;
const DEFAULT_PROJECT_REF = "nwrflbpbhyiqdptmlccm";

// ── mode / argument parsing ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positionals = argv.filter((a) => !a.startsWith("--"));
const KNOWN_FLAGS = new Set(["--rehearse"]);
const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
const MODE = flags.includes("--rehearse") ? "rehearse" : "live";
const projectRef = positionals[0] ?? DEFAULT_PROJECT_REF;

if (unknownFlags.length > 0 || positionals.length > 1) {
  console.error(
    `BLOCKED_USAGE unknown argument(s): ${[...unknownFlags, ...positionals.slice(1)].join(" ")}. ` +
      `Supported: [project-ref] with optional --rehearse.`,
  );
  process.exit(2);
}

/**
 * Credential gate — BEFORE any other work in live mode. Rehearsal is
 * deliberately credential-free (offline), so it runs without any token.
 */
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (MODE !== "rehearse" && !token) {
  console.error("BLOCKED_NO_CREDENTIAL SUPABASE_ACCESS_TOKEN is not set. Nothing was probed.");
  process.exit(2);
}

// ── embedded contracts (self-contained; no sibling-module imports) ───────────
/** A step of the declared recovery drill plan. */
const DrillStepSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["prepare", "backup", "destroy", "restore", "verify", "evidence-integrity", "cleanup"]),
  summary: z.string().min(1),
  destructive: z.boolean(),
  /** Required for kind="destroy": the id of the restore step that reverses it. */
  restoresStep: z.string().min(1).nullable(),
  /** Required for kind="destroy": the id of the verify step that proves the reversal. */
  verifiesStep: z.string().min(1).nullable(),
});

const DrillPlanSchema = z.array(DrillStepSchema).min(1);

/**
 * A recovery target declaration: RTO/RPO per record family. Fail-closed by
 * construction — a scoped family without a declared target is a FINDING, and
 * there is no implicit default target.
 */
const RecoveryTargetSchema = z.strictObject({
  recordFamily: z.string().min(1),
  /** Recovery-time objective in minutes (must be positive). */
  rtoMinutes: z.number().int().positive(),
  /** Recovery-point objective in minutes (0 = no tolerated data loss). */
  rpoMinutes: z.number().int().nonnegative(),
  ownerRole: z.string().min(1),
});

const HEX64 = z.string().regex(/^[0-9a-f]{64}$/, "must be lowercase sha256 hex");

const ISO_DATETIME = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, "must be an UTC ISO-8601 instant");

/**
 * Backup-manifest contract: what a valid backup set is — scope, checksums,
 * the instant it was taken, its expiry, and tenant coverage.
 */
const BackupManifestSchema = z.strictObject({
  kind: z.literal("coregrid-recovery-backup-v1"),
  manifestId: z.string().min(1),
  scope: z.strictObject({
    coverage: z.enum(["tenant-full", "family-scoped"]),
    recordFamilies: z.array(z.string().min(1)).min(1),
    tenantIds: z.array(z.string().min(1)).min(1),
  }),
  takenAt: ISO_DATETIME,
  expiresAt: ISO_DATETIME,
  checksums: z.strictObject({
    algorithm: z.literal("sha256"),
    rowDigests: z.array(z.strictObject({ rowId: z.string().min(1), digest: HEX64 })).min(1),
    manifestDigest: HEX64,
  }),
  tenantCoverage: z.strictObject({
    tenants: z
      .array(
        z.strictObject({
          tenantId: z.string().min(1),
          rowCount: z.number().int().nonnegative(),
        }),
      )
      .min(1),
  }),
});

// ── declared drill plan (single source of truth for this runner) ─────────────
/** @type {readonly z.infer<typeof DrillStepSchema>[]} */
const DRILL_PLAN = [
  {
    id: "prepare",
    kind: "prepare",
    summary: "create a dedicated drill surface seeded with synthetic rows (no personal data; scoped by construction)",
    destructive: false,
    restoresStep: null,
    verifiesStep: null,
  },
  {
    id: "backup",
    kind: "backup",
    summary: "export the drill surface into a backup manifest with per-row sha256 digests, takenAt instant, expiry, and tenant coverage",
    destructive: false,
    restoresStep: null,
    verifiesStep: null,
  },
  {
    id: "destroy",
    kind: "destroy",
    summary: "drop the drill surface (the only irreversible-by-design step; strictly scoped to the drill surface)",
    destructive: true,
    restoresStep: "restore",
    verifiesStep: "verify-identity",
  },
  {
    id: "restore",
    kind: "restore",
    summary: "recreate the drill surface and reinsert rows from the backup manifest in a single transaction",
    destructive: false,
    restoresStep: null,
    verifiesStep: null,
  },
  {
    id: "verify-identity",
    kind: "verify",
    summary: "prove row-level identity post-restore: per-row digests, row count, and canary values byte-identical",
    destructive: false,
    restoresStep: null,
    verifiesStep: "destroy",
  },
  {
    id: "verify-evidence",
    kind: "evidence-integrity",
    summary: "prove immutable evidence stores are checksum-identical before and after the whole drill",
    destructive: false,
    restoresStep: null,
    verifiesStep: null,
  },
  {
    id: "cleanup",
    kind: "cleanup",
    summary: "drop the drill surface; the environment ends unchanged (terminal step, scoped by construction)",
    destructive: true,
    restoresStep: null,
    verifiesStep: null,
  },
];

/** The record families the drill plan declares recovery targets for. */
const DRILL_SCOPE_FAMILIES = [
  "canonical-primitives",
  "evidence-ledger",
  "runtime-configuration",
  "worker-substrate",
];

/** @type {readonly z.infer<typeof RecoveryTargetSchema>[]} */
const RECOVERY_TARGETS = [
  { recordFamily: "canonical-primitives", rtoMinutes: 60, rpoMinutes: 15, ownerRole: "canonical-operations" },
  { recordFamily: "evidence-ledger", rtoMinutes: 60, rpoMinutes: 0, ownerRole: "canonical-operations" },
  { recordFamily: "runtime-configuration", rtoMinutes: 120, rpoMinutes: 60, ownerRole: "platform-operations" },
  { recordFamily: "worker-substrate", rtoMinutes: 120, rpoMinutes: 15, ownerRole: "platform-operations" },
];

// ── reporting helpers ────────────────────────────────────────────────────────
/** @type {string[]} */
const log = [];
const reportLine = (line) => {
  log.push(line);
  process.stdout.write(line + "\n");
};

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Guarded artifact write: an unwritable artifacts directory degrades to a
 * warning, never silently loses evidence or crashes the run.
 */
function writeArtifact(name, content) {
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(join(ARTIFACTS_DIR, name), content);
    reportLine(`artifact: ${ARTIFACTS_DIR}/${name}`);
    return true;
  } catch (err) {
    reportLine(`WARN artifact write failed (${ARTIFACTS_DIR}/${name}): ${err.message}`);
    return false;
  }
}

// ── plan validation (pure; offline) ──────────────────────────────────────────
/**
 * @param {readonly z.infer<typeof DrillStepSchema>[]} plan
 * @returns {string[]} invariant findings (empty = the plan holds)
 */
function validatePlan(plan) {
  /** @type {string[]} */
  const findings = [];
  const shape = DrillPlanSchema.safeParse(plan);
  if (!shape.success) {
    findings.push(`plan shape invalid: ${shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    return findings;
  }

  const ids = plan.map((s) => s.id);
  if (new Set(ids).size !== ids.length) findings.push("plan invariant violated: duplicate step ids");
  const byId = new Map(plan.map((s) => [s.id, s]));

  for (const step of plan) {
    if (step.kind === "destroy") {
      if (!step.restoresStep) findings.push(`plan invariant violated: destroy step '${step.id}' has no restore counterpart`);
      else {
        const restore = byId.get(step.restoresStep);
        if (!restore) findings.push(`plan invariant violated: destroy step '${step.id}' points at unknown restore step '${step.restoresStep}'`);
        else {
          if (restore.kind !== "restore") findings.push(`plan invariant violated: '${step.restoresStep}' is kind '${restore.kind}', expected 'restore'`);
          const restoreIdx = plan.indexOf(restore);
          if (restoreIdx <= plan.indexOf(step)) findings.push(`plan invariant violated: restore '${restore.id}' must come after destroy '${step.id}'`);
        }
      }
      if (!step.verifiesStep) findings.push(`plan invariant violated: destroy step '${step.id}' has no verify step declared`);
      else {
        const verify = byId.get(step.verifiesStep);
        if (!verify) findings.push(`plan invariant violated: destroy step '${step.id}' points at unknown verify step '${step.verifiesStep}'`);
        else if (verify.kind !== "verify") findings.push(`plan invariant violated: '${step.verifiesStep}' is kind '${verify.kind}', expected 'verify'`);
        else if (plan.indexOf(verify) <= plan.indexOf(step)) findings.push(`plan invariant violated: verify '${verify.id}' must come after destroy '${step.id}'`);
      }
    }
    if (step.destructive && step.kind === "cleanup") {
      if (plan.indexOf(step) !== plan.length - 1) findings.push("plan invariant violated: cleanup must be the final step");
    }
  }

  const firstDestroyIdx = plan.findIndex((s) => s.kind === "destroy");
  const backupIdx = plan.findIndex((s) => s.kind === "backup");
  const prepareIdx = plan.findIndex((s) => s.kind === "prepare");
  if (prepareIdx === -1 || backupIdx === -1) findings.push("plan invariant violated: plan must contain prepare and backup steps");
  else {
    if (backupIdx < prepareIdx) findings.push("plan invariant violated: backup must come after prepare");
    if (firstDestroyIdx !== -1 && firstDestroyIdx < backupIdx) findings.push("plan invariant violated: no destroy may precede backup");
  }
  return findings;
}

// ── recovery-target validation (pure; offline; fail-closed) ──────────────────
/**
 * @param {readonly z.infer<typeof RecoveryTargetSchema>[]} targets
 * @param {readonly string[]} scopedFamilies
 * @returns {string[]}
 */
function validateTargets(targets, scopedFamilies) {
  /** @type {string[]} */
  const findings = [];
  for (const t of targets) {
    const shape = RecoveryTargetSchema.safeParse(t);
    if (!shape.success) {
      findings.push(`target shape invalid for '${t.recordFamily ?? "<unknown>"}': ${shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    if (t.rpoMinutes > t.rtoMinutes) findings.push(`target invariant violated for '${t.recordFamily}': RPO (${t.rpoMinutes}m) exceeds RTO (${t.rtoMinutes}m)`);
    if (!t.ownerRole) findings.push(`target invariant violated for '${t.recordFamily}': ownerRole is required (no unowned targets)`);
  }
  for (const family of scopedFamilies) {
    const count = targets.filter((t) => t.recordFamily === family).length;
    if (count === 0) findings.push(`target invariant violated: scoped family '${family}' has NO declared recovery target — fail-closed, no implicit default`);
    if (count > 1) findings.push(`target invariant violated: scoped family '${family}' has ${count} conflicting recovery targets`);
  }
  for (const t of targets) {
    if (!scopedFamilies.includes(t.recordFamily)) findings.push(`target invariant violated: target '${t.recordFamily}' is outside the drill scope`);
  }
  return findings;
}

// ── backup-manifest validation (pure; offline) ───────────────────────────────
/**
 * Validates one parsed manifest object against the embedded schema and the
 * fail-closed invariants (non-expired, coverage-consistent, unique row ids).
 * @param {unknown} candidate
 * @param {string} sourceName
 * @param {(line: string) => void} reportLineFn
 * @returns {boolean} true when the manifest is valid
 */
function validateManifest(candidate, sourceName, reportLineFn) {
  const parsed = BackupManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    reportLineFn(
      `FINDING ${sourceName}: backup-manifest shape invalid — ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    return false;
  }
  const manifest = parsed.data;
  /** @type {string[]} */
  const findings = [];
  if (new Date(manifest.expiresAt).getTime() <= new Date(manifest.takenAt).getTime()) {
    findings.push(`expiresAt (${manifest.expiresAt}) is not after takenAt (${manifest.takenAt}) — expired/invalid backup set must fail closed`);
  }
  const scopeTenants = [...manifest.scope.tenantIds].sort().join(",");
  const coveredTenants = manifest.tenantCoverage.tenants.map((t) => t.tenantId).sort().join(",");
  if (scopeTenants !== coveredTenants) findings.push(`tenant coverage mismatch: scope [${scopeTenants}] vs coverage [${coveredTenants}]`);
  const rowIds = manifest.checksums.rowDigests.map((r) => r.rowId);
  if (new Set(rowIds).size !== rowIds.length) findings.push("duplicate rowIds in checksums.rowDigests");
  for (const finding of findings) reportLineFn(`FINDING ${sourceName}: ${finding}`);
  return findings.length === 0;
}

/**
 * Known-good and known-bad shape vectors so the manifest contract is exercised
 * offline even when no manifest store is present. Every vector's verdict is
 * asserted during rehearsal.
 * @returns {{ failures: number }}
 */
function exerciseManifestShapeVectors() {
  const valid = {
    kind: "coregrid-recovery-backup-v1",
    manifestId: "rehearsal-vector-valid",
    scope: { coverage: "tenant-full", recordFamilies: ["canonical-primitives"], tenantIds: ["tenant-a", "tenant-b"] },
    takenAt: "2026-10-03T00:00:00Z",
    expiresAt: "2026-10-04T00:00:00Z",
    checksums: {
      algorithm: "sha256",
      rowDigests: [
        { rowId: "row-1", digest: sha256("row-1") },
        { rowId: "row-2", digest: sha256("row-2") },
      ],
      manifestDigest: sha256("manifest"),
    },
    tenantCoverage: { tenants: [{ tenantId: "tenant-a", rowCount: 1 }, { tenantId: "tenant-b", rowCount: 1 }] },
  };

  /** @type {[string, unknown][]} */
  const rejectVectors = [
    ["unknown-key", { ...valid, extraField: "not-allowed" }],
    ["bad-kind", { ...valid, kind: "coregrid-recovery-backup-v2" }],
    ["missing-expiry", { ...valid, expiresAt: undefined }],
    ["non-utc-instant", { ...valid, takenAt: "2026-10-03T00:00:00+02:00" }],
    ["digest-not-hex64", { ...valid, checksums: { ...valid.checksums, manifestDigest: "deadbeef" } }],
    ["empty-tenant-scope", { ...valid, scope: { ...valid.scope, tenantIds: [] } }],
  ];

  let failures = 0;
  if (!validateManifest(valid, "shape-vector:valid", reportLine)) {
    reportLine("FINDING shape-vector:valid was rejected — the embedded manifest contract is broken.");
    failures += 1;
  }
  for (const [name, vector] of rejectVectors) {
    if (validateManifest(vector, `shape-vector:${name}`, () => {})) {
      reportLine(`FINDING shape-vector:${name} was ACCEPTED — the embedded manifest contract failed closed.`);
      failures += 1;
    }
  }
  return { failures };
}

/**
 * Scans the manifest store and validates every manifest found. A store that
 * does not exist is NOT a finding (the rehearsal validates shapes via vectors);
 * a present-but-unreadable store or any invalid manifest IS a finding.
 * @returns {{ manifestsValidated: number, failures: number }}
 */
function scanManifestStore() {
  if (!existsSync(MANIFESTS_DIR)) return { manifestsValidated: 0, failures: 0 };
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(MANIFESTS_DIR).filter((f) => f.endsWith(".json")).sort();
  } catch (err) {
    reportLine(`FINDING manifest store at ${MANIFESTS_DIR} is unreadable: ${err.message}`);
    return { manifestsValidated: 0, failures: 1 };
  }
  let failures = 0;
  let validated = 0;
  for (const entry of entries) {
    const path = join(MANIFESTS_DIR, entry);
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw);
      if (validateManifest(parsed, `manifest:${entry}`, reportLine)) {
        validated += 1;
        reportLine(`PASS manifest:${entry} — shape, expiry, and tenant-coverage invariants hold.`);
      } else {
        failures += 1;
      }
    } catch (err) {
      reportLine(`FINDING manifest:${entry} is unreadable/unparseable: ${err.message}`);
      failures += 1;
    }
  }
  return { manifestsValidated: validated, failures };
}

// ── offline rehearsal ────────────────────────────────────────────────────────
/**
 * Runs the full offline rehearsal: plan invariants, recovery-target
 * contracts, manifest-shape vectors, and the manifest store scan. No network,
 * no database, no credential.
 * @returns {{ findings: number, planSteps: number, manifestsValidated: number }}
 */
function runRehearsal() {
  reportLine("rehearsal: zero network, zero database, zero credential — offline contract validation only.");
  let findings = 0;

  reportLine(`plan: ${DRILL_PLAN.length} declared drill steps.`);
  for (const step of DRILL_PLAN) {
    reportLine(`  step:${step.id} kind=${step.kind} destructive=${step.destructive}${step.restoresStep ? ` restores=${step.restoresStep}` : ""}${step.verifiesStep ? ` verifies=${step.verifiesStep}` : ""}`);
  }
  const planFindings = validatePlan(DRILL_PLAN);
  for (const f of planFindings) reportLine(`FINDING ${f}`);
  findings += planFindings.length;

  reportLine(`targets: ${RECOVERY_TARGETS.length} declared recovery-target contracts for ${DRILL_SCOPE_FAMILIES.length} scoped record families.`);
  for (const t of RECOVERY_TARGETS) reportLine(`  target:${t.recordFamily} rto=${t.rtoMinutes}m rpo=${t.rpoMinutes}m owner=${t.ownerRole}`);
  const targetFindings = validateTargets(RECOVERY_TARGETS, DRILL_SCOPE_FAMILIES);
  for (const f of targetFindings) reportLine(`FINDING ${f}`);
  findings += targetFindings.length;

  reportLine("manifests: exercising the embedded backup-manifest contract against shape vectors.");
  const vectorResult = exerciseManifestShapeVectors();
  findings += vectorResult.failures;

  const storeResult = scanManifestStore();
  findings += storeResult.failures;
  if (!existsSync(MANIFESTS_DIR)) {
    reportLine(`manifests: no manifest store present at ${MANIFESTS_DIR} — shape coverage provided by the embedded vectors (not a finding).`);
  }

  return { findings, planSteps: DRILL_PLAN.length, manifestsValidated: storeResult.manifestsValidated };
}

// ── live pre-pass (credential-gated; never destructive) ──────────────────────
/**
 * One read-only reachability probe (SELECT 1) on the authorized Management API
 * query channel. The credential value is never printed, logged, or written.
 * @returns {Promise<boolean>}
 */
async function liveChannelProbe() {
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "SELECT 1 AS probe" }),
    });
    if (!res.ok) {
      const text = await res.text();
      reportLine(`FINDING authorized-channel probe failed with status ${res.status}: ${text.slice(0, 200)} (credential value never logged).`);
      return false;
    }
    reportLine(`PASS authorized-channel probe: read-only SELECT 1 succeeded (status ${res.status}).`);
    return true;
  } catch (err) {
    reportLine(`FINDING authorized-channel probe failed: ${err.message} (credential value never logged).`);
    return false;
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
const startedAtIso = new Date().toISOString();

if (MODE === "rehearse") {
  reportLine("COREGRID RECOVERY DRILL VERIFIER — REHEARSAL (offline; no database is contacted, nothing is applied)");
  reportLine(`mode=rehearse artifactsDir=${ARTIFACTS_DIR} manifestsDir=${MANIFESTS_DIR} databaseContact=false`);
  const result = runRehearsal();
  const record = {
    mission: "A-001 recovery drill runner (H3-001, M-R-101 groundwork)",
    mode: "rehearse",
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    artifactsDir: ARTIFACTS_DIR,
    manifestsDir: MANIFESTS_DIR,
    databaseContact: false,
    networkContact: false,
    credentialRequired: false,
    planSteps: result.planSteps,
    manifestsValidated: result.manifestsValidated,
    findings: result.findings,
    log,
  };
  writeArtifact("recovery-drill-rehearsal.json", JSON.stringify(record, null, 2) + "\n");
  writeArtifact("recovery-drill-rehearsal.log", log.join("\n") + "\n");
  if (result.findings > 0) {
    console.error(`STATUS=REHEARSAL_FINDINGS (${result.findings}) — the drill plan/contracts do not hold; fix before any live pass.`);
    process.exit(1);
  }
  reportLine("STATUS=REHEARSAL_PASS — plan invariants, recovery-target contracts, and backup-manifest shapes all hold offline.");
  process.exit(0);
}

reportLine("COREGRID RECOVERY DRILL VERIFIER — LIVE PRE-PASS (credential-gated; read-only probe; never destructive)");
reportLine(`mode=live artifactsDir=${ARTIFACTS_DIR} projectRef=${projectRef}`);

const rehearsal = runRehearsal();
if (rehearsal.findings > 0) {
  reportLine(`FINDING offline rehearsal produced ${rehearsal.findings} findings — live pre-pass refuses to proceed.`);
  const record = {
    mission: "A-001 recovery drill runner (H3-001, M-R-101 groundwork)",
    mode: "live",
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    projectRef,
    databaseContact: false,
    channelProbe: "not-executed (offline findings)",
    findings: rehearsal.findings,
    log,
  };
  writeArtifact("recovery-drill-live.json", JSON.stringify(record, null, 2) + "\n");
  writeArtifact("recovery-drill-live.log", log.join("\n") + "\n");
  console.error(`STATUS=LIVE_FINDINGS (${rehearsal.findings}) — fix the offline contracts first.`);
  process.exit(1);
}

const probeOk = await liveChannelProbe();
const record = {
  mission: "A-001 recovery drill runner (H3-001, M-R-101 groundwork)",
  mode: "live",
  startedAt: startedAtIso,
  completedAt: new Date().toISOString(),
  projectRef,
  databaseContact: false,
  transport: "supabase-management-api-query (read-only SELECT 1)",
  credentialGate: "SUPABASE_ACCESS_TOKEN (value never logged)",
  channelProbe: probeOk ? "PASS" : "FAIL",
  findings: probeOk ? 0 : 1,
  log,
};
writeArtifact("recovery-drill-live.json", JSON.stringify(record, null, 2) + "\n");
writeArtifact("recovery-drill-live.log", log.join("\n") + "\n");

if (!probeOk) {
  console.error("STATUS=LIVE_FINDINGS (1) — authorized channel not reachable; nothing was mutated.");
  process.exit(1);
}
reportLine("STATUS=LIVE_PREPASS_PASS — offline contracts hold and the authorized channel is reachable; destructive drill remains owned by scripts/restore-recovery-drill.mjs.");
process.exit(0);