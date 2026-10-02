#!/usr/bin/env node
/**
 * COREGRID V1 LAUNCH CRITERIA HARNESS — MISSION H2-15 (roadmap Stage 4, Part 74).
 *
 * Machine-checkable harness for the 18 V1 launch criteria recorded in
 * architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_LAUNCH_CRITERIA.json
 * (V5.3 Part 74 acceptance standard + Part 53 launch definition).
 *
 * Semantics (defined honestly, never faked):
 *
 *   proven    — every concrete repo check mapped to this criterion re-evaluated
 *               PASS in THIS run, and the recorded evidence source stands. The
 *               deployed-environment dimension of the Part 53 launch definition
 *               is tracked separately (residual gates), never folded into a
 *               proven verdict.
 *   blocked   — the criterion cannot be closed by an offline harness run
 *               because its completion is owned by a RECORDED external gate
 *               (a credential blocker such as BLK-2..5 / OPS-1, or a recorded
 *               governance decision). The owning gate is named and must RESOLVE to a
 *               recorded entry — the harness refuses to invent gates. A
 *               criterion may only report blocked when its in-repo substrate
 *               checks pass; a failed substrate with a claimed gate is
 *               unproven, not blocked.
 *   unproven  — neither: the in-repo evidence is missing/failed and no
 *               recorded gate owns the gap. This is the FAILURE state.
 *
 * blocked is NOT failed: the summary prints both counts. Exit code:
 *
 *   0 — no criterion is unproven (every criterion is proven or blocked)
 *   1 — at least one criterion is unproven (or a repo gate claimed by a
 *       criterion fails)
 *   2 — the harness itself is inconsistent with the canonical criteria record
 *       (id set or statement drift) — fix the harness, never the record
 *
 * Deterministic and offline: no network, no database, no wall-clock inputs to
 * verdicts. The only spawned processes are the repo's own offline gates plus
 * `tsc --noEmit`. The live RLS isolation battery is NEVER re-executed here;
 * only its RECORDED result (ratification record + result artifact when
 * present on this machine) is consumed.
 *
 * Usage: node scripts/verify-launch-criteria.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ─────────────────────────────────────────────────────────────
 * Canonical record locations (single sources of truth)
 * ────────────────────────────────────────────────────────────*/

const LAUNCH_CRITERIA_JSON =
  "architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_LAUNCH_CRITERIA.json";
const BLOCKERS_JSON = "architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_BLOCKERS.json";
const MASTER_PLAN_JSON =
  "architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_MASTER_IMPLEMENTATION_PLAN.json";
const REGISTRY_JSON = "architecture/registry.json";
const BATTERY_MD = "architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md";
const BATTERY_ARTIFACT_DEFAULT = "/opt/cursor/artifacts/rls-battery-results.json";

/* ─────────────────────────────────────────────────────────────
 * Pure fs helpers (root-injectable so the parser is unit-testable)
 * ────────────────────────────────────────────────────────────*/

const normalise = (text) => text.replace(/\r\n/g, "\n");

export function readText(root, ref) {
  return normalise(readFileSync(join(root, ...ref.split("/")), "utf8"));
}

export function exists(root, ref) {
  return existsSync(join(root, ...ref.split("/")));
}

export function readJson(root, ref) {
  return JSON.parse(readText(root, ref));
}

/* ─────────────────────────────────────────────────────────────
 * The 18 criteria as DATA
 *
 * Each entry: id + statement must match the canonical record byte-for-byte
 * (validated live below — drift is exit 2). `verdictMode` selects the
 * accounting; `checks` are the concrete repo checks re-evaluated live;
 * `gate` names the recorded external owner for live-gated criteria;
 * `evidence` cites the recorded sources; `residualGates` name the recorded
 * gates that still own the deployed-environment/live dimension AFTER the
 * in-repo proof — printed, never folded into the verdict.
 * ────────────────────────────────────────────────────────────*/

