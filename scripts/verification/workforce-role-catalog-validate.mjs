#!/usr/bin/env node
/**
 * DECISIONS.md #206 (PLATFORM-015) — V1 AI Workforce Scope Lock validator.
 *
 * Enforces, machine-readably:
 *  1. the role catalog passes fail-closed schema + cross-field validation;
 *  2. every V1 role's substrateRefs point at files/directories that EXIST in
 *     the repository (the "reuse existing architecture, no duplicate systems"
 *     law becomes a build gate — a V1 role cannot be registered against a
 *     capability surface that has no in-repo owner);
 *  3. the executive control plane is singular: exactly one role carries the
 *     persistent_control_plane policy (Jarvis), and it holds NO execute/
 *     approve/deploy authority (directive §3 — Jarvis commands, the
 *     organization works);
 *  4. every non-V1 role is frozen (activation requires a human authorization
 *     record — AGENTS.md §45);
 *  5. the executive loop module resolves and imports cleanly (the V1 Jarvis
 *     planning slice stays wired to the catalog it staffs against).
 *
 * Exit codes: 0 PASS, 1 FINDING.
 */
import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT_RAW = fileURLToPath(new URL("../..", import.meta.url));
const ROOT = ROOT_RAW.endsWith(sep) ? ROOT_RAW.slice(0, -sep.length) : ROOT_RAW;
const jiti = createJiti(join(ROOT, "scripts", "verification", "workforce-role-catalog-validate.mjs"));

function fail(message) {
  console.error(`WORKFORCE-SCOPE-LOCK FINDING: ${message}`);
  process.exit(1);
}

const catalogModule = await jiti.import(join(ROOT, "frontend/src/lib/workforce/role-catalog.ts"));
const loopModule = await jiti.import(join(ROOT, "frontend/src/lib/jarvis/executive-loop.ts"));

const roles = catalogModule.WORKFORCE_ROLE_CATALOG_VALIDATED;
if (!Array.isArray(roles) || roles.length === 0) {
  fail("role catalog is empty or unvalidated");
}

const findings = [];

// 1. Catalog-level validation (defence in depth — the module already throws).
const validation = catalogModule.validateWorkforceRoleCatalog(roles);
if (!validation.ok) fail(`catalog validation failed: ${validation.errors.join("; ")}`);

// 2. Substrate existence — every substrateRef must exist on disk.
for (const role of roles) {
  for (const ref of role.substrateRefs) {
    const abs = resolve(ROOT, ref);
    if (!abs.startsWith(ROOT + sep) && abs !== ROOT) {
      findings.push(`${role.roleId}: substrate ref escapes the repository: ${ref}`);
      continue;
    }
    if (!existsSync(abs)) {
      findings.push(`${role.roleId}: substrate ref does not exist in-repo: ${ref}`);
    }
  }
}

// 3. Executive control plane is singular and proposal-only.
const persistent = roles.filter((role) => role.instantiationPolicy === "persistent_control_plane");
if (persistent.length !== 1) {
  findings.push(`expected exactly 1 persistent_control_plane role (Jarvis), found ${persistent.length}`);
}
const jarvis = roles.find((role) => role.roleId === "jarvis");
if (!jarvis) {
  findings.push("jarvis role missing from catalog");
} else {
  const forbiddenAuthority = ["execute", "approve", "deploy"].filter((authority) =>
    jarvis.authorityLevels.includes(authority),
  );
  if (forbiddenAuthority.length > 0) {
    findings.push(`jarvis must never hold ${forbiddenAuthority.join("/")} authority (directive §3)`);
  }
  if (jarvis.classification !== "V1") findings.push("jarvis must be classified V1");
}

// 4. Non-V1 roles frozen.
for (const role of roles) {
  if (role.classification !== "V1" && role.instantiationPolicy !== "frozen") {
    findings.push(`${role.roleId}: non-V1 role is not frozen`);
  }
  if (role.classification === "V1" && role.substrateRefs.length === 0) {
    findings.push(`${role.roleId}: V1 role has no substrate`);
  }
}

