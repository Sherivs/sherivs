/**
 * MISSION V1-002 — Hermes executive orchestrator core (team HERMES).
 *
 * Proves, at unit level (in-memory ports + the reference mission store + the
 * in-memory canonical memory adapter — no database, no process, no I/O):
 *  1. full cycle over seeded state: OBSERVE → ASSESS → PRIORITIZE → ACT →
 *     REPORT phases, findings of every kind, lawful delegation, escalations,
 *     provenance-stamped memory writes, structured report;
 *  2. blocked/failed/denied mission detection (stuck stages, exhaustion,
 *     admission denial, failed independent verification);
 *  3. delegation goes through the neutral RBAC engine: a Hermes with NO
 *     delegation grants CANNOT act (Invariant 12 denial, zero intents);
 *  4. the approval gate produces a typed REQUIRE_APPROVAL routed to a human
 *     — never an execution;
 *  5. deny rules block the destructive action classes (fail-closed, encoded);
 *  6. memory writes carry §12 provenance through the canonical memory tier;
 *  7. the cycle is idempotent: a re-run over unchanged state replays the
 *     recorded outcomes and creates no new missions or memory records.
 */

import { describe, expect, it } from "vitest";
import type { MissionExecutionState } from "@/lib/missions/mission-execution";
import {
  createInMemoryMissionExecutionStore,
  type MissionExecutionStore,
} from "@/lib/missions/mission-execution-store";
import type { MissionActorContext } from "@/lib/missions/mission-authorization";
import type { WorkerDefinition } from "@/lib/workforce/worker-definition";
import {
  validateWorkerRegistration,
  type WorkerDelegationGrantState,
} from "@/lib/workforce/worker-registry";
import { createInMemoryMemoryTierAdapter } from "@/lib/memory/memory-adapter";
import {
  classifyHermesAction,
  type HermesClassificationInput,
} from "@/lib/hermes/hermes-classifier";
import {
  assessExecutions,
  assessWorkers,
  prioritizeFindings,
  runHermesCycle,
} from "@/lib/hermes/hermes-cycle";
import {
  hermesClaim,
  type HermesObservationPort,
  type HermesVerificationRecord,
  type HermesWorkerPosture,
} from "@/lib/hermes/hermes-contract";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-alpha";
const T0 = "2026-10-01T12:00:00.000Z";
const T_CYCLE = "2026-10-01T12:05:00.000Z"; // 5 minutes after seeding
const ACTION_SAFE = "record-observation";
const ACTION_CRITICAL = "deploy-cdn-config";

const CONFIG = {
  leaseTtlMs: 30_000,
  heartbeatIntervalMs: 10_000,
  maxAttempts: 3,
  retryBackoffBaseMs: 1_000,
  retryBackoffMaxMs: 60_000,
};

function owner(): MissionActorContext {
  return {
    actorId: "owner-1",
    tenantId: TENANT,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_owner",
  };
}

function operator(): MissionActorContext {
  return {
    actorId: "operator-1",
    tenantId: TENANT,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_operator",
  };
}

function verifier(): MissionActorContext {
  return {
    actorId: "verifier-1",
    tenantId: TENANT,
    identityKind: "human",
    lifecycle: "active",
    role: "mission_verifier",
  };
}

/** A governed AI Hermes definition (deny-by-default until grants land). */
function hermesDefinition(): WorkerDefinition {
  const validated = validateWorkerRegistration({
    tenantId: TENANT,
    definitionId: "hermes-1",
    identityRef: "31313131-3131-4311-8311-313131313131",
    classification: "ai",
    capabilities: [
      { capabilityId: "mission:create:*", description: "declare repair intents" },
      { capabilityId: "mission:execute:*", description: "assign repair work" },
    ],
    maxRiskClass: "medium",
    resourceScopes: ["mission"],
    createdBy: "registrar-1",
    traceId: "trace-hermes-1",
    correlationId: "correlation-hermes-1",
  });
  if (!validated.ok) throw new Error(validated.errors.join("; "));
  return validated.definition;
}

/** Human delegation grants for Hermes (pre-recorded — never self-minted). */
function hermesGrants(count: number): WorkerDelegationGrantState[] {
  if (count === 0) return [];
  return [
    {
      grantId: "grant-hermes-1",
      definitionId: "hermes-1",
      delegationRef: "delegation:hermes-ops-1",
      delegatedCapabilities: ["mission:create:*", "mission:execute:*"],
      maxGrantedRiskClass: "medium",
      state: "active",
    },
  ];
}