export const CRITERIA = [
  {
    id: "PLATFORM",
    statement: "Can an organization be created?",
    verdictMode: "gated",
    baseline: "PARTIAL — cg_org_profile exists; universal creation flow not wired end-to-end",
    evidence: [
      "frontend/src/lib/org-model.ts (MISSION-V1-006 universal org model, fails closed)",
      "database/supabase/migrations/20261001000000_coregrid_v1_org_model.sql",
      "COREGRID_V1_BLOCKERS.json OPS-2 (org unit/membership applied to dev, rowsecurity verified)",
      "frontend/src/lib/onboarding/onboarding-flow.ts createOrganizationOnboarding",
    ],
    checks: [
      {
        id: "org-model-contract",
        desc: "universal org model contract exists and fails closed",
        ref: "frontend/src/lib/org-model.ts",
        mustMatch: [/universal organization model/, /OrgUnit/, /FAILS CLOSED/],
      },
      {
        id: "org-model-migration",
        desc: "org model migration recorded",
        ref: "database/supabase/migrations/20261001000000_coregrid_v1_org_model.sql",
      },
      {
        id: "org-creation-flow",
        desc: "organization creation flow wired (onboarding)",
        ref: "frontend/src/lib/onboarding/onboarding-flow.ts",
        mustMatch: [/createOrganizationOnboarding/],
      },
      {
        id: "org-model-tests",
        desc: "org model + onboarding flow suites recorded",
        refs: ["tests/unit/org-model.test.ts", "tests/unit/onboarding-flow.test.ts"],
      },
    ],
    gate: {
      id: "BLK-3",
      reason:
        "Part 53 launch definition requires the org lifecycle demonstrated end to end on a DEPLOYED environment; deploy validation is owned by recorded blocker BLK-3 (deployment target credentials).",
    },
  },
  {
    id: "IDENTITY",
    statement: "Can users and roles be securely managed?",
    verdictMode: "mechanical",
    baseline: "VERIFIED — Supabase auth + cg_identity + role substrate + RLS live-tested",
    evidence: [
      "frontend/src/lib/universal-roles.ts (closed universal role vocabulary, RULING-4)",
      "scripts/verify-neutral-tenant-primitives.mjs + 20261002000001_coregrid_v1_neutral_tenant_primitives.sql",
      "tests/unit/role-substrate-proof.test.ts",
      "RLS_ISOLATION_BATTERY.md recorded live run (36/36 PASS, findings 0)",
    ],
    checks: [
      {
        id: "universal-role-vocabulary",
        desc: "closed universal role vocabulary declared",
        ref: "frontend/src/lib/universal-roles.ts",
        mustMatch: [/UNIVERSAL_ROLES/, /isUniversalRole/],
      },
      {
        id: "neutral-tenant-primitives",
        desc: "neutral tenant-membership primitives recorded (MISSION-R-20)",
        refs: [
          "scripts/verify-neutral-tenant-primitives.mjs",
          "database/supabase/migrations/20261002000001_coregrid_v1_neutral_tenant_primitives.sql",
        ],
      },
      {
        id: "role-substrate-suite",
        desc: "role substrate proof suite recorded",
        ref: "tests/unit/role-substrate-proof.test.ts",
      },
      { id: "rls-battery-recorded", desc: "RLS isolation battery recorded PASS", kind: "battery-recorded" },
    ],
  },
  {
    id: "ORGANIZATION",
    statement: "Can organizational structures be represented?",
    verdictMode: "mechanical",
    baseline: "PARTIAL — Scholar-flavored; universal org unit/membership model pending",
    evidence: [
      "frontend/src/lib/org-model.ts (universal, domain-neutral org unit/membership model)",
      "database/supabase/migrations/20261002000013_coregrid_v1_neutral_membership_policies.sql",
      "COREGRID_V1_BLOCKERS.json OPS-2 (cg_org_unit/cg_org_membership verified rowsecurity=true)",
      "tests/unit/domain-runtime-recertification.test.ts (domain runtime recertified WITHOUT contaminating the substrate)",
    ],
    checks: [
      {
        id: "universal-org-structure",
        desc: "universal org unit/membership structure declared (no domain vocabulary)",
        ref: "frontend/src/lib/org-model.ts",
        mustMatch: [/OrgUnitRef/, /OrgMembershipRef/, /principalRef/],
      },
      {
        id: "neutral-membership-policies",
        desc: "neutral membership RLS policies recorded",
        ref: "database/supabase/migrations/20261002000013_coregrid_v1_neutral_membership_policies.sql",
      },
      {
        id: "ops2-org-verified",
        desc: "blockers register records org tables applied + rowsecurity verified",
        kind: "json",
        ref: BLOCKERS_JSON,
        assert(json) {
          const entry = (json.blockers ?? []).find((b) => b.id === "OPS-2");
          const applied =
            Boolean(entry) &&
            entry.item.includes("cg_org_unit") &&
            entry.item.includes("cg_org_membership") &&
            entry.item.includes("rowsecurity=true");
          return {
            ok: applied,
            detail: applied
              ? "OPS-2 records cg_org_unit/cg_org_membership applied with rowsecurity=true"
              : "OPS-2 does not record the org tables as applied + verified",
          };
        },
      },
      {
        id: "runtime-recertification",
        desc: "domain runtime recertification suite recorded",
        ref: "tests/unit/domain-runtime-recertification.test.ts",
      },
    ],
  },
  {
    id: "ENTITY",
    statement: "Can domain entities be configured?",
    verdictMode: "mechanical",
    baseline: "VERIFIED — universal kernel substrate, live-tested",
    evidence: [
      "database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql (cg_entity/cg_relationship/cg_event/cg_observation)",
      "database/supabase/migrations/20261002000000_coregrid_v1_kernel_envelope.sql",
      "tests/unit/kernel-envelope.test.ts + kernel-event-semantics.test.ts",
      "RLS_ISOLATION_BATTERY.md recorded live run over the kernel substrate",
    ],
    checks: [
      {
        id: "kernel-substrate-migration",
        desc: "universal kernel substrate migration recorded",
        ref: "database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql",
      },
      {
        id: "kernel-envelope-migration",
        desc: "kernel envelope migration recorded",
        ref: "database/supabase/migrations/20261002000000_coregrid_v1_kernel_envelope.sql",
      },
      {
        id: "kernel-suites",
        desc: "kernel envelope + event semantics suites recorded",
        refs: ["tests/unit/kernel-envelope.test.ts", "tests/unit/kernel-event-semantics.test.ts"],
      },
      { id: "rls-battery-recorded", desc: "RLS isolation battery recorded PASS", kind: "battery-recorded" },
    ],
  },
  {
    id: "WORKSPACE",
    statement: "Can different actors receive appropriate experiences?",
    verdictMode: "mechanical",
    baseline: "PARTIAL — Scholar projections live; durable workspace persistence missing",
    evidence: [
      "database/supabase/migrations/20260930000000_coregrid_v1_workspace_persistence.sql (MISSION-V1-007)",
      "frontend/src/lib/workspace-core.ts + frontend/src/lib/workspace-engine/",
      "COREGRID_V1_BLOCKERS.json OPS-2 (cg_workspace/cg_workspace_member verified rowsecurity=true)",
      "tests/unit/workspace.test.ts",
    ],
    checks: [
      {
        id: "workspace-persistence-migration",
        desc: "durable workspace persistence migration recorded",
        ref: "database/supabase/migrations/20260930000000_coregrid_v1_workspace_persistence.sql",
      },
      {
        id: "workspace-substrate",
        desc: "workspace engine substrate recorded",
        refs: ["frontend/src/lib/workspace-core.ts", "frontend/src/lib/workspace-engine/views.ts"],
      },
      {
        id: "ops2-workspace-verified",
        desc: "blockers register records workspace tables applied + rowsecurity verified",
        kind: "json",
        ref: BLOCKERS_JSON,
        assert(json) {
          const entry = (json.blockers ?? []).find((b) => b.id === "OPS-2");
          const applied =
            Boolean(entry) &&
            entry.item.includes("cg_workspace") &&
            entry.item.includes("rowsecurity=true");
          return {
            ok: applied,
            detail: applied
              ? "OPS-2 records cg_workspace/cg_workspace_member applied with rowsecurity=true"
              : "OPS-2 does not record the workspace tables as applied + verified",
          };
        },
      },
      { id: "workspace-suite", desc: "workspace suite recorded", ref: "tests/unit/workspace.test.ts" },
    ],
  },
  {
    id: "APPLICATION",
    statement: "Can useful internal applications be created?",
    verdictMode: "gated",
    baseline: "NO — application builder not started (V1-minimal required)",
    evidence: [
      "frontend/src/lib/kernel/phase-contracts/phase-05-application-runtime.ts (Core Application Runtime, status: implemented)",
      "frontend/src/lib/runtime-core.ts (implements architecture/phase-05-core-application-runtime.md)",
      "tests/unit/runtime.test.ts",
      "COREGRID_V1_MASTER_IMPLEMENTATION_PLAN.json part63OrderCorrections.deferOrMinimize (application builder — V1-minimal or post-launch per V5.3 Part 5 golden rule)",
    ],
    checks: [
      {
        id: "application-runtime-contract",
        desc: "phase-05 core application runtime contract recorded as implemented",
        ref: "frontend/src/lib/kernel/phase-contracts/phase-05-application-runtime.ts",
        mustMatch: [/Core Application Runtime/, /status: "implemented"/],
      },
      {
        id: "runtime-core",
        desc: "application runtime substrate recorded",
        ref: "frontend/src/lib/runtime-core.ts",
        mustMatch: [/phase-05-core-application-runtime\.md/],
      },
      { id: "runtime-suite", desc: "runtime suite recorded", ref: "tests/unit/runtime.test.ts" },
    ],
    gate: {
      id: "GOV-P63-DEFER-MINIMIZE",
      reason:
        "The application-builder authoring scope is deferred/minimized by the recorded CTO sequencing decision (V5.3 Part 63 deferOrMinimize + Part 5 golden rule). The runtime substrate applications run on is proven; the authoring capability itself is NOT built and is NOT claimed.",
    },
  },
  {
    id: "WORKFLOW",
    statement: "Can work be automated?",
    verdictMode: "mechanical",
    baseline: "PARTIAL — workflow contracts rich; durable execution not persisted",
    evidence: [
      "frontend/src/lib/automation-workflow.ts + frontend/src/lib/workflow/workflow-engine.ts + workflow-contract.ts",
      "tests/unit/automation-core.test.ts + automation-actions.test.ts + automation-governance.test.ts",
      "COREGRID_V1_MASTER_IMPLEMENTATION_PLAN.json part63OrderCorrections (durable mission loop is live-tested; workflow engine is the declared in-memory contract layer)",
    ],
    checks: [
      {
        id: "workflow-substrate",
        desc: "workflow engine + contracts recorded",
        refs: [
          "frontend/src/lib/automation-workflow.ts",
          "frontend/src/lib/workflow/workflow-engine.ts",
          "frontend/src/lib/workflow/workflow-contract.ts",
        ],
      },
      {
        id: "workflow-suites",
        desc: "automation suites recorded",
        refs: [
          "tests/unit/automation-core.test.ts",
          "tests/unit/automation-actions.test.ts",
          "tests/unit/automation-governance.test.ts",
        ],
      },
    ],
  },
  {
    id: "AI",
    statement: "Can AI workers perform useful authorized missions?",
    verdictMode: "gated",
    baseline: "PARTIAL — gateway exists; worker delegation missing; blocked on provider key",
    evidence: [
      "frontend/src/lib/ai-gateway/ (model registry, output-trust pipeline, reasoning provenance, runtime defenses)",
      "tests/unit/ai-gateway.test.ts + ai-gateway-model-registry.test.ts + ai-gateway-output-trust.test.ts",
      "COREGRID_V1_BLOCKERS.json BLK-2 (AI provider key; fail-closed proofs + dry-run harness recorded)",
    ],
    checks: [
      {
        id: "gateway-substrate",
        desc: "AI gateway substrate recorded",
        refs: [
          "frontend/src/lib/ai-gateway/model-registry.ts",
          "frontend/src/lib/ai-gateway/output-trust-pipeline.ts",
          "frontend/src/lib/ai-gateway/reasoning-provenance.ts",
        ],
      },
      {
        id: "gateway-suites",
        desc: "gateway suites recorded",
        refs: ["tests/unit/ai-gateway.test.ts", "tests/unit/ai-gateway-model-registry.test.ts"],
      },
      {
        id: "blk2-recorded-open",
        desc: "BLK-2 recorded and open (never bypassed)",
        kind: "json",
        ref: BLOCKERS_JSON,
        assert(json) {
          const entry = (json.blockers ?? []).find((b) => b.id === "BLK-2");
          return {
            ok: Boolean(entry) && !entry.item.startsWith("RESOLVED"),
            detail: entry ? "BLK-2 recorded open: " + entry.item.slice(0, 120) : "BLK-2 missing from register",
          };
        },
      },
    ],
    gate: {
      id: "BLK-2",
      reason:
        "Live governed inference requires the AI provider key + gateway decision (recorded blocker BLK-2). Fail-closed proofs and the dry-run harness are the recorded fallback; live calls are never faked.",
    },
  },
  {
    id: "EXECUTION",
    statement: "Can agents actually perform actions?",
    verdictMode: "mechanical",
    baseline: "VERIFIED for governed loop actions; AI-proposed action path pending",
    evidence: [
      "scripts/exercise-foundation-loop.mjs (governed loop exercise harness)",
      "database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql (cg_mission_intent/cg_execution_record/cg_verification_result)",
      "tests/unit/foundation.test.ts",
      "COREGRID_V1_BUILD_ROADMAP.md (foundation mission loop — the ONLY live-verified governed tail, 5/5 on dev, idempotent replay, rollback)",
    ],
    checks: [
      {
        id: "loop-exercise-harness",
        desc: "foundation loop exercise harness recorded",
        ref: "scripts/exercise-foundation-loop.mjs",
      },
      {
        id: "execution-record-substrate",
        desc: "mission/execution record substrate recorded",
        ref: "database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql",
        mustMatch: [/cg_execution_record/, /cg_verification_result/],
      },
      { id: "foundation-suite", desc: "foundation suite recorded", ref: "tests/unit/foundation.test.ts" },
    ],
    residualGates: [
      "BLK-2 — AI-proposed action path pending (live inference); governed loop actions remain the proven scope",
    ],
  },
  {
    id: "EVIDENCE",
    statement: "Can CoreGrid show what happened?",
    verdictMode: "mechanical",
    baseline: "VERIFIED — foundation evidence + append-only history, live-tested",
    evidence: [
      "database/supabase/migrations/20261002000008_coregrid_v1_evidence_lifecycle.sql",
      "frontend/src/lib/adapters/evidence-capture-store.adapter.ts",
      "tests/unit/evidence-lifecycle.test.ts + evidence-capture.test.ts",
    ],
    checks: [
      {
        id: "evidence-lifecycle-migration",
        desc: "evidence lifecycle migration recorded",
        ref: "database/supabase/migrations/20261002000008_coregrid_v1_evidence_lifecycle.sql",
      },
      {
        id: "evidence-substrate",
        desc: "evidence capture substrate recorded",
        ref: "frontend/src/lib/adapters/evidence-capture-store.adapter.ts",
      },
      {
        id: "evidence-suites",
        desc: "evidence suites recorded",
        refs: ["tests/unit/evidence-lifecycle.test.ts", "tests/unit/evidence-capture.test.ts"],
      },
    ],
  },
  {
    id: "VERIFICATION",
    statement: "Can CoreGrid determine whether results satisfy criteria?",
    verdictMode: "mechanical",
    baseline: "VERIFIED — cg_verification_result, live-tested",
    evidence: [
      "frontend/src/lib/verification.ts",
      "database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql (cg_verification_result)",
      "tests/unit/verification-independence.test.ts",
    ],
    checks: [
      { id: "verification-substrate", desc: "verification substrate recorded", ref: "frontend/src/lib/verification.ts" },
      {
        id: "verification-result-substrate",
        desc: "cg_verification_result recorded in the mission substrate",
        ref: "database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql",
        mustMatch: [/cg_verification_result/],
      },
      {
        id: "verification-suite",
        desc: "verification independence suite recorded",
        ref: "tests/unit/verification-independence.test.ts",
      },
    ],
  },
  {
    id: "MULTI-TENANCY",
    statement: "Are organizations isolated?",
    verdictMode: "mechanical",
    baseline: "VERIFIED — RLS deny-by-default, cross-tenant rejection live-proven",
    evidence: [
      "RLS_ISOLATION_BATTERY.md recorded live run: 36/36 invariants PASS, findings 0 (cross-tenant probes)",
      "database/supabase/migrations/20261002000013_coregrid_v1_neutral_membership_policies.sql",
      "frontend/src/lib/tenancy/tenant-resolution.ts",
      "scripts/run-rls-isolation-check.mjs",
    ],
    checks: [
      { id: "rls-battery-recorded", desc: "RLS isolation battery recorded PASS", kind: "battery-recorded" },
      {
        id: "tenant-resolution",
        desc: "server-side tenant resolution recorded",
        ref: "frontend/src/lib/tenancy/tenant-resolution.ts",
      },
      {
        id: "isolation-check-tooling",
        desc: "RLS isolation check tooling recorded",
        ref: "scripts/run-rls-isolation-check.mjs",
      },
    ],
  },
  {
    id: "SECURITY",
    statement: "Are permissions enforced?",
    verdictMode: "mechanical",
    baseline: "VERIFIED core (server-side tenant resolution, RLS); ops debt recorded (OPS-RISK-1/2)",
    evidence: [
      "tests/unit/security-core.test.ts + security-events.test.ts + authorization-exhaustive.test.ts",
      "frontend/src/lib/security/credential-broker.ts",
      "scripts/verify-retention-schedule.mjs (ADR-005 V1-minimal data lifecycle gate)",
    ],
    checks: [
      {
        id: "security-suites",
        desc: "security + exhaustive authorization suites recorded",
        refs: [
          "tests/unit/security-core.test.ts",
          "tests/unit/security-events.test.ts",
          "tests/unit/authorization-exhaustive.test.ts",
        ],
      },
      {
        id: "credential-broker",
        desc: "credential broker recorded",
        ref: "frontend/src/lib/security/credential-broker.ts",
      },
      { id: "repo-gate:retention", desc: "retention policy gate PASS (ADR-005)", kind: "repo-gate", gate: "retention" },
    ],
    residualGates: [
      "OPS-1 — end-to-end secure-TLS database proof pending (DATABASE_URL + CA)",
      "OPS-RISK-1/2 — recorded ops debt in the blockers register",
    ],
  },
  {
    id: "COMMUNICATION",
    statement: "Can organizations communicate with users?",
    verdictMode: "gated",
    baseline: "PARTIAL — web push works; email/SMS/voice blocked on provider keys",
    evidence: [
      "frontend/src/lib/communication-core.ts + communication-providers.ts + frontend/src/lib/push.server.ts",
      "frontend/src/lib/notifications/ (contract, dispatch planner, email adapter contract)",
      "tests/unit/communication-core.test.ts + notifications-contract.test.ts + notifications-email-adapter.test.ts",
      "COREGRID_V1_BLOCKERS.json BLK-5 (communication provider keys; web push VAPID already works)",
    ],
    checks: [
      {
        id: "communication-substrate",
        desc: "communication + notification substrate recorded",
        refs: [
          "frontend/src/lib/communication-core.ts",
          "frontend/src/lib/communication-providers.ts",
          "frontend/src/lib/notifications/notification-contract.ts",
        ],
      },
      {
        id: "communication-suites",
        desc: "communication + notification suites recorded",
        refs: [
          "tests/unit/communication-core.test.ts",
          "tests/unit/notifications-contract.test.ts",
          "tests/unit/notifications-email-adapter.test.ts",
        ],
      },
      {
        id: "blk5-recorded-open",
        desc: "BLK-5 recorded and open (never bypassed)",
        kind: "json",
        ref: BLOCKERS_JSON,
        assert(json) {
          const entry = (json.blockers ?? []).find((b) => b.id === "BLK-5");
          return {
            ok: Boolean(entry) && !entry.item.startsWith("RESOLVED"),
            detail: entry ? "BLK-5 recorded open: " + entry.item.slice(0, 120) : "BLK-5 missing from register",
          };
        },
      },
    ],
    gate: {
      id: "BLK-5",
      reason:
        "Live send paths (email/SMS/voice) require communication provider keys (recorded blocker BLK-5). Web push works; the live rails are never faked.",
    },
  },
  {
    id: "PAYMENTS",
    statement: "Can supported organizations process transactions?",
    verdictMode: "gated",
    baseline: "PARTIAL — Paystack contract verified; live key validation pending",
    evidence: [
      "frontend/src/lib/payments/payment-contract.ts + paystack-adapter.ts + replay-guard.ts",
      "tests/unit/payments-contract.test.ts + payments-paystack-adapter.test.ts + payments-replay-guard.test.ts",
      "COREGRID_V1_BLOCKERS.json BLK-4 (Paystack live/secret key)",
    ],
    checks: [
      {
        id: "payments-substrate",
        desc: "payments contract + adapter + replay guard recorded",
        refs: [
          "frontend/src/lib/payments/payment-contract.ts",
          "frontend/src/lib/payments/paystack-adapter.ts",
          "frontend/src/lib/payments/replay-guard.ts",
        ],
      },
      {
        id: "payments-suites",
        desc: "payments suites recorded",
        refs: ["tests/unit/payments-contract.test.ts", "tests/unit/payments-replay-guard.test.ts"],
      },
      {
        id: "blk4-recorded-open",
        desc: "BLK-4 recorded and open (never bypassed)",
        kind: "json",
        ref: BLOCKERS_JSON,
        assert(json) {
          const entry = (json.blockers ?? []).find((b) => b.id === "BLK-4");
          return {
            ok: Boolean(entry) && !entry.item.startsWith("RESOLVED"),
            detail: entry ? "BLK-4 recorded open: " + entry.item.slice(0, 120) : "BLK-4 missing from register",
          };
        },
      },
    ],
    gate: {
      id: "BLK-4",
      reason:
        "Live payment validation requires the Paystack live/secret key (recorded blocker BLK-4). The contract is verified; live rails are never faked.",
    },
  },
  {
    id: "OBSERVABILITY",
    statement: "Can operators know whether the system works?",
    verdictMode: "mechanical",
    baseline: "NO — no health endpoint, metrics, or error reporting wiring (LAUNCH_BLOCKER)",
    evidence: [
      "frontend/src/lib/observability/health.ts + structured-log.ts + substrate-telemetry.ts",
      "frontend/src/routes/health[.]json.ts (health endpoint route)",
      "Dockerfile HEALTHCHECK contract (/health.json 200 ok|degraded, 503 failing)",
      "infrastructure/monitoring/README.md",
      "tests/unit/foundation-observability.test.ts",
    ],
    checks: [
      {
        id: "observability-substrate",
        desc: "observability substrate recorded (health, structured log, telemetry)",
        refs: [
          "frontend/src/lib/observability/health.ts",
          "frontend/src/lib/observability/structured-log.ts",
          "frontend/src/lib/observability/substrate-telemetry.ts",
        ],
      },
      {
        id: "health-endpoint",
        desc: "health endpoint route recorded",
        ref: "frontend/src/routes/health[.]json.ts",
      },
      {
        id: "dockerfile-healthcheck",
        desc: "release image healthcheck contract recorded",
        ref: "Dockerfile",
        mustMatch: [/health\.json/],
      },
      {
        id: "monitoring-standpoint",
        desc: "monitoring standpoint recorded",
        ref: "infrastructure/monitoring/README.md",
      },
      {
        id: "observability-suite",
        desc: "foundation observability suite recorded",
        ref: "tests/unit/foundation-observability.test.ts",
      },
    ],
    residualGates: [
      "BLK-3 — live monitoring of the serving URL is owned by the deployment gate",
    ],
  },
  {
    id: "ECONOMICS",
    statement: "Can AI/resource consumption be measured?",
    verdictMode: "mechanical",
    baseline: "NO — metering substrate absent (V1-minimal required)",
    evidence: [
      "frontend/src/lib/metering/usage-ledger.ts + cost-attribution.ts",
      "database/supabase/migrations/20261002000010_coregrid_v1_cost_attribution.sql",
      "frontend/src/lib/adapters/cost-attribution-store.adapter.ts",
      "tests/unit/adapter-cost-attribution.test.ts",
    ],
    checks: [
      {
        id: "metering-substrate",
        desc: "metering substrate recorded (usage ledger + cost attribution)",
        refs: ["frontend/src/lib/metering/usage-ledger.ts", "frontend/src/lib/metering/cost-attribution.ts"],
      },
      {
        id: "cost-attribution-migration",
        desc: "cost attribution migration recorded",
        ref: "database/supabase/migrations/20261002000010_coregrid_v1_cost_attribution.sql",
      },
      {
        id: "cost-attribution-suite",
        desc: "cost attribution suite recorded",
        ref: "tests/unit/adapter-cost-attribution.test.ts",
      },
    ],
  },
  {
    id: "EXTENSIBILITY",
    statement: "Can another domain be added without rebuilding CoreGrid?",
    verdictMode: "mechanical",
    baseline: "PARTIAL — Scholar runtime proves one domain; second-domain proof pending (Part 64)",
    evidence: [
      "frontend/src/lib/domain-config/restaurant.ts (second-domain fixture)",
      "tests/unit/domain-runtime-recertification.test.ts (second-domain acceptance oracle)",
      "architecture/registry.json (runtimes: scholar + restaurant)",
      "scripts/verify-domain-neutrality.mjs (standing domain-neutrality guard, shrink-only ratchet)",
    ],
    checks: [
      {
        id: "second-domain-fixture",
        desc: "second domain (restaurant) fixture recorded",
        ref: "frontend/src/lib/domain-config/restaurant.ts",
      },
      {
        id: "recertification-oracle",
        desc: "domain runtime recertification oracle recorded",
        ref: "tests/unit/domain-runtime-recertification.test.ts",
      },
      {
        id: "registry-two-runtimes",
        desc: "registry declares at least two runtimes",
        kind: "json",
        ref: REGISTRY_JSON,
        assert(json) {
          const count = (json.runtimes ?? []).length;
          return {
            ok: count >= 2,
            detail: `registry declares ${count} runtime(s)`,
          };
        },
      },
      {
        id: "repo-gate:neutrality",
        desc: "standing domain-neutrality guard PASS",
        kind: "repo-gate",
        gate: "neutrality",
      },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────
 * Canonical record parsing + harness drift validation (exit 2)
 * ────────────────────────────────────────────────────────────*/

export function parseCanonicalCriteria(root) {
  const doc = readJson(root, LAUNCH_CRITERIA_JSON);
  const criteria = doc.criteria ?? [];
  return {
    mission: doc.mission,
    artifact: doc.artifact,
    status: doc.status,
    launchDefinition: doc.launchDefinition,
    rule: doc.rule,
    criteria: criteria.map((c) => ({ id: c.criterion, statement: c.question, current: c.current })),
  };
}

export function validateCatalog(harnessCriteria, canonical) {
  const errors = [];
  const harnessIds = harnessCriteria.map((c) => c.id);
  const canonicalIds = canonical.criteria.map((c) => c.id);
  if (canonicalIds.length !== 18) errors.push(`canonical record lists ${canonicalIds.length} criteria, expected 18`);
  if (harnessIds.length !== 18) errors.push(`harness data lists ${harnessIds.length} criteria, expected 18`);
  for (const c of canonical.criteria) {
    const entry = harnessCriteria.find((h) => h.id === c.id);
    if (!entry) {
      errors.push(`criterion ${c.id} missing from harness data`);
      continue;
    }
    if (entry.statement !== c.statement) {
      errors.push(`criterion ${c.id} statement drifted from the canonical record — fix the harness, never the record`);
    }
  }
  for (const h of harnessCriteria) {
    if (!canonical.criteria.some((c) => c.id === h.id)) {
      errors.push(`harness criterion ${h.id} is not in the canonical record (invented criteria are forbidden)`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/* ─────────────────────────────────────────────────────────────
 * Recorded gate resolution — the harness refuses to invent gates
 * ────────────────────────────────────────────────────────────*/

export function resolveGateRecord(root, gate) {
  const id = gate.id;
  if (id.startsWith("BLK-") || id.startsWith("OPS-")) {
    let entry;
    try {
      const blockers = readJson(root, BLOCKERS_JSON);
      entry = (blockers.blockers ?? []).find((b) => b.id === id);
    } catch {
      return { ok: false, detail: `blockers register unreadable; gate ${id} cannot be resolved` };
    }
    if (!entry) return { ok: false, detail: `gate ${id} is not recorded in ${BLOCKERS_JSON}` };
    if (entry.item.startsWith("RESOLVED")) {
      return { ok: false, detail: `gate ${id} is recorded RESOLVED — it cannot own an open gap` };
    }
    return { ok: true, detail: `${id}: ${entry.item}` };
  }
  if (id === "GOV-P63-DEFER-MINIMIZE") {
    let plan;
    try {
      plan = readJson(root, MASTER_PLAN_JSON);
    } catch {
      return { ok: false, detail: "master implementation plan unreadable; GOV gate cannot be resolved" };
    }
    const deferred = plan.part63OrderCorrections?.deferOrMinimize ?? "";
    if (typeof deferred === "string" && deferred.includes("application builder")) {
      return {
        ok: true,
        detail: "GOV-P63-DEFER-MINIMIZE recorded: " + deferred.slice(0, 140),
      };
    }
    return { ok: false, detail: "master plan does not record the application-builder deferral" };
  }
  return { ok: false, detail: `gate ${id} is not a recorded gate kind — inventing gates is forbidden` };
}

/* ─────────────────────────────────────────────────────────────
 * Recorded RLS isolation battery (never re-executed live here)
 * ────────────────────────────────────────────────────────────*/

export function checkRlsBatteryRecorded(root, artifactPath) {
  let md;
  try {
    md = readText(root, BATTERY_MD);
  } catch {
    return { ok: false, detail: "RLS_ISOLATION_BATTERY.md unreadable" };
  }
  if (!/FINDINGS:\s*\*\*0\*\*/.test(md)) {
    return { ok: false, detail: "ratification record does not record FINDINGS 0" };
  }
  const artifact = artifactPath ?? process.env.COREGRID_RLS_BATTERY_RESULTS ?? BATTERY_ARTIFACT_DEFAULT;
  if (!existsSync(artifact)) {
    return {
      ok: true,
      detail: `PASS via recorded ratification record (FINDINGS 0); structured artifact not present at ${artifact} on this machine`,
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(artifact, "utf8"));
    const summary = parsed.summary ?? {};
    const ok =
      summary.total > 0 &&
      summary.pass === summary.total &&
      (summary.fail ?? 0) === 0 &&
      Array.isArray(parsed.findings) &&
      parsed.findings.length === 0;
    return {
      ok,
      detail: ok
        ? `PASS via recorded artifact (${summary.pass}/${summary.total} invariants, findings 0, executedAt ${parsed.executedAt}, project ${parsed.projectRef})`
        : `recorded artifact at ${artifact} does NOT record a clean battery — refusing to claim PASS`,
    };
  } catch {
    return { ok: false, detail: `recorded artifact at ${artifact} unreadable` };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Check execution against a repo root (fixture-injectable)
 * ────────────────────────────────────────────────────────────*/

export function runCriterionChecks(criterion, ctx) {
  const results = [];
  for (const check of criterion.checks) {
    if (check.kind === "battery-recorded") {
      const r = checkRlsBatteryRecorded(ctx.root, ctx.batteryArtifactPath);
      results.push({ id: check.id, desc: check.desc, ...r });
      continue;
    }
    if (check.kind === "repo-gate") {
      const gate = ctx.gateResults?.[check.gate];
      results.push({
        id: check.id,
        desc: check.desc,
        ok: Boolean(gate?.ok),
        detail: gate?.ok
          ? `repo gate ${check.gate} PASS`
          : `repo gate ${check.gate} not green: ${gate?.detail ?? "not run"}`,
      });
      continue;
    }
    if (check.kind === "json") {
      try {
        const json = readJson(ctx.root, check.ref);
        const r = check.assert(json);
        results.push({ id: check.id, desc: check.desc, ok: Boolean(r.ok), detail: r.detail });
      } catch (error) {
        results.push({ id: check.id, desc: check.desc, ok: false, detail: `unreadable: ${error.message}` });
      }
      continue;
    }
    const refs = check.refs ?? [check.ref];
    const missing = refs.filter((ref) => !exists(ctx.root, ref));
    if (missing.length > 0) {
      results.push({ id: check.id, desc: check.desc, ok: false, detail: `missing: ${missing.join(", ")}` });
      continue;
    }
    let contentFailure = null;
    if (check.mustMatch) {
      const text = readText(ctx.root, check.ref);
      for (const pattern of check.mustMatch) {
        if (!pattern.test(text)) {
          contentFailure = `content does not match ${pattern}`;
          break;
        }
      }
    }
    results.push({
      id: check.id,
      desc: check.desc,
      ok: contentFailure === null,
      detail: contentFailure ?? (refs.length === 1 ? `present: ${refs[0]}` : `present: ${refs.join(", ")}`),
    });
  }
  return results;
}

/* ─────────────────────────────────────────────────────────────
 * Verdict computation (pure — unit-tested on the fixture)
 * ────────────────────────────────────────────────────────────*/

export function evaluateCriterion(criterion, checkResults, gateResolution) {
  const failed = checkResults.filter((r) => !r.ok);
  if (failed.length > 0) {
    return {
      verdict: "unproven",
      failures: failed.map((f) => `${f.id}: ${f.detail}`),
      note: criterion.gate
        ? `substrate checks failed — the ${criterion.gate.id} gate cannot rescue a broken in-repo substrate`
        : "in-repo evidence missing or failed, and no recorded gate owns the gap",
    };
  }
  if (criterion.gate) {
    if (gateResolution?.ok) {
      return {
        verdict: "blocked",
        failures: [],
        note: `blocked by recorded gate ${criterion.gate.id} — ${criterion.gate.reason}`,
      };
    }
    return {
      verdict: "unproven",
      failures: [`gate ${criterion.gate.id}: ${gateResolution?.detail ?? "gate not resolved"}`],
      note: "a blocked verdict requires a gate that resolves to a recorded entry — refusing to fake one",
    };
  }
  return { verdict: "proven", failures: [], note: "all mapped repo checks re-evaluated PASS in this run" };
}

export function summarize(verdicts) {
  const summary = { proven: 0, blocked: 0, unproven: 0 };
  for (const v of verdicts) summary[v.verdict] += 1;
  return { ...summary, exitCode: summary.unproven === 0 ? 0 : 1 };
}

/* ─────────────────────────────────────────────────────────────
 * Repo gate panel (the repo's own offline gates, re-run live)
 * ────────────────────────────────────────────────────────────*/

const REPO_GATES = [
  { id: "neutrality", command: ["node", "scripts/verify-domain-neutrality.mjs"], timeoutMs: 120_000 },
  { id: "registry-validate", command: ["node", "scripts/verification/registry-validate.mjs"], timeoutMs: 120_000 },
  { id: "registry-drift", command: ["node", "scripts/verify-registry-drift.mjs"], timeoutMs: 120_000 },
  { id: "retention", command: ["node", "scripts/verify-retention-schedule.mjs"], timeoutMs: 120_000 },
  { id: "typecheck", command: ["npx", "tsc", "--noEmit"], timeoutMs: 420_000 },
];

export function runRepoGates(root, runner, ids) {
  const run = runner ?? defaultGateRunner;
  const results = {};
  for (const gate of REPO_GATES) {
    if (ids && !ids.includes(gate.id)) continue;
    results[gate.id] = run(root, gate);
  }
  return results;
}

function defaultGateRunner(root, gate) {
  const res = spawnSync(gate.command[0], gate.command.slice(1), {
    cwd: root,
    encoding: "utf8",
    timeout: gate.timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  const ok = res.status === 0;
  const tail = output.split("\n").filter(Boolean).slice(-4).join(" | ");
  return {
    ok,
    detail: ok
      ? `${gate.command.join(" ")} exit 0`
      : `${gate.command.join(" ")} exit ${res.status ?? "signal"}: ${tail.slice(0, 400)}`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Main
 * ────────────────────────────────────────────────────────────*/

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const canonical = parseCanonicalCriteria(root);
  const validation = validateCatalog(CRITERIA, canonical);
  if (!validation.ok) {
    console.error("LAUNCH CRITERIA HARNESS INVALID (exit 2) — fix the harness, never the record:");
    for (const error of validation.errors) console.error(" - " + error);
    process.exit(2);
  }

  console.log("COREGRID V1 LAUNCH CRITERIA HARNESS (Part 74, 18 criteria) — MISSION H2-15");
  console.log(`canonical source: ${LAUNCH_CRITERIA_JSON} (${canonical.status})`);
  console.log(`launch definition: ${canonical.launchDefinition}`);

  const gateResults = runRepoGates(root);
  console.log(
    "repo gate panel: " +
      Object.entries(gateResults)
        .map(([id, r]) => `${id} ${r.ok ? "PASS" : "RED"}`)
        .join(" | "),
  );
  for (const [id, r] of Object.entries(gateResults)) {
    if (!r.ok) console.log(`  repo gate ${id} RED (advisory for criteria that do not claim it): ${r.detail}`);
  }

  const verdicts = [];
  for (const criterion of CRITERIA) {
    const checkResults = runCriterionChecks(criterion, { root, gateResults });
    const gateResolution = criterion.gate ? resolveGateRecord(root, criterion.gate) : null;
    const outcome = evaluateCriterion(criterion, checkResults, gateResolution);
    verdicts.push({ criterion, checkResults, gateResolution, outcome });
  }

  console.log("");
  for (const { criterion, checkResults, gateResolution, outcome } of verdicts) {
    const tag = outcome.verdict.toUpperCase().padEnd(8);
    console.log(`[${criterion.id}] ${tag} baseline: ${criterion.baseline}`);
    for (const check of checkResults) {
      console.log(`    ${check.ok ? "ok  " : "FAIL"} ${check.id} — ${check.detail}`);
    }
    if (gateResolution) console.log(`    gate: ${gateResolution.ok ? "resolved" : "UNRESOLVED"} — ${gateResolution.detail}`);
    if (criterion.residualGates) {
      for (const residual of criterion.residualGates) console.log(`    residual gate (printed, not claimed): ${residual}`);
    }
    console.log(`    evidence: ${criterion.evidence.join("; ")}`);
    if (outcome.verdict === "unproven") {
      for (const failure of outcome.failures) console.log(`    UNPROVEN: ${failure}`);
    }
    console.log(`    -> ${outcome.note}`);
  }

  const summary = summarize(verdicts.map((v) => v.outcome));
  console.log("");
  console.log(
    `SUMMARY: proven=${summary.proven} blocked=${summary.blocked} unproven=${summary.unproven}` +
      ` (blocked is NOT failed — unproven is the failure state)`,
  );
  const blocked = verdicts.filter((v) => v.outcome.verdict === "blocked");
  for (const { criterion } of blocked) {
    console.log(`  blocked: ${criterion.id} — owned by gate ${criterion.gate.id}`);
  }
  if (summary.unproven === 0) {
    console.log(
      "LAUNCH CRITERIA HARNESS: PASS (exit 0) — no criterion is unproven; launch readiness still requires the recorded gates to clear.",
    );
    process.exit(0);
  }
  console.error(`LAUNCH CRITERIA HARNESS: FAIL (exit 1) — ${summary.unproven} criterion(a) unproven`);
  process.exit(1);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}