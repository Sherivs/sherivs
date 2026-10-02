#!/usr/bin/env node
/**
 * CoreGrid registry test-attribution regenerator (MISSION-R-04 / J-046 / COND-012).
 *
 * Attributes every unit test file the verify pipeline executes to exactly one
 * registry phase (or records it as explicitly unattributed with a TODO), so
 * that sum(phases[].tests) + unattributed == the verified suite total.
 *
 * Attribution rule (honesty law — never invent ownership):
 *  1. kernel phase-contract citations win (same citation rule as
 *     scripts/audit-phase-completion.mjs);
 *  2. otherwise, an explicit subject-matter mapping below (each entry carries
 *     its rationale);
 *  3. otherwise the file is recorded UNATTRIBUTED with a TODO — never guessed.
 *
 * Usage:
 *   npx vitest run --reporter=json --outputFile=/tmp/vitest-results.json
 *   node scripts/verification/registry-test-attribution.mjs /tmp/vitest-results.json
 *
 * Exits non-zero if a test file is neither cited, mapped nor explicitly
 * unattributed (the mapping must be maintained as suites land), or if the
 * resulting accounting does not sum to the measured suite.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const resultsPath = process.argv[2];
if (!resultsPath) {
  console.error("usage: node scripts/verification/registry-test-attribution.mjs <vitest-json-results>");
  process.exit(1);
}

const registryPath = join(root, "architecture", "registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const results = JSON.parse(readFileSync(resultsPath, "utf8"));

// ── 1. measured per-file counts from the vitest JSON report ────────────────
const measured = new Map(); // absolute-ish repo-relative file -> {tests, skipped}
for (const tr of results.testResults ?? []) {
  const file = tr.name.replace(/^.*?(tests\/)/, "$1").replace(/\\/g, "/");
  let tests = 0;
  let skipped = 0;
  for (const a of tr.assertionResults ?? []) {
    if (a.status === "skipped" || a.status === "todo") skipped += 1;
    else tests += 1;
  }
  measured.set(file, { tests, skipped });
}

// ── 2. contract citations (audit-phase-completion rule) ────────────────────
const contractDir = join(root, "frontend/src/lib/kernel/phase-contracts");
const citations = new Map(); // test file -> Set(phase id)
for (const f of readdirSync(contractDir)) {
  const m = f.match(/^phase-(\d\d)-/);
  if (!m) continue;
  const text = readFileSync(join(contractDir, f), "utf8");
  const refs = new Set();
  const tm = text.match(/tests:\s*\[([^\]]*)\]/s);
  if (tm) for (const mm of tm[1].matchAll(/"([^"]+)"/g)) if (mm[1].includes(".test.")) refs.add(mm[1]);
  for (const mm of text.matchAll(/"([^\s\n]+\.test\.tsx?)"/g)) refs.add(mm[1]);
  for (const r of refs) {
    const key = r.replace(/\\/g, "/");
    if (!citations.has(key)) citations.set(key, new Set());
    citations.get(key).add(m[1]);
  }
}

// Multi-cited files where contracts disagree: tie-break to the phase whose
// registry modules own the tested module (recorded, never silent).
const TIE_BREAK = {
  "tests/unit/kernel-runtime-registry.test.ts": {
    phase: "33",
    why: "kernel/runtime-registry is a phase-33 registry module; phase-05 also cites the suite",
  },
};

// ── 3. subject-matter attribution for mission-owned / uncited suites ──────
const SUBJECT_MAP = {
  "tests/unit/foundation-standards.test.ts": { phase: "01", why: "S1 foundation-standards hardening suite (phase-01 note)" },
  "tests/unit/env.test.ts": { phase: "01", why: "environment verification contract (phase-01 verify contracts)" },
  "tests/unit/minimal.test.ts": { phase: "01", why: "foundation smoke suite" },
  "tests/unit/phase-catalog.test.ts": { phase: "01", why: "catalog/registry integrity — phase-01 registry verification" },
  "tests/unit/phase-acceptance-audit.test.ts": { phase: "01", why: "verifies the phase-acceptance audit machinery — phase-01 verification contract" },
  "tests/unit/phase-acceptance-probes.test.ts": { phase: "01", why: "acceptance probe machinery — phase-01 verification contract" },
  "tests/unit/phase-completion-audit.test.ts": { phase: "01", why: "verifies scripts/audit-phase-completion.mjs — phase-01 verification contract" },
  "tests/unit/platform-neutrality.test.ts": { phase: "01", why: "kernel neutrality law (neutralise-scholar-framing --check) — phase-01 kernel contract layer enforcement" },
  "tests/unit/kernel-capability-registry.test.ts": { phase: "01", why: "kernel/kernel-capability-registry module — phase-01 kernel contract layer" },
  "tests/unit/kernel-contract-coverage.test.ts": { phase: "01", why: "kernel/phase-contract + engineering-sections — phase-01 kernel contract layer" },
  "tests/unit/auth-helpers.test.ts": { phase: "02", why: "frontend/src/lib/auth-helpers — identity credential/session helpers (phase-02 identity)" },
  "tests/unit/roles.test.ts": { phase: "02", why: "role vocabulary substrate (phase-02 roles module)" },
  "tests/unit/identity-actor.test.ts": { phase: "02", why: "identity actor model (phase-02 identity)" },
  "tests/unit/identity-lifecycle-enforcement.test.ts": { phase: "02", why: "identity lifecycle gate enforcement (phase-02 identity lifecycle)" },
  "tests/unit/org-model.test.ts": { phase: "03", why: "organization model over tenant-core (phase-03 tenancy)" },
  "tests/unit/runtime-scholar-events.test.ts": { phase: "04", why: "runtime/scholar-events — phase-04 registry module" },
  "tests/unit/runtime-scholar-reality.test.ts": { phase: "04", why: "Scholar reality consumption over the kernel substrate (phase-04 runtime/scholar)" },
  "tests/unit/surface-renderers.test.ts": { phase: "04", why: "Scholar surface composition from the scholar dashboards/roles engines (phase-04 runtime domain layer)" },
  "tests/unit/school-templates.test.ts": { phase: "04", why: "runtime/scholar-school-templates provisioning flow (phase-04 runtime domain layer; feeds from the phase-25 onboarding template engine)" },
  "tests/unit/scholar-vertical-bindings.test.ts": { phase: "04", why: "locks the runtime-001 vertical binding map (runtime/scholar-vertical-bindings — phase-04 runtime)" },
  "tests/unit/runtime-self-report.test.ts": { phase: "05", why: "runtime-self-report — phase-05 registry module" },
  "tests/unit/observability-health.test.ts": { phase: "05", why: "runtime observability health — phase-05 runtime-observability substrate" },
  "tests/unit/observability-structured-log.test.ts": { phase: "05", why: "observability/structured-log — phase-05 runtime-observability substrate" },
  "tests/unit/workspace.test.ts": { phase: "06", why: "workspace engine (phase-06 workspace-* modules)" },
  "tests/unit/workspace-experience.test.ts": { phase: "06", why: "workspace experience composition (phase-06 workspace-composition)" },
  "tests/unit/workspace-projection.test.ts": { phase: "06", why: "workspace-projection — phase-06 registry module" },
  "tests/unit/workspace-views.test.ts": { phase: "06", why: "workspace view projection (phase-06 workspace-projection)" },
  "tests/unit/page-tips.test.ts": { phase: "06", why: "per-page tips — recorded phase-06 deliverable" },
  "tests/unit/agent-governance-report.test.ts": { phase: "07", why: "agent-governance-report — phase-07 registry module" },
  "tests/unit/agent-runtime-lifecycle.test.ts": { phase: "07", why: "agent runtime lifecycle (phase-07 agent-core/agent-tasks)" },
  "tests/unit/agent-runtime-mission-runner.test.ts": { phase: "07", why: "agent mission runner (phase-07 agent-plans/agent-tasks)" },
  "tests/unit/jarvis-briefing.test.ts": { phase: "07", why: "Jarvis V5.3 Part 15 agent capability boundary (phase-07 agent governance)" },
  "tests/unit/jarvis-contract.test.ts": { phase: "07", why: "Jarvis V5.3 Part 15 agent capability boundary (phase-07 agent governance)" },
  "tests/unit/jarvis-escalation.test.ts": { phase: "07", why: "Jarvis V5.3 Part 15 agent capability boundary (phase-07 agent governance)" },
  "tests/unit/authorization-exhaustive.test.ts": { phase: "08", why: "frontend/src/lib/authorization.ts — the V1CAP-016 layered authorization decision engine (phase-08 security enforcement)" },
  "tests/unit/p08-enforcement-surface.test.ts": { phase: "08", why: "machine-checks the phase-08 role-gate 19-family inventory (phase-08 note)" },
  "tests/unit/notifications-contract.test.ts": { phase: "10", why: "notification contract/dispatch — phase-10 communication delivery" },
  "tests/unit/notifications-dispatch-planner.test.ts": { phase: "10", why: "notification dispatch planning — phase-10 communication delivery" },
  "tests/unit/notifications-email-adapter.test.ts": { phase: "10", why: "notification email provider adapter — phase-10 communication providers" },
  "tests/unit/payments-contract.test.ts": { phase: "13", why: "payment contract (phase-13 financial-payments)" },
  "tests/unit/payments-paystack-adapter.test.ts": { phase: "13", why: "payment provider adapter — phase-13 financial-payments provider neutrality" },
  "tests/unit/payments-replay-guard.test.ts": { phase: "13", why: "payment replay protection (Constitution §36 payment security — phase-13 financial-controls)" },
  "tests/unit/payments-stripe-adapter.test.ts": { phase: "13", why: "payment provider adapter — phase-13 financial-payments provider neutrality" },
  "tests/unit/payments-paystack-testmode.test.ts": { phase: "13", why: "Paystack test-mode integration (signature/idempotency/replay/ownership/audit, Constitution §36) — phase-13 financial-payments adapter discipline" },
  "tests/unit/payments-paystack-testmode-live.test.ts": { phase: "13", why: "live-gated Paystack test-mode verification against api.paystack.co (sk_test_ only) — phase-13 financial-payments adapter discipline" },
  "tests/unit/metering-usage-ledger.test.ts": { phase: "13", why: "metering/usage-ledger — usage metering substrate toward phase-13's declared metering gap" },
  "tests/unit/subscription-tiers.test.ts": { phase: "13", why: "subscription tier billing vocabulary (phase-13 billing)" },
  "tests/unit/infrastructure-readiness.test.ts": { phase: "21", why: "infrastructure readiness for the phase-21 cloud fabric (infrastructure/ IaC deliverable)" },
  "tests/unit/context-assembly.test.ts": { phase: "26", why: "AI context assembly (phase-26 ai-context registry module)" },
  "tests/unit/ai-gateway.test.ts": { phase: "26", why: "AI gateway (Constitution §20) — phase-26 AI intelligence layer gateway substrate" },
  "tests/unit/ai-gateway-adoption-expense-insights.test.ts": { phase: "26", why: "AI gateway adoption at a server function (phase-26 ai-services)" },
  "tests/unit/ai-gateway-adoption-lesson-plan.test.ts": { phase: "26", why: "AI gateway adoption at a server function (phase-26 ai-services)" },
  "tests/unit/ai-gateway-adoption-timetable.test.ts": { phase: "26", why: "AI gateway adoption at a server function (phase-26 ai-services)" },
  "tests/unit/marketplace-surface.test.ts": { phase: "27", why: "marketplace surface (phase-27 marketplace-view consumption)" },
  "tests/unit/command-centre-contract-governance.test.ts": { phase: "19", why: "command-centre contract governance snapshot (phase-19 command-* modules)" },
  "tests/unit/context-package-completeness.test.ts": { phase: "26", why: "context-assembly package completeness/exclusion ledger (J-011/J-012 — phase-26 ai-context registry module)" },
  "tests/unit/education-reality-view.test.ts": { phase: "04", why: "education-reality-view — phase-04 registry module" },
  "tests/unit/platform-core.test.ts": { phase: "22", why: "platform-core — phase-22 registry module" },
  "tests/unit/platform-device.test.ts": { phase: "22", why: "platform-device — phase-22 registry module" },
  "tests/unit/platform-offline.test.ts": { phase: "22", why: "platform-offline — phase-22 registry module" },
  "tests/unit/platform-targets.test.ts": { phase: "22", why: "platform/platform-targets — client platform deploy targets (phase-22/23 platform family)" },
  "tests/unit/role-substrate-proof.test.ts": { phase: "02", why: "proof harness for the role-assignment substrate (phase-02 roles/identity substrate; npm run verify:role-substrate)" },
  "tests/unit/scholar-foundation-flow.test.ts": { phase: "04", why: "binds the foundation loop into the Scholar runtime (runtime/scholar-foundation-flow + scholar-consumption — phase-04 runtime); the loop machinery itself stays unowned (see UNATTRIBUTED)" },
  "tests/unit/universal-roles.test.ts": { phase: "02", why: "universal neutral role vocabulary + capability gate (V1CAP-014, recorded owner 'phase 02 with 08' in COREGRID_V1_RECONSTRUCTED_ARCHITECTURE)" },
  "tests/unit/workflow-contract.test.ts": { phase: "17", why: "workflow contract — phase-17 automation workflow orchestration (duplication D11 owner 17)" },
  "tests/unit/workflow-engine.test.ts": { phase: "17", why: "workflow engine — phase-17 automation workflow orchestration (duplication D11 owner 17)" },
  "tests/unit/kernel-reality.test.ts": { phase: "33", why: "kernel/reality — phase-33 registry module" },
  "tests/unit/kernel-domain-manifest.test.ts": { phase: "33", why: "kernel/domain-manifest — phase-33 registry module" },
  "tests/unit/kernel-envelope.test.ts": { phase: "33", why: "kernel envelope over kernel/reality + the envelope migration — phase-33 universal kernel substrate" },
  "tests/unit/kernel-object-type-registry.test.ts": { phase: "33", why: "kernel/object-type-registry — phase-33 kernel substrate" },
  "tests/unit/domain-config-definition.test.ts": { phase: "33", why: "domain-config runtime definition — phase-33 domain-runtime manifest machinery" },
  "tests/unit/domain-config-restaurant.test.ts": { phase: "33", why: "domain-config vertical instance — phase-33 domain-runtime machinery" },
  "tests/unit/db-tooling-coherence.test.ts": { phase: "33", why: "db tooling coherence — recorded phase-33 S2 deliverable (phase-33 note)" },
  // ── M-R-121 T2: §27 per-function invariant suites (Scholar server functions) ──
  "tests/unit/scholar-invariant-tenant-gated.test.ts": { phase: "08", why: "M-R-121 T2 §27 per-function invariant suites — tenant-gated Scholar server-function families (phase-08 security enforcement)" },
  "tests/unit/scholar-invariant-staff-platform-gated.test.ts": { phase: "08", why: "M-R-121 T2 §27 per-function invariant suites — staff/platform-gated Scholar server-function families (phase-08 security enforcement)" },
  "tests/unit/scholar-invariant-kernel-substrate.test.ts": { phase: "08", why: "M-R-121 T2 §27 per-function invariant suites — kernel-substrate Scholar server-function families (phase-08 security enforcement)" },
  "tests/unit/scholar-invariant-self-scope.test.ts": { phase: "08", why: "M-R-121 T2 §27 per-function invariant suites — self-scoped/RLS-scoped Scholar server-function families (phase-08 security enforcement)" },
  "tests/unit/scholar-invariant-environment-gated.test.ts": { phase: "08", why: "M-R-121 T2 §27 per-function invariant suites — environment-gated family + the 23-family §27 coverage ledger (phase-08 security enforcement)" },
  // ── Team 1 batch A substrate-persistence workstream (P08 foundation loop): wave-3 pure contracts given DB-backed adapters over migrations 20261002000005–08 (AUTHORED, NOT APPLIED); zero-policy deny-by-default RLS per §17/§28, service-role adapters only, J-045 failure semantics ──
  "tests/unit/adapter-reconciliation-store.test.ts": { phase: "33", why: "Team 1 batch A substrate-persistence workstream: DB-backed adapter for kernel/reconciliation (V1CAP-005/J-004/MISSION-R-14) over migrations 20261002000005 (AUTHORED, NOT APPLIED) — phase-33 universal kernel substrate" },
  "tests/unit/adapter-event-security-store.test.ts": { phase: "33", why: "Team 1 batch A substrate-persistence workstream: DB-backed adapter for kernel/event-security (V1CAP-044/J-022/MISSION-R-81) over migrations 20261002000006 (AUTHORED, NOT APPLIED) — phase-33 universal kernel substrate" },
  "tests/unit/adapter-event-routing-store.test.ts": { phase: "33", why: "Team 1 batch A substrate-persistence workstream: DB-backed adapter for kernel/event-routing (V1CAP-043/J-021/MISSION-R-63) over migrations 20261002000007 (AUTHORED, NOT APPLIED) — phase-33 universal kernel substrate" },
  "tests/unit/adapter-evidence-capture-store.test.ts": { phase: "09", why: "Team 1 batch A substrate-persistence workstream: DB-backed adapter for the evidence/capture lifecycle (J-034/V1CAP-059/MISSION-R-90, phase-09 Security Trust Fabric) over migration 20261002000008 (AUTHORED, NOT APPLIED)" },
  // ── Team 1 batch B substrate-persistence workstream (P08 foundation loop): wave-3 pure contracts given DB-backed adapters over migrations 20261002000009–12 (AUTHORED, NOT APPLIED); zero-policy deny-by-default RLS per §17/§28, service-role adapters only, J-045 failure semantics ──
  "tests/unit/adapter-reasoning-provenance.test.ts": { phase: "26", why: "Team 1 batch B substrate-persistence workstream: DB-backed adapter for the ai-gateway reasoning-provenance contract (J-015/V1CAP-029/MISSION-R-33) over migration 20261002000009 (AUTHORED, NOT APPLIED) — phase-26 AI intelligence layer gateway substrate, matching tests/unit/ai-gateway.test.ts" },
  "tests/unit/adapter-cost-attribution.test.ts": { phase: "13", why: "Team 1 batch B substrate-persistence workstream: DB-backed adapter for the metering cost-attribution contract (J-043/V1CAP-078/MISSION-R-70) over migration 20261002000010 (AUTHORED, NOT APPLIED) — phase-13 financial metering substrate, matching tests/unit/metering-usage-ledger.test.ts" },
  "tests/unit/adapter-knowledge-currency.test.ts": { phase: "36", why: "Team 1 batch B substrate-persistence workstream: DB-backed adapter for the memory knowledge-currency contract (J-019/V1CAP-040/MISSION-R-71) over migration 20261002000011 (AUTHORED, NOT APPLIED) — phase-36 Universal Memory & Knowledge Engine owner" },
  "tests/unit/adapter-tool-runtime.test.ts": { phase: "25", why: "Team 1 batch B substrate-persistence workstream: DB-backed adapter for the workforce tool-runtime contract (J-008/V1CAP-056/MISSION-R-62) over migration 20261002000012 (AUTHORED, NOT APPLIED) — phase-25 Institutional Onboarding & Workforce owner" },
};

// Scholar runtime domain layer: every scholar-* suite tests the Scholar
// runtime content that phase 04's row registers as its domain layer
// ("legacy education modules remain the runtime's domain layer" — phase-04 note).
const PREFIX_MAP = [
  { prefix: "tests/unit/scholar-", phase: "04", why: "Scholar runtime domain layer — registry module runtime/scholar (phase-04)" },
];

// Suites with no canonical phase owner: recorded unattributed with a TODO —
// never guessed (CG-GAP-003 universal mission owner decision pending; files
// substrate unregistered).
const UNATTRIBUTED = {
  "tests/unit/foundation-loop.test.ts": "foundation mission loop — mission machinery has no canonical phase owner (COREGRID_PHASE_RECONCILIATION_MAP / CG-GAP-003); control-plane substrate, not a phase. TODO: attribute when the owner is ratified.",
  "tests/unit/foundation-mission.test.ts": "foundation mission contract — same unowned-mission basis (CG-GAP-003). TODO: attribute when the owner is ratified.",
  "tests/unit/foundation-persistence.test.ts": "foundation mission persistence — same unowned-mission basis (CG-GAP-003). TODO: attribute when the owner is ratified.",
  "tests/unit/files-access-policy.test.ts": "files substrate (frontend/src/lib/files/) is not a registered phase module. TODO: attribute when a phase registers the files/storage substrate.",
  "tests/unit/files-contract.test.ts": "files substrate (frontend/src/lib/files/) is not a registered phase module. TODO: attribute when a phase registers the files/storage substrate.",
  "tests/unit/files-storage-adapter.test.ts": "files substrate (frontend/src/lib/files/) is not a registered phase module. TODO: attribute when a phase registers the files/storage substrate.",
  "tests/unit/storage-service-client.test.ts": "service-role storage client factory (frontend/src/lib/files/storage-service.server.ts) — files substrate is not a registered phase module. TODO: attribute when a phase registers the files/storage substrate.",
  "tests/unit/storage-service-live.test.ts": "live-gated service-role storage verification against the approved project — files substrate is not a registered phase module. TODO: attribute when a phase registers the files/storage substrate.",
};

// ── 4. attribute every measured unit test file ─────────────────────────────
const perPhase = new Map(); // phase id -> {tests, files}
const unattributed = [];
const errors = [];
let totalTests = 0;
let totalSkipped = 0;

const bump = (phase, file, n, method) => {
  if (!perPhase.has(phase)) perPhase.set(phase, { tests: 0, files: [] });
  const entry = perPhase.get(phase);
  entry.tests += n;
  entry.files.push(`${file} (${method})`);
};

for (const [file, { tests, skipped }] of measured) {
  totalTests += tests;
  totalSkipped += skipped;
  if (file.startsWith("tests/integration/")) {
    // live-gated integration battery: skipped without a database in CI
    if (tests > 0) unattributed.push({ file, tests, reason: "live integration battery (env-gated; not part of the unit attribution)" });
    continue;
  }
  const cited = citations.get(file);
  if (cited && cited.size === 1) {
    bump([...cited][0], file, tests, "contract citation");
    continue;
  }
  if (cited && cited.size > 1 && TIE_BREAK[file]) {
    bump(TIE_BREAK[file].phase, file, tests, `contract citation, tie-break: ${TIE_BREAK[file].why}`);
    continue;
  }
  if (SUBJECT_MAP[file]) {
    bump(SUBJECT_MAP[file].phase, file, tests, `subject-matter: ${SUBJECT_MAP[file].why}`);
    continue;
  }
  const prefix = PREFIX_MAP.find((p) => file.startsWith(p.prefix));
  if (prefix) {
    bump(prefix.phase, file, tests, `subject-matter: ${prefix.why}`);
    continue;
  }
  if (UNATTRIBUTED[file]) {
    unattributed.push({ file, tests, reason: UNATTRIBUTED[file] });
    continue;
  }
  errors.push(`unmapped test file (maintain SUBJECT_MAP or UNATTRIBUTED): ${file}`);
}

if (errors.length > 0) {
  console.error("ATTRIBUTION FAILED — unmapped files:");
  for (const e of errors) console.error(" - " + e);
  process.exit(1);
}

const attributedSum = [...perPhase.values()].reduce((t, e) => t + e.tests, 0);
const unattributedTests = unattributed.reduce((t, u) => t + u.tests, 0);
if (attributedSum + unattributedTests !== totalTests) {
  console.error(`ATTRIBUTION FAILED — accounting mismatch: attributed ${attributedSum} + unattributed ${unattributedTests} != measured ${totalTests}`);
  process.exit(1);
}

// ── 5. patch registry phases[].tests + record the attribution ─────────────
for (const phase of registry.phases) {
  const entry = perPhase.get(phase.id);
  phase.tests = entry && entry.tests > 0 ? entry.tests : null;
}

registry.testAttribution = {
  generated: new Date().toISOString().slice(0, 10),
  authority: "MISSION-R-04 (J-046 / COND-012) test-attribution regeneration",
  method:
    "per-file vitest counts (npx vitest run --reporter=json) attributed by kernel phase-contract citations (scripts/audit-phase-completion.mjs rule), then by the recorded subject-matter mapping in scripts/verification/registry-test-attribution.mjs; suites with no canonical owner are recorded unattributed below, never guessed",
  measured: {
    files: measured.size,
    tests: totalTests,
    skipped: totalSkipped,
    note: "tests/unit/* plus the env-gated live integration battery; skipped tests are excluded from attribution",
  },
  attributedSum,
  unattributed: {
    tests: unattributedTests,
    files: unattributed.map((u) => u.file),
    todo: "no canonical phase owner yet (mission machinery: CG-GAP-003; files substrate unregistered) — attribute when owners are ratified, never by invention",
  },
};

writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");

// ── 6. report ──────────────────────────────────────────────────────────────
console.log(`TEST ATTRIBUTION REGENERATED: measured ${totalTests} tests in ${measured.size} files (skipped ${totalSkipped})`);
console.log(`  attributed to phases: ${attributedSum}  unattributed (recorded, TODO): ${unattributedTests}`);
for (const [id, e] of [...perPhase.entries()].sort()) {
  console.log(`  phase ${id}: ${e.tests} tests across ${e.files.length} files`);
}
for (const u of unattributed) console.log(`  UNATTRIBUTED ${u.file}: ${u.tests} tests — ${u.reason}`);