/** Seed one mission intent + assignment (stage `assigned`) into the store. */
async function seedAssigned(
  store: MissionExecutionStore,
  input: { executionId: string; action: string; at?: string },
): Promise<void> {
  const at = input.at ?? T0;
  await store.recordIntent({
    actor: owner(),
    intent: {
      tenantId: TENANT,
      missionId: `MISSION-${input.executionId}`,
      version: "1.0",
      purpose: "hermes-seeded-probe",
      authorityRef: "CONTROL-PLANE-06",
      contextRef: "context-1",
      ownerRef: "MISSIONS.md",
      nonScope: [],
      authorizedActions: [input.action],
      expiresAt: null,
    },
    now: at,
  });
  await store.assignExecution({
    actor: operator(),
    assignment: {
      tenantId: TENANT,
      missionId: `MISSION-${input.executionId}`,
      version: "1.0",
      executionId: input.executionId,
      idempotencyKey: `idem-${input.executionId}-0000001`,
      action: input.action,
      realityRef: "cg_entity:22222222-2222-4222-8222-222222222222",
      now: at,
    },
  });
}

/** Controllable in-memory store + read-only observation port over it. */
async function seededWorld() {
  const store = createInMemoryMissionExecutionStore({ config: CONFIG });

  // exec-stuck — assigned, unupdated for 5 minutes (safe action).
  await seedAssigned(store, { executionId: "exec-stuck", action: ACTION_SAFE });

  // exec-requeued — leased then worker-reported failure → requeued, retry overdue.
  await seedAssigned(store, { executionId: "exec-requeued", action: ACTION_SAFE });
  const leased = await store.acquireLease({
    actor: operator(),
    request: { tenantId: TENANT, executionId: "exec-requeued", workerId: "worker-1", now: T0 },
  });
  expect(leased.ok).toBe(true);
  if (!leased.ok) throw new Error("lease failed");
  await store.completeExecution({
    actor: operator(),
    request: {
      tenantId: TENANT,
      executionId: "exec-requeued",
      leaseId: leased.value.leaseId,
      workerId: "worker-1",
      outcome: { outcome: "failed", reason: "transient worker fault" },
      now: T0,
    },
  });

  // exec-exhausted — failed on every bounded attempt → exhausted terminal.
  await seedAssigned(store, { executionId: "exec-exhausted", action: ACTION_SAFE });
  for (let attempt = 0; attempt < CONFIG.maxAttempts; attempt += 1) {
    // Advance past the bounded retry backoff between attempts.
    const at = new Date(Date.parse(T0) + attempt * 4_000).toISOString();
    const lease = await store.acquireLease({
      actor: operator(),
      request: { tenantId: TENANT, executionId: "exec-exhausted", workerId: "worker-1", now: at },
    });
    expect(lease.ok).toBe(true);
    if (!lease.ok) throw new Error(lease.reason);
    await store.completeExecution({
      actor: operator(),
      request: {
        tenantId: TENANT,
        executionId: "exec-exhausted",
        leaseId: lease.value.leaseId,
        workerId: "worker-1",
        outcome: { outcome: "failed", reason: "deterministic fault" },
        now: at,
      },
    });
  }

  // exec-denied — action outside the intent's authorizedActions → denied.
  await store.recordIntent({
    actor: owner(),
    intent: {
      tenantId: TENANT,
      missionId: "MISSION-exec-denied",
      version: "1.0",
      purpose: "hermes-seeded-probe",
      authorityRef: "CONTROL-PLANE-06",
      contextRef: "context-1",
      ownerRef: "MISSIONS.md",
      nonScope: [],
      authorizedActions: [ACTION_SAFE],
      expiresAt: null,
    },
    now: T0,
  });
  await store.assignExecution({
    actor: operator(),
    assignment: {
      tenantId: TENANT,
      missionId: "MISSION-exec-denied",
      version: "1.0",
      executionId: "exec-denied",
      idempotencyKey: "idem-exec-denied-00001",
      action: ACTION_CRITICAL,
      realityRef: "cg_entity:22222222-2222-4222-8222-222222222222",
      now: T0,
    },
  });

  // exec-evidenced — success with evidence, NOT yet verified.
  await seedAssigned(store, { executionId: "exec-evidenced", action: ACTION_SAFE });
  const evidenceLease = await store.acquireLease({
    actor: operator(),
    request: { tenantId: TENANT, executionId: "exec-evidenced", workerId: "worker-1", now: T0 },
  });
  expect(evidenceLease.ok).toBe(true);
  if (!evidenceLease.ok) throw new Error("lease failed");
  await store.completeExecution({
    actor: operator(),
    request: {
      tenantId: TENANT,
      executionId: "exec-evidenced",
      leaseId: evidenceLease.value.leaseId,
      workerId: "worker-1",
      outcome: {
        outcome: "succeeded",
        evidence: [
          {
            evidenceKind: "observation-recorded",
            sourceRef: "cg_entity:22222222-2222-4222-8222-222222222222",
            lineage: ["hermes-probe"],
          },
        ],
      },
      now: T0,
    },
  });

  // exec-verify-failed — evidenced then FAILED independent verification.
  await seedAssigned(store, { executionId: "exec-verify-failed", action: ACTION_SAFE });
  const failedLease = await store.acquireLease({
    actor: operator(),
    request: { tenantId: TENANT, executionId: "exec-verify-failed", workerId: "worker-1", now: T0 },
  });
  expect(failedLease.ok).toBe(true);
  if (!failedLease.ok) throw new Error("lease failed");
  await store.completeExecution({
    actor: operator(),
    request: {
      tenantId: TENANT,
      executionId: "exec-verify-failed",
      leaseId: failedLease.value.leaseId,
      workerId: "worker-1",
      outcome: {
        outcome: "succeeded",
        evidence: [
          {
            evidenceKind: "observation-recorded",
            sourceRef: "cg_entity:22222222-2222-4222-8222-222222222222",
            lineage: ["hermes-probe"],
          },
        ],
      },
      now: T0,
    },
  });
  const verification = await store.verifyExecution(verifier(), {
    tenantId: TENANT,
    executionId: "exec-verify-failed",
    criteriaMet: false,
    now: T0,
  });
  expect(verification.ok).toBe(true);
  if (!verification.ok) throw new Error("verification failed");
  expect(verification.value.verification.decision).toBe("failed");

  // Worker postures (workforce registry read shape).
  const workerPostures: HermesWorkerPosture[] = [
    {
      workerId: "worker-quarantined",
      tenantId: TENANT,
      lifecycle: "suspended",
      quarantined: true,
      failureCount: 5,
      observedAt: T0,
    },
    {
      workerId: "worker-suspended",
      tenantId: TENANT,
      lifecycle: "suspended",
      quarantined: false,
      failureCount: 0,
      observedAt: T0,
    },
  ];

  const verificationRecords: HermesVerificationRecord[] = [
    {
      executionId: "exec-verify-failed",
      decision: "failed",
      reason: verification.value.verification.reason,
      verifierId: "verifier-1",
      recordedAt: T0,
    },
  ];

  const listed: MissionExecutionState[] = [];
  for (const executionId of [
    "exec-stuck",
    "exec-requeued",
    "exec-exhausted",
    "exec-denied",
    "exec-evidenced",
    "exec-verify-failed",
  ]) {
    const execution = await store.getExecution(TENANT, executionId);
    if (execution !== null) listed.push(execution);
  }

  const observations: HermesObservationPort = {
    backend: "db",
    async listExecutions(tenantId) {
      if (tenantId !== TENANT) return [];
      return listed;
    },
    async listWorkerPostures() {
      return workerPostures;
    },
    async listVerificationRecords() {
      return verificationRecords;
    },
  };

  return { store, observations };
}

