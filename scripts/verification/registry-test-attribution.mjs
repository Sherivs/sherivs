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
  // ── H2-28 (J-046 registry reconciliation, 2026-10-02): suites landed by the
  // hardening waves without attribution — mapped by the phase whose registry
  // modules own the tested module, or recorded unattributed when the mission
  // graph records no phase owner (COREGRID_V1_MISSION_GRAPH.json) ──
  "tests/unit/ai-gateway-model-registry.test.ts": { phase: "26", why: "AI gateway model registry (J-014/V1CAP-028/MISSION-R-31) — phase-26 AI intelligence layer gateway substrate, matching tests/unit/ai-gateway.test.ts" },
  "tests/unit/ai-gateway-output-trust.test.ts": { phase: "26", why: "AI output-trust pipeline (J-035/V1CAP-030/032, Constitution §21) — phase-26 AI intelligence layer gateway substrate, matching tests/unit/ai-gateway.test.ts" },
  "tests/unit/ai-gateway-reasoning-provenance.test.ts": { phase: "26", why: "reasoning-provenance intelligence-snapshot contract (J-015/V1CAP-029/MISSION-R-33) — phase-26 gateway substrate, matching tests/unit/adapter-reasoning-provenance.test.ts" },
  "tests/unit/ai-gateway-runtime-defenses.test.ts": { phase: "26", why: "AI runtime defenses (J-036/V1CAP-033/MISSION-R-84, Constitution §19/§20/§21) — phase-26 gateway substrate, matching tests/unit/ai-gateway.test.ts" },
  "tests/unit/command-centre.test.ts": { phase: "19", why: "command-centre operational projection (V1CAP-089/J-048/MISSION-R-110) over phase-19 registry modules command-alerts/command-incidents — recorded in the phase-19 row note (MISSION-R-110 wave 3)" },
  "tests/unit/cost-attribution.test.ts": { phase: "13", why: "metering cost-attribution engine (J-043/V1CAP-078/MISSION-R-70) — phase-13 financial metering substrate, matching tests/unit/metering-usage-ledger.test.ts and tests/unit/adapter-cost-attribution.test.ts" },
  "tests/unit/domain-runtime-recertification.test.ts": { phase: "33", why: "domain-runtime recertification (MISSION-R-120, V1CAP-092/093) over the kernel domain-config/runtime manifest machinery — phase-33 domain-runtime" },
  "tests/unit/evidence-capture.test.ts": { phase: "09", why: "Evidence-class capture discipline (J-034/V1CAP-059/MISSION-R-90) — phase-09 Security Trust Fabric, matching tests/unit/adapter-evidence-capture-store.test.ts" },
  "tests/unit/evidence-lifecycle.test.ts": { phase: "09", why: "Evidence lifecycle revocation/promotion contract (J-033/V1CAP-058/MISSION-R-91) — phase-09 Security Trust Fabric" },
  "tests/unit/financial-reconciliation.test.ts": { phase: "13", why: "payment-acceptance reconciliation dry run (J-044/MISSION-R-73) over financial-core/payments — phase-13 financial-payments, matching the payments-* suites" },
  "tests/unit/global-shell.test.ts": { phase: "06", why: "platform shell chrome/switcher/notifications contracts (MISSION-R-111/V1CAP-085) — the shell surface recorded in the phase-06 row (R-WAVES: resolution-based chrome + landings live in the shell; phase-06 workspace-composition)" },
  "tests/unit/kernel-bitemporal.test.ts": { phase: "33", why: "kernel bi-temporal discipline (V1CAP-004/J-003/MISSION-R-13) over kernel/reality — phase-33 registry module" },
  "tests/unit/kernel-event-routing.test.ts": { phase: "33", why: "kernel/event-routing subscriptions (V1CAP-043/J-021/MISSION-R-63) — phase-33 kernel substrate, matching tests/unit/adapter-event-routing-store.test.ts" },
  "tests/unit/kernel-event-security.test.ts": { phase: "33", why: "kernel/event-security consumption gate (V1CAP-044/J-022/MISSION-R-81) — phase-33 kernel substrate, matching tests/unit/adapter-event-security-store.test.ts" },
  "tests/unit/kernel-event-semantics.test.ts": { phase: "33", why: "kernel/event-semantics taxonomy/ordering (V1CAP-042/J-020/MISSION-R-15) — phase-33 kernel substrate" },
  "tests/unit/kernel-reconciliation.test.ts": { phase: "33", why: "kernel/reconciliation contradiction engine (V1CAP-005/J-004/MISSION-R-14) — phase-33 kernel substrate, matching tests/unit/adapter-reconciliation-store.test.ts" },
  "tests/unit/kernel-time-authority.test.ts": { phase: "33", why: "kernel/time-authority (V1CAP-045/J-023/MISSION-R-15) — phase-33 kernel substrate" },
  "tests/unit/knowledge-currency.test.ts": { phase: "36", why: "memory knowledge-currency (J-019/V1CAP-040/MISSION-R-71) — phase-36 Universal Memory & Knowledge Engine owner, matching tests/unit/adapter-knowledge-currency.test.ts" },
  "tests/unit/lifecycle-threading.test.ts": { phase: "08", why: "lifecycle-signal threading at the security-role-gate server-function call sites — phase-08 registry module security-role-gate" },
  "tests/unit/memory-store.test.ts": { phase: "36", why: "durable practical/organizational memory tier (J-016/J-017, V1CAP-034/035/036) — phase-36 Universal Memory & Knowledge Engine owner" },
  "tests/unit/memory-worker-scopes.test.ts": { phase: "36", why: "worker memory scopes & the memory governance boundary (J-007/V1CAP-016/MISSION-R-42) — phase-36 memory owner over the phase-25 workforce worker-definition substrate" },
  "tests/unit/onboarding-reality-discovery.test.ts": { phase: "25", why: "onboarding reality discovery (MISSION-R-43, V1CAP-090/091) — phase-25 onboarding substrate (onboarding-core / onboarding/onboarding-flow)" },
  "tests/unit/pg-ssl-tls-policy.test.ts": { phase: "33", why: "pg-ssl TLS policy for DB tooling (scripts/lib/pg-ssl.mjs, credential-era remediation) — phase-33 db-tooling discipline, matching tests/unit/db-tooling-coherence.test.ts" },
  "tests/unit/tool-runtime.test.ts": { phase: "25", why: "governed tool runtime & sandbox (J-008/V1CAP-056/MISSION-R-62) — phase-25 Institutional Onboarding & Workforce owner, matching tests/unit/adapter-tool-runtime.test.ts" },
  "tests/unit/trust-fabric.test.ts": { phase: "09", why: "trust-fabric wiring (J-008/V1CAP-022/MISSION-R-83, ADR-002 Option A) over trust-assertions (phase-09 registry module) seamed into security-core (phase-08 decision record)" },
  "tests/unit/worker-definition.test.ts": { phase: "25", why: "persistent governed worker definition substrate (J-027/V1CAP-048, CTO RULING-3) — phase-25 workforce substrate" },
  "tests/unit/workforce-capability-registry.test.ts": { phase: "25", why: "worker capability registry & delegation matching (J-028/V1CAP-049) — phase-25 workforce substrate" },
};