// 5. Executive loop resolves and staffs against the catalog.
if (typeof loopModule.runExecutiveLoop !== "function") {
  findings.push("executive-loop.ts did not export runExecutiveLoop — Jarvis V1 slice is unwired");
}

// 6. Workforce performance lens (DECISIONS.md #207 / PLATFORM-016) resolves,
//    computes deterministically, and never fabricates unobservable metrics.
const metricsModule = await jiti.import(join(ROOT, "frontend/src/lib/workforce/performance-metrics.ts"));
if (typeof metricsModule.computeWorkforcePerformance !== "function") {
  findings.push("performance-metrics.ts did not export computeWorkforcePerformance — §40 lens is unwired");
} else {
  const mission = {
    missionId: "gate-m-1",
    schemaVersion: "1.0",
    tenantId: "tenant-gate",
    objective: "gate probe",
    nonScope: [],
    ownerRef: "owner-gate",
    actorRefs: ["worker-gate"],
    authorizedActions: ["observe"],
    tasks: [{ taskId: "gate-t-1", title: "task", authorizedActions: ["observe"], requiredEvidenceKinds: ["test_report"] }],
    admissionGates: [{ gateId: "gate-g-1", kind: "definition", reason: "gate" }],
    successCriteria: ["verified"],
    requiredEvidenceKinds: ["test_report"],
    lifecycle: "SUCCEEDED",
    expiresAt: null,
    provenance: {
      declaredBy: "jarvis",
      declaredAt: "2026-10-06T00:00:00.000Z",
      authorityRef: "DECISIONS.md#207",
      contextRef: null,
      sourceRef: null,
      generatedByAi: true,
      verified: false,
    },
  };
  try {
    const gateReport = metricsModule.computeWorkforcePerformance({
      tenantId: "tenant-gate",
      now: "2026-10-07T04:00:00.000Z",
      missions: [mission],
      evidence: [],
      transitions: [
        { missionId: "gate-m-1", actorId: "worker-gate", from: "RUNNING", to: "SUCCEEDED", at: "2026-10-06T02:00:00.000Z" },
      ],
    });
    const m = gateReport.metrics;
    if (m.missionCompletionRate.status !== "computed" || m.missionCompletionRate.value !== 1) {
      findings.push("performance lens golden probe: completion rate did not compute to 1");
    }
    if (m.meanTimeToCompletionMs.status !== "computed" || m.meanTimeToCompletionMs.value !== 7200000) {
      findings.push("performance lens golden probe: mean time to completion did not compute to 7200000ms");
    }
    for (const key of ["tokenUsage", "computeCost", "toolErrors", "securityViolations"]) {
      if (m[key].status !== "not_observable" || m[key].value !== null) {
        findings.push(`performance lens golden probe: ${key} must be not_observable (§65 — never invented)`);
      }
    }
  } catch (error) {
    findings.push(`performance lens golden probe threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const histogram = catalogModule.workforceScopeHistogram();
const expectedTotal = roles.length;
const histogramTotal = Object.values(histogram).reduce((sum, count) => sum + count, 0);
if (histogramTotal !== expectedTotal) {
  findings.push(`scope histogram total ${histogramTotal} != catalog size ${expectedTotal}`);
}

if (findings.length > 0) {
  fail(`\n  - ${findings.join("\n  - ")}`);
}

const rel = (p) => relative(ROOT, p);
console.log(
  `WORKFORCE-SCOPE-LOCK PASS — ${expectedTotal} roles classified ` +
    `(V1=${histogram.V1}, V2=${histogram.V2}, DEFERRED_BEYOND_V2=${histogram.DEFERRED_BEYOND_V2}, ` +
    `REQUIRES_ARCHITECTURAL_DECISION=${histogram.REQUIRES_ARCHITECTURAL_DECISION}); ` +
    `all V1 substrate refs exist in-repo; executive control plane singular (jarvis, proposal-only); ` +
    `executive loop wired (${rel(join(ROOT, "frontend/src/lib/jarvis/executive-loop.ts"))}); ` +
    `performance lens wired and §65-honest (${rel(join(ROOT, "frontend/src/lib/workforce/performance-metrics.ts"))}).`,
);