/** Counting mission-port wrapper — proves exactly which intents Hermes tried. */
function countingMissions(store: MissionExecutionStore) {
  const intentCalls: string[] = [];
  return {
    intentCalls,
    missions: {
      async recordIntent(input: Parameters<MissionExecutionStore["recordIntent"]>[0]) {
        intentCalls.push(input.intent.missionId);
        return store.recordIntent(input);
      },
      async assignExecution(input: Parameters<MissionExecutionStore["assignExecution"]>[0]) {
        return store.assignExecution(input);
      },
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * 1. Full cycle over seeded state
 * ────────────────────────────────────────────────────────────*/

describe("Hermes full cycle", () => {
  it("runs OBSERVE→ASSESS→PRIORITIZE→ACT→REPORT over seeded state and delegates lawful repairs", async () => {
    const { store, observations } = await seededWorld();
    const { missions, intentCalls } = countingMissions(store);
    const memory = createInMemoryMemoryTierAdapter();
    const definition = hermesDefinition();

    const result = await runHermesCycle(
      { missions, observations, memory },
      { definition, grants: hermesGrants(1) },
      { tenantId: TENANT, now: T_CYCLE },
    );

    // Phases: full loop, all ok, WAKE→…→SLEEP order.
    expect(result.phases.map((p) => p.phase)).toEqual([
      "WAKE",
      "OBSERVE",
      "ASSESS",
      "PRIORITIZE",
      "ACT",
      "REPORT",
      "SLEEP",
    ]);
    expect(result.phases.every((p) => p.ok)).toBe(true);

    const report = result.report;
    expect(report.actorRef).toBe("hermes");
    expect(report.sleep.state).toBe("sleeping");

    // Findings: stuck, requeued-stuck, exhausted→failed, denied,
    // unverified evidence, failed verification, quarantined + suspended worker.
    const kinds = report.findings.map((f) => f.kind).sort();
    expect(kinds).toEqual([
      "evidence_unverified",
      "mission_denied",
      "mission_failed",
      "mission_failed",
      "mission_stuck",
      "mission_stuck",
      "worker_quarantined",
      "worker_suspended",
    ]);

    // Every claim is DB-backed (verified, canonical) with a source ref.
    for (const finding of report.findings) {
      expect(finding.claim.verified).toBe(true);
      expect(finding.claim.confidence).toBe("canonical");
      expect(finding.claim.source).not.toBe("hermes_memory");
      expect(finding.claim.sourceRef.length).toBeGreaterThan(0);
      expect(finding.evidenceRefs.length).toBeGreaterThan(0);
    }

    // Deterministic, explainable prioritization: severity rank then subject.
    const severities = report.prioritized.map((a) => a.finding.severity);
    const rankOf = { critical: 0, warning: 1, info: 2 } as const;
    expect(severities).toEqual([...severities].sort((a, b) => rankOf[a] - rankOf[b]));
    for (const assessment of report.prioritized) {
      expect(assessment.rationale.length).toBeGreaterThan(0);
    }

    // Delegation: the safe stuck mission gets a repair intent + assignment
    // through the V1-004 record port under Hermes' own resolved identity.
    const stuckDelegation = report.delegations.find(
      (d) => d.findingId === "mission_stuck:exec-stuck",
    );
    expect(stuckDelegation).toBeDefined();
    if (!stuckDelegation) throw new Error("missing delegation");
    expect(stuckDelegation.intentRecorded).toBe(true);
    expect(stuckDelegation.assignmentRecorded).toBe(true);
    expect(stuckDelegation.replayed).toBe(false);
    expect(stuckDelegation.authorityRef).toBe("delegation:grant-hermes-1");
    expect(stuckDelegation.repairMissionId).toBe("hermes-repair-exec-stuck");
    expect(intentCalls).toContain("hermes-repair-exec-stuck");
    const repairExecution = await store.getExecution(TENANT, stuckDelegation.repairExecutionId);
    expect(repairExecution?.assignedBy).toBe("hermes-1");

    // The failed/denied/unverified findings escalate to humans.
    expect(report.escalations.length).toBeGreaterThanOrEqual(4);

    // Memory decisions recorded with provenance through the canonical tier.
    expect(report.memoryWrites.length).toBeGreaterThan(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Blocked-mission detection
 * ────────────────────────────────────────────────────────────*/

describe("Hermes blocked-mission detection", () => {
  it("detects stuck assigned work past the staleness window", async () => {
    const { observations } = await seededWorld();
    const executions = await observations.listExecutions(TENANT);
    const findings = assessExecutions(executions, [], TENANT, T_CYCLE, {
      assignedStaleAfterMs: 60_000,
    });
    const stuck = findings.filter((f) => f.kind === "mission_stuck").map((f) => f.subjectRef);
    expect(stuck).toContain("exec-stuck");
    expect(stuck).toContain("exec-requeued"); // overdue retry pickup
  });

  it("detects exhausted and failed-verification missions as critical failures", async () => {
    const { observations } = await seededWorld();
    const executions = await observations.listExecutions(TENANT);
    const verificationRecords = await observations.listVerificationRecords(TENANT);
    const findings = assessExecutions(executions, verificationRecords, TENANT, T_CYCLE, {
      assignedStaleAfterMs: 60_000,
    });
    const failed = findings.filter((f) => f.kind === "mission_failed");
    expect(failed.map((f) => f.subjectRef).sort()).toEqual([
      "exec-exhausted",
      "exec-verify-failed",
    ]);
    expect(failed.every((f) => f.severity === "critical")).toBe(true);
  });

  it("detects admission-denied missions and unverified evidence", async () => {
    const { observations } = await seededWorld();
    const executions = await observations.listExecutions(TENANT);
    const findings = assessExecutions(executions, [], TENANT, T_CYCLE, {
      assignedStaleAfterMs: 60_000,
    });
    expect(findings.some((f) => f.findingId === "mission_denied:exec-denied")).toBe(true);
    expect(findings.some((f) => f.findingId === "evidence_unverified:exec-evidenced")).toBe(true);
  });

  it("never derives findings from Hermes' own repair missions (no recursion)", () => {
    const repairExecution = {
      executionId: "hermes-repair-exec-stuck-exec-1",
      missionId: "hermes-repair-exec-stuck",
    } as unknown as MissionExecutionState;
    const findings = assessExecutions([repairExecution], [], TENANT, T_CYCLE, {
      assignedStaleAfterMs: 60_000,
    });
    expect(findings).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Delegation goes through the neutral RBAC engine
 * ────────────────────────────────────────────────────────────*/

describe("Hermes delegation authority", () => {
  it("a Hermes WITHOUT delegation grants CANNOT act — zero intents recorded", async () => {
    const { store, observations } = await seededWorld();
    const { missions, intentCalls } = countingMissions(store);
    const memory = createInMemoryMemoryTierAdapter();

    const result = await runHermesCycle(
      { missions, observations, memory },
      { definition: hermesDefinition(), grants: hermesGrants(0) },
      { tenantId: TENANT, now: T_CYCLE },
    );

    const stuckDelegation = result.report.delegations.find(
      (d) => d.findingId === "mission_stuck:exec-stuck",
    );
    expect(stuckDelegation).toBeDefined();
    if (!stuckDelegation) throw new Error("missing delegation");
    // Invariant 12: the RBAC engine denies the undelegated agent at recordIntent.
    expect(stuckDelegation.intentRecorded).toBe(false);
    expect(stuckDelegation.assignmentRecorded).toBe(false);
    expect(stuckDelegation.denialReason).toMatch(/intent_denied|delegation_denied/);
    // NO delegation attempt succeeded anywhere — nothing was acted on.
    expect(result.report.delegations.every((d) => !d.intentRecorded && !d.assignmentRecorded)).toBe(
      true,
    );
    const repair = await store.getExecution(TENANT, stuckDelegation.repairExecutionId);
    expect(repair).toBeNull();
  });

  it("a Hermes with grants acts ONLY through its resolved governed identity", async () => {
    const { store, observations } = await seededWorld();
    const { missions } = countingMissions(store);
    const memory = createInMemoryMemoryTierAdapter();

    const result = await runHermesCycle(
      { missions, observations, memory },
      { definition: hermesDefinition(), grants: hermesGrants(1) },
      { tenantId: TENANT, now: T_CYCLE },
    );

    for (const delegation of result.report.delegations) {
      if (!delegation.assignmentRecorded) continue;
      const execution = await store.getExecution(TENANT, delegation.repairExecutionId);
      expect(execution?.assignedBy).toBe("hermes-1");
      expect(delegation.authorityRef).toBe("delegation:grant-hermes-1");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Approval gate: REQUIRE_APPROVAL, never execution
 * ────────────────────────────────────────────────────────────*/

describe("Hermes approval gate", () => {
  it("routes a critical stuck mission to REQUIRE_APPROVAL and does NOT execute", async () => {
    const { store, observations } = await seededWorld();
    const { missions, intentCalls } = countingMissions(store);
    const memory = createInMemoryMemoryTierAdapter();

    // A stuck execution whose underlying action is critical (deploy-*).
    await seedAssigned(store, { executionId: "exec-critical", action: ACTION_CRITICAL });
    const critical = await store.getExecution(TENANT, "exec-critical");
    if (critical === null) throw new Error("seed failed");
    const withCritical: HermesObservationPort = {
      backend: "db",
      listExecutions: async (tenantId) =>
        tenantId === TENANT ? [...(await observations.listExecutions(TENANT)), critical] : [],
      listWorkerPostures: observations.listWorkerPostures,
      listVerificationRecords: observations.listVerificationRecords,
    };

    const result = await runHermesCycle(
      { missions, observations: withCritical, memory },
      { definition: hermesDefinition(), grants: hermesGrants(1) },
      { tenantId: TENANT, now: T_CYCLE },
    );

    const decision = result.report.decisions.find(
      (d) => d.findingId === "mission_stuck:exec-critical",
    );
    expect(decision).toBeDefined();
    if (!decision) throw new Error("missing decision");
    expect(decision.verdict.decision).toBe("REQUIRE_APPROVAL");
    expect(decision.acted).toBe(true); // the APPROVAL REQUEST was routed…

    const approval = result.report.approvalRequests.find(
      (a) => a.findingId === "mission_stuck:exec-critical",
    );
    expect(approval).toBeDefined();
    if (!approval) throw new Error("missing approval request");
    expect(approval.routedTo).toBe("human_operator");
    expect(result.report.escalations.some((e) => e.recordId.includes("exec-critical"))).toBe(true);

    // …but the repair was NEVER delegated or executed.
    expect(intentCalls.filter((missionId) => missionId === "hermes-repair-exec-critical")).toEqual(
      [],
    );
    const repair = await store.getExecution(TENANT, "hermes-repair-exec-critical-exec-1");
    expect(repair).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Deny rules block destructive action classes
 * ────────────────────────────────────────────────────────────*/

describe("Hermes deny rules (fail-closed)", () => {
  const destructive: Array<[HermesClassificationInput["actionClass"], string]> = [
    ["deploy", "deploy_forbidden"],
    ["delete_data", "destructive_write_forbidden"],
    ["purge_production_state", "production_state_forbidden"],
    ["modify_governance", "governance_mutation_forbidden"],
    ["grant_authority", "self_authority_grant_forbidden"],
  ];

  for (const [actionClass, expectedCode] of destructive) {
    it(`DENIES ${actionClass} with code ${expectedCode}`, () => {
      const verdict = classifyHermesAction({ actionClass, underlyingAction: "" });
      expect(verdict.decision).toBe("DENY");
      if (verdict.decision === "DENY") expect(verdict.code).toBe(expectedCode);
    });
  }

  it("DENIES unknown action classes (no guessing)", () => {
    const verdict = classifyHermesAction({
      actionClass: "reformat_everything" as HermesClassificationInput["actionClass"],
      underlyingAction: "",
    });
    expect(verdict.decision).toBe("DENY");
    if (verdict.decision === "DENY") expect(verdict.code).toBe("unknown_action_class");
  });

  it("a retry proposal for a critical underlying action is elevated to the approval gate, not allowed", () => {
    const verdict = classifyHermesAction({
      actionClass: "retry_safe_mission",
      underlyingAction: "delete-tenant-export",
    });
    expect(verdict.decision).toBe("REQUIRE_APPROVAL");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Memory writes carry provenance (canonical memory tier)
 * ────────────────────────────────────────────────────────────*/

describe("Hermes memory provenance", () => {
  it("writes decisions through the canonical adapter with AI-generated, unverified provenance", async () => {
    const { observations } = await seededWorld();
    const memory = createInMemoryMemoryTierAdapter();
    const store = createInMemoryMissionExecutionStore({ config: CONFIG });
    const { missions } = countingMissions(store);

    await runHermesCycle(
      { missions, observations, memory },
      { definition: hermesDefinition(), grants: hermesGrants(1) },
      { tenantId: TENANT, now: T_CYCLE },
    );

    const loaded = await memory.load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.error);

    // One declared Hermes scope, with §12 declaredBy provenance.
    expect(loaded.store.scopes).toHaveLength(1);
    const scope = loaded.store.scopes[0];
    expect(scope.scopeId).toBe(`hermes:scope:${TENANT}`);
    expect(scope.domains).toEqual(["orchestration"]);
    expect(scope.actorScope).toEqual(["hermes-1"]);

    // Every decision record: AI-generated, UNVERIFIED (memory ≠ truth, §9).
    expect(loaded.store.records.length).toBeGreaterThan(0);
    for (const record of loaded.store.records) {
      expect(record.envelope.provenance.source).toBe("hermes:orchestrator");
      expect(record.envelope.provenance.generatedByAi).toBe(true);
      expect(record.envelope.provenance.verified).toBe(false);
      expect(record.envelope.provenance.originTenantId).toBe(TENANT);
      expect(record.envelope.created_by).toBe("hermes-1");
      expect(record.scopeId).toBe(`hermes:scope:${TENANT}`);
    }
  });

  it("marks memory-sourced claims uncertain and DB-backed claims canonical", () => {
    const memoryClaim = hermesClaim("hermes_memory", "mem:1", T_CYCLE, "prior decision");
    const dbClaim = hermesClaim("mission_record_port", "cg_execution_record:e1", T_CYCLE, "stage");
    expect(memoryClaim.verified).toBe(false);
    expect(memoryClaim.confidence).toBe("uncertain");
    expect(dbClaim.verified).toBe(true);
    expect(dbClaim.confidence).toBe("canonical");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Cycle idempotency
 * ────────────────────────────────────────────────────────────*/

describe("Hermes cycle idempotency", () => {
  it("a re-run over unchanged state replays outcomes — no duplicated missions or memory", async () => {
    const { store, observations } = await seededWorld();
    const { missions, intentCalls } = countingMissions(store);
    const memory = createInMemoryMemoryTierAdapter();
    const identity = { definition: hermesDefinition(), grants: hermesGrants(1) };
    const input = { tenantId: TENANT, now: T_CYCLE };

    const first = await runHermesCycle({ missions, observations, memory }, identity, input);
    const intentsAfterFirst = intentCalls.length;
    const loadedAfterFirst = await memory.load();
    if (!loadedAfterFirst.ok) throw new Error(loadedAfterFirst.error);
    const recordsAfterFirst = loadedAfterFirst.store.records.length;

    const second = await runHermesCycle({ missions, observations, memory }, identity, input);

    // Every delegation in the second cycle replayed a recorded outcome (§10).
    expect(second.report.delegations.length).toBe(first.report.delegations.length);
    for (const delegation of second.report.delegations) {
      if (delegation.assignmentRecorded) expect(delegation.replayed).toBe(true);
    }
    // No new intent records: same deterministic (tenant, mission, version).
    expect(intentCalls.length).toBe(intentsAfterFirst + first.report.delegations.length);
    // No new memory records: prior decisions retained verbatim.
    const loadedAfterSecond = await memory.load();
    if (!loadedAfterSecond.ok) throw new Error(loadedAfterSecond.error);
    expect(loadedAfterSecond.store.records.length).toBe(recordsAfterFirst);
    expect(second.report.memoryWrites.length).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Prioritization determinism (explainability)
 * ────────────────────────────────────────────────────────────*/

describe("Hermes prioritization", () => {
  it("orders findings deterministically: severity rank, then stable subject tie-break", async () => {
    const { observations } = await seededWorld();
    const executions = await observations.listExecutions(TENANT);
    const verificationRecords = await observations.listVerificationRecords(TENANT);
    const workerPostures = await observations.listWorkerPostures(TENANT);
    const findings = [
      ...assessExecutions(executions, verificationRecords, TENANT, T_CYCLE, {
        assignedStaleAfterMs: 60_000,
      }),
      ...assessWorkers(
        workerPostures.map((p) => ({ ...p })),
        TENANT,
        T_CYCLE,
      ),
    ];
    const prioritized = prioritizeFindings(findings);
    const rankOf = { critical: 0, warning: 1, info: 2 } as const;
    for (let i = 1; i < prioritized.length; i += 1) {
      const prev = prioritized[i - 1];
      const current = prioritized[i];
      const prevRank = rankOf[prev.finding.severity];
      const currentRank = rankOf[current.finding.severity];
      expect(currentRank).toBeGreaterThanOrEqual(prevRank);
      if (prevRank === currentRank) {
        expect(current.finding.subjectRef >= prev.finding.subjectRef).toBe(true);
      }
    }
  });
});