// Scholar runtime domain layer: every scholar-* suite tests the Scholar
// runtime content that phase 04's row registers as its domain layer
// ("legacy education modules remain the runtime's domain layer" — phase-04 note).
const PREFIX_MAP = [
  { prefix: "tests/unit/scholar-", phase: "04", why: "Scholar runtime domain layer — registry module runtime/scholar (phase-04)" },
  // H2-28 (J-046): the 30-mission H2 hardening wave lands ~25 gate/harness
  // suites under the tests/unit/mh-*.test.ts pattern. They verify the
  // foundation's verification machinery (gates, harnesses, watch programs), so
  // they attribute automatically to phase "01" foundation verification. When a
  // sibling mission's report ratifies a different owner for its suite, record
  // the explicit per-file SUBJECT_MAP entry above — it wins over this prefix.
  { prefix: "tests/unit/mh-", phase: "01", why: "H2 hardening wave gate/harness suites" },
  { prefix: "tests/failure/mh-", phase: "01", why: "H2 hardening wave gate/harness suites (failure battery)" },
  // ── H3-082 (H3 wave attribution completion, 2026-10-03): the 100-mission H3
  // wave lands suites under the tests/{unit,failure}/h3-0NN-*.test.ts pattern
  // (NN = mission id, H3-WAVE-CAMPAIGN.md). Each mission id is a stable prefix,
  // mapped to the phase whose registered modules own the tested substrate;
  // substrates no phase registers are recorded UNATTRIBUTED above, never
  // guessed. Squad G phase-contract suites attribute to their
  // architecture-defined phases 34-51 (Squad G mission graph). ──
  // Squad A/B — recovery groundwork, J-gap closures (context/security/memory/mission):
  { prefix: "tests/unit/h3-001", phase: "01", why: "H3-001 recovery drill runner — verifies the scripts/verify-recovery-drill.mjs offline rehearsal machinery, matching the phase-01 verification-contract suites (phase-completion-audit precedent)" },
  { prefix: "tests/unit/h3-010", phase: "08", why: "H3-010 identity lifecycle fail-closed proof over frontend/src/lib/authorization.ts — phase-08 security enforcement (the recorded only authorization authority), matching tests/unit/authorization-exhaustive.test.ts" },
  { prefix: "tests/unit/h3-012", phase: "26", why: "H3-012 context package completeness checker (frontend/src/lib/context/package-completeness.ts) — phase-26 ai-context substrate, matching tests/unit/context-package-completeness.test.ts" },
  { prefix: "tests/unit/h3-013", phase: "26", why: "H3-013 tenant/reality switch-safety runtime guard (frontend/src/lib/context/) — phase-26 ai-context substrate, matching tests/unit/context-package-completeness.test.ts" },
  { prefix: "tests/unit/h3-014", phase: "33", why: "H3-014 event kernel taxonomy/dedup/ordering/significance proof — phase-33 kernel substrate, matching tests/unit/kernel-event-semantics.test.ts" },
  { prefix: "tests/unit/h3-016", phase: "25", why: "H3-016 worker authority bounds/delegation depth over the workforce worker contracts — phase-25 workforce substrate, matching tests/unit/worker-definition.test.ts" },
  { prefix: "tests/unit/h3-017", phase: "25", why: "H3-017 delegation-contract matching (frontend/src/lib/agent-runtime/capability-matching.ts, J-028 stream) — phase-25 workforce substrate, matching tests/unit/workforce-capability-registry.test.ts" },
  { prefix: "tests/unit/h3-018", phase: "36", why: "H3-018 memory scope enforcement, no silent scope expansion — phase-36 memory governance, matching tests/unit/memory-worker-scopes.test.ts" },
  { prefix: "tests/unit/h3-020", phase: "08", why: "H3-020 approval-chain ESCALATE/REQUIRE_APPROVAL resolution flow (Constitution §16 authorization decision outcomes) — phase-08 security enforcement, the recorded only authorization authority" },
  { prefix: "tests/unit/h3-022", phase: "26", why: "H3-022 prompt-injection/malicious-artifact defense (J-036 stream) — phase-26 gateway substrate, matching tests/unit/ai-gateway-runtime-defenses.test.ts" },
  { prefix: "tests/unit/h3-025", phase: "26", why: "H3-025 egress allowlist enforcement at the AI gateway boundary (Constitution §20) — phase-26 AI gateway substrate, matching tests/unit/ai-gateway.test.ts" },
  { prefix: "tests/unit/h3-029", phase: "36", why: "H3-029 adversarial proof that memory retrieval is authorization-gated — phase-36 memory owner, matching tests/unit/memory-store.test.ts / memory-worker-scopes.test.ts" },
  // Squad C — threat mitigations:
  { prefix: "tests/failure/h3-030", phase: "26", why: "H3-030 adversarial context-bleed battery on the switch-safety runtime guard (frontend/src/lib/context/) — phase-26 ai-context substrate" },
  // Squad D — zero-policy RLS posture adjudication (30 cg_* tables):
  { prefix: "tests/unit/h3-03", phase: "33", why: "H3-031..039 zero-policy RLS posture adjudication suites — deny-by-default cg_* posture discipline rooted in the phase-33 kernel substrate (rls-isolation-check.sql), matching tests/unit/db-tooling-coherence.test.ts / pg-ssl-tls-policy.test.ts" },
  { prefix: "tests/unit/h3-040", phase: "33", why: "H3-040 zero-policy RLS posture adjudication (D-040 tables) — same phase-33 rls-isolation posture discipline as the h3-03 prefix" },
  // Squad E — launch-gate drills (offline gate suites for credential-gated drill scripts):
  { prefix: "tests/unit/h3-041", phase: "01", why: "H3-041 AI gateway live drill (scripts/verify-ai-gateway-live.drill.mjs) offline gate suite — phase-01 verification-contract machinery, matching the phase-completion-audit precedent" },
  { prefix: "tests/unit/h3-042", phase: "05", why: "H3-042 deployment serving-URL monitoring gate (frontend/src/lib/observability/) — phase-05 runtime-observability substrate, matching tests/unit/observability-health.test.ts" },
  { prefix: "tests/unit/h3-043", phase: "01", why: "H3-043 payments live drill (scripts/verify-payments-live.drill.mjs) offline gate suite — phase-01 verification-contract machinery (credential-gated drill harness, not the payments adapter)" },
  { prefix: "tests/unit/h3-044", phase: "01", why: "H3-044 communication provider probe drill (scripts/verify-communication-live.drill.mjs) offline gate suite — phase-01 verification-contract machinery" },
  // Squad F — observability & operations:
  { prefix: "tests/unit/h3-046", phase: "05", why: "H3-046 typed metrics registry (frontend/src/lib/observability/) — phase-05 runtime-observability substrate" },
  { prefix: "tests/unit/h3-047", phase: "05", why: "H3-047 trace context propagation (frontend/src/lib/observability/) — phase-05 runtime-observability substrate" },
  { prefix: "tests/unit/h3-049", phase: "05", why: "H3-049 dependency health map (frontend/src/lib/observability/) — phase-05 runtime-observability substrate, matching tests/unit/observability-health.test.ts" },
  { prefix: "tests/unit/h3-052", phase: "05", why: "H3-052 log redaction sweep (Constitution §29/§30 — no secrets in logs) — phase-05 runtime-observability/structured-log discipline, matching tests/unit/observability-structured-log.test.ts" },
  { prefix: "tests/unit/h3-053", phase: "01", why: "H3-053 substrate-telemetry adoption deepening of the mh-27 suite — phase-01 hardening-wave gate/harness lineage (mh- prefix)" },
  // Squad G — architecture-defined phase activations (contract architects + verifiers):
  { prefix: "tests/unit/h3-054", phase: "34", why: "H3-054 phase-34 cognitive-architecture contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-055", phase: "35", why: "H3-055 phase-35 multi-agent-society contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-056", phase: "36", why: "H3-056 phase-36 memory-knowledge contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-057", phase: "37", why: "H3-057 phase-37 simulation-engine contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-058", phase: "38", why: "H3-058 phase-38 evolution-engine contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-059", phase: "39", why: "H3-059 phase-39 governance-alignment contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-060", phase: "40", why: "H3-060 phase-40 universal-runtime-fabric contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-061", phase: "41", why: "H3-061 phase-41 sandbox-runtime contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-062", phase: "42", why: "H3-062 phase-42 zero-trust-defense contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-063", phase: "43", why: "H3-063 phase-43 universal-interface contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-064", phase: "44", why: "H3-064 phase-44 planetary-infrastructure contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-065", phase: "45", why: "H3-065 phase-45 ai-compute contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-066", phase: "46", why: "H3-066 phase-46 twin-civilization contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-067", phase: "47", why: "H3-067 phase-47 self-improvement contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-068", phase: "48", why: "H3-068 phase-48 knowledge-graph contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-069", phase: "49", why: "H3-069 phase-49 autonomous-economy contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-070", phase: "50", why: "H3-070 phase-50 human-interface contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-071", phase: "51", why: "H3-071 phase-51 reality-os-kernel contract suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-072", phase: "34", why: "H3-072 phase-34 cognitive-architecture adversarial verification suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-073", phase: "35", why: "H3-073 phase-35 multi-agent-society adversarial verification suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-074", phase: "36", why: "H3-074 phase-36 memory-knowledge adversarial verification suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-075", phase: "37", why: "H3-075 phase-37 simulation-engine adversarial verification suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-076", phase: "39", why: "H3-076 phase-39 governance-alignment adversarial verification suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-077", phase: "40", why: "H3-077 phase-40 universal-runtime-fabric adversarial verification suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-078", phase: "42", why: "H3-078 phase-42 zero-trust-defense adversarial verification suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-079", phase: "44", why: "H3-079 phase-44 planetary-infrastructure adversarial verification suite (H3 wave Squad G)" },
  { prefix: "tests/unit/h3-080", phase: "46", why: "H3-080 phase-46 twin-civilization adversarial verification suite (H3 wave Squad G)" },
  // Squad H — quality & CI hardening:
  { prefix: "tests/unit/h3-085", phase: "01", why: "H3-085 secrets-hygiene static scan (scripts/verify-secrets-hygiene.mjs, Constitution §30) — phase-01 verification-contract machinery" },
  { prefix: "tests/unit/h3-087", phase: "08", why: "H3-087 §27 per-function invariant expansion over the wave's server-side contract modules — phase-08 security enforcement, matching the scholar-invariant-* suites" },
  { prefix: "tests/unit/h3-088", phase: "33", why: "H3-088 RLS battery posture-parse validation — phase-33 rls-isolation posture discipline, matching the h3-03 posture prefix" },
  // Squad I — payments & economics:
  { prefix: "tests/unit/h3-091", phase: "13", why: "H3-091 legacy subscription-tier entitlement mapping — phase-13 financial-payments, matching tests/unit/subscription-tiers.test.ts" },
  { prefix: "tests/unit/h3-092", phase: "13", why: "H3-092 Paystack adapter failure semantics — phase-13 financial-payments adapter discipline, matching tests/unit/payments-paystack-adapter.test.ts" },
  { prefix: "tests/unit/h3-093", phase: "13", why: "H3-093 metering roll-up conservation (J-043 stream) — phase-13 financial metering substrate, matching tests/unit/metering-usage-ledger.test.ts" },
  // Squad J — governance & documentation:
  { prefix: "tests/unit/h3-095", phase: "01", why: "H3-095 provenance-metadata verification (scripts/verify-provenance-metadata.mjs, Constitution §12) — phase-01 verification-contract machinery" },
  { prefix: "tests/unit/h3-096", phase: "16", why: "H3-096 twin governance boundary proof (a Digital Twin is not a permission bypass, Constitution §10) — phase-16 Digital Twin registered modules twin-*" },
  { prefix: "tests/unit/h3-097", phase: "48", why: "H3-097 knowledge-graph relationship provenance/ownership/authorization/confidence proof — phase-48 Civilization Knowledge Graph, matching the H3-068 phase-48 contract suite" },
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
  // ── H2-28 (J-046 registry reconciliation, 2026-10-02): hardening-wave suites
  // whose owning missions record phase: null in
  // architecture/coregrid-mvp-architecture/reconstruction/COREGRID_V1_MISSION_GRAPH.json
  // and whose substrate modules no phase registers — unowned, never guessed ──
  "tests/unit/adapter-failure-policy.test.ts": "adapter failure-semantics policy engine (J-045/V1CAP-080/MISSION-R-72, frontend/src/lib/adapters/) — lib/adapters/ is not a registered phase module and the mission graph records no phase owner. TODO: attribute when the owner is ratified.",
  "tests/unit/command-idempotency.test.ts": "platform-wide command idempotency (J-030/V1CAP-054, MISSION-R-60 phase: null; frontend/src/lib/command/) — command-infrastructure substrate is not a registered phase module. TODO: attribute when the owner is ratified.",
  "tests/unit/command-leases.test.ts": "lease/concurrency control (J-031/V1CAP-055, MISSION-R-60 phase: null; frontend/src/lib/command/) — same unregistered-substrate basis. TODO: attribute when the owner is ratified.",
  "tests/unit/credential-broker.test.ts": "per-agent credential broker & emergency lockdown (J-007/J-010, V1CAP-017/019, MISSION-R-82 phase: null; frontend/src/lib/security/credential-broker) — no registered phase module owns agent credential machinery. TODO: attribute when the owner is ratified.",
  "tests/unit/failure-architecture.test.ts": "failure & incident architecture (V1CAP-075, MISSION-R-102 phase: null; frontend/src/lib/reliability/) — reliability substrate is not a registered phase module. TODO: attribute when the owner is ratified.",
  "tests/unit/slo.test.ts": "SLO/SLI contract set (V1CAP-077, MISSION-R-102 phase: null; frontend/src/lib/reliability/) — same unregistered-substrate basis. TODO: attribute when the owner is ratified.",
  "tests/unit/mission-contract.test.ts": "Mission object contract (J-025/V1CAP-046, MISSION-R-50) — mission machinery has no canonical phase owner (CG-GAP-003). TODO: attribute when the owner is ratified.",
  "tests/unit/delegation-contract.test.ts": "Delegation object contract (J-025/V1CAP-046, MISSION-R-50) — same unowned-mission basis (CG-GAP-003). TODO: attribute when the owner is ratified.",
  "tests/unit/delegation-enforcement.test.ts": "delegation expiry enforcement in the mission runner (MISSION-R-52/V1CAP-021 mission wiring) — same unowned-mission basis (CG-GAP-003); consumes phase-07 agent-plans/agent-tasks machinery without owning it. TODO: attribute when the owner is ratified.",
  "tests/unit/verification-independence.test.ts": "verification independence over the foundation loop (control-plane/foundation-loop) — same unowned-mission basis (CG-GAP-003), matching tests/unit/foundation-loop.test.ts. TODO: attribute when the owner is ratified.",
  // ── H3-082 (H3 wave attribution completion, 2026-10-03): h3-0NN suites whose
  // tested substrate no phase registers — recorded unattributed with a TODO,
  // never guessed, each matching the precedent already recorded above ──
  "tests/unit/h3-002-recovery-targets.test.ts": "recovery RTO/RPO target contracts (frontend/src/lib/reliability/recovery-targets.ts) — reliability substrate is not a registered phase module, matching tests/unit/failure-architecture.test.ts. TODO: attribute when the owner is ratified.",
  "tests/unit/h3-003-backup-manifest.test.ts": "backup manifest schema (frontend/src/lib/reliability/backup-manifest.ts) — reliability substrate is not a registered phase module, matching tests/unit/failure-architecture.test.ts. TODO: attribute when the owner is ratified.",
  "tests/failure/h3-007-recovery-chaos.test.ts": "recovery tooling failure paths (frontend/src/lib/reliability/) — reliability substrate is not a registered phase module, matching tests/unit/failure-architecture.test.ts. TODO: attribute when the owner is ratified.",
  "tests/unit/h3-009-credential-broker-depth.test.ts": "per-agent credential-broker scoping depth (frontend/src/lib/security/credential-broker.ts) — no registered phase module owns agent credential machinery, matching tests/unit/credential-broker.test.ts. TODO: attribute when the owner is ratified.",
  "tests/unit/h3-011-lockdown.test.ts": "emergency revocation/kill-switch path (frontend/src/lib/security/lockdown.ts, J-011) — lib/security agent-safety machinery has no registered phase-module owner, matching tests/unit/credential-broker.test.ts. TODO: attribute when the owner is ratified.",
  "tests/unit/h3-015-mission-gates.test.ts": "mission gate contracts (frontend/src/lib/mission/gates.ts) — mission machinery has no canonical phase owner (CG-GAP-003), matching tests/unit/mission-contract.test.ts. TODO: attribute when the owner is ratified.",
  "tests/unit/h3-019-quotas.test.ts": "resource-quota contracts (frontend/src/lib/reliability/quotas.ts) — reliability substrate is not a registered phase module, matching tests/unit/failure-architecture.test.ts. TODO: attribute when the owner is ratified.",
  "tests/unit/h3-021-independence.test.ts": "worker independence enforcement (frontend/src/lib/assurance/independence-enforcement.ts) — verification-independence machinery has no canonical phase owner (CG-GAP-003), matching tests/unit/verification-independence.test.ts. TODO: attribute when the owner is ratified.",
  "tests/unit/h3-023-failure-semantics.test.ts": "adapter failure semantics (frontend/src/lib/adapters/failure-semantics.ts) — lib/adapters/ is not a registered phase module, matching tests/unit/adapter-failure-policy.test.ts. TODO: attribute when the owner is ratified.",
  "tests/unit/h3-027-file-substrate.test.ts": "file substrate migration posture (cg_file_object, AUTHORED NOT APPLIED) — files substrate is not a registered phase module, matching tests/unit/files-contract.test.ts. TODO: attribute when a phase registers the files/storage substrate.",
  "tests/unit/h3-028-idempotency-store.test.ts": "DB-backed command idempotency store (frontend/src/lib/command/idempotency-store.db.ts) — command-infrastructure substrate is not a registered phase module, matching tests/unit/command-idempotency.test.ts. TODO: attribute when the owner is ratified.",
  "tests/unit/h3-048-audit-surface.test.ts": "tenant-scoped server-only audit read surface (frontend/src/lib/audit/query-surface.contract.ts) — no registered phase module owns the audit read substrate (phase-09 modules are trust-*; phase-05 modules are runtime-*). TODO: attribute when the owner is ratified.",
  "tests/failure/h3-089-failure-expansion.test.ts": "quota/lease/approval-chain failure paths — reliability/command substrates are not registered phase modules (the approval-chain unit contract attributes to phase 08; this cross-substrate failure battery records unattributed), matching tests/unit/command-leases.test.ts. TODO: attribute when the owners are ratified.",
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
