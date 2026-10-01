/**
 * CoreGrid Workflow Engine contract tests (V5.3 Part 17, MISSION-V1-008).
 *
 * Validates the pure contracts in frontend/src/lib/workflow/
 * workflow-contract.ts:
 * - definition validation fails closed (Constitution §26, §31);
 * - run state transitions fail closed and terminal states are immutable;
 * - trigger matching across the eight Part 17 trigger kinds;
 * - authorizedActions containment: a step can never authorize an action
 *   outside its declaration;
 * - evidence usability vocabulary (mirrors foundation mission evidence).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  isActionAuthorized,
  isRunTransitionAllowed,
  isTriggerMatch,
  validateWorkflowDefinition,
  workflowEvidenceIsUsable,
  type ApprovalRequirement,
  type StepAssignment,
  type StepCondition,
  type WorkflowDefinition,
  type WorkflowEvidenceRecord,
  type WorkflowRunState,
  type WorkflowStep,
  type WorkflowTrigger,
} from "@/lib/workflow/workflow-contract";

const TENANT_A = tenantId("tenant-a");

function step(id: string, overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    stepId: id,
    kind: "task",
    assignment: { kind: "unassigned" },
    authorizedActions: [],
    ...overrides,
  };
}

function condition(overrides: Partial<StepCondition> = {}): StepCondition {
  return { field: "score", operator: "gte", value: 50, ...overrides };
}

const baseApprovals: readonly ApprovalRequirement[] = [
  { stepId: "ap1", approverRoleRef: "principal" },
];

const validDefinition: WorkflowDefinition = {
  definitionId: "wf-1",
  tenantRef: TENANT_A,
  name: "Badge issuance workflow",
  version: "1",
  trigger: { kind: "manual", actorRef: "user-1" },
  steps: [
    step("c1", {
      kind: "condition",
      condition: condition(),
      branches: { onTrueStepId: "t1", onFalseStepId: "skip1" },
    }),
    step("t1", { assignment: { kind: "human", roleRef: "admin" }, nextStepId: "a1" }),
    step("a1", { kind: "action", authorizedActions: ["badge.issue"], nextStepId: "n1" }),
    step("n1", {
      kind: "notification",
      assignment: { kind: "ai", agentRef: "agent-notify" },
    }),
    step("skip1", { kind: "notification" }),
  ],
  onFailure: { kind: "retry", maxAttempts: 3, backoffSeconds: 30 },
  requiredApprovals: [],
};

const validApprovalDefinition: WorkflowDefinition = {
  definitionId: "wf-2",
  tenantRef: TENANT_A,
  name: "Escalated access workflow",
  version: "1",
  trigger: { kind: "event", eventType: "access.requested" },
  steps: [
    step("t1", { nextStepId: "ap1" }),
    step("ap1", {
      kind: "approval",
      assignment: { kind: "human", roleRef: "principal" },
      authorizedActions: [],
      nextStepId: "a1",
    }),
    step("a1", { kind: "action", authorizedActions: ["access.grant"] }),
  ],
  onFailure: { kind: "halt" },
  requiredApprovals: baseApprovals,
};

describe("workflow definition validation (fail closed)", () => {
  it("accepts a valid multi-kind definition", () => {
    expect(validateWorkflowDefinition(validDefinition)).toEqual({ ok: true });
  });

  it("accepts a valid approval definition", () => {
    expect(validateWorkflowDefinition(validApprovalDefinition)).toEqual({ ok: true });
  });

  it.each([
    ["no steps", { ...validDefinition, steps: [] }, "no steps"],
    [
      "unknown branch target",
      {
        ...validDefinition,
        steps: [
          step("c1", {
            kind: "condition",
            condition: condition(),
            branches: { onTrueStepId: "ghost", onFalseStepId: null },
          }),
        ],
      },
      "branch",
    ],
    [
      "unknown nextStepId",
      { ...validDefinition, steps: [step("t1", { nextStepId: "ghost" })] },
      "unknown step",
    ],
    [
      "condition step without condition",
      {
        ...validDefinition,
        steps: [step("c1", { kind: "condition", branches: { onTrueStepId: null, onFalseStepId: null } })],
      },
      "no condition",
    ],
    [
      "gte condition without value",
      {
        ...validDefinition,
        steps: [
          step("c1", {
            kind: "condition",
            condition: condition({ value: undefined }),
            branches: { onTrueStepId: null, onFalseStepId: null },
          }),
        ],
      },
      "without a value",
    ],
    [
      "condition step without branches",
      {
        ...validDefinition,
        steps: [step("c1", { kind: "condition", condition: condition() })],
      },
      "no branches",
    ],
    [
      "approval step without declared requirement",
      { ...validApprovalDefinition, requiredApprovals: [] },
      "no declared approval requirement",
    ],
    [
      "approval step with AI assignment",
      {
        ...validApprovalDefinition,
        steps: validApprovalDefinition.steps.map((s) =>
          s.stepId === "ap1"
            ? { ...s, assignment: { kind: "ai", agentRef: "agent-1" } as StepAssignment }
            : s,
        ),
      },
      "human-assigned",
    ],
    [
      "approval approver role mismatch",
      {
        ...validApprovalDefinition,
        requiredApprovals: [{ stepId: "ap1", approverRoleRef: "teacher" }],
      },
      "does not match",
    ],
    [
      "non-approval step with approval requirement",
      {
        ...validApprovalDefinition,
        requiredApprovals: [{ stepId: "t1", approverRoleRef: "principal" }],
      },
      "not an approval step",
    ],
    [
      "action step with no authorized actions",
      {
        ...validDefinition,
        steps: validDefinition.steps.map((s) =>
          s.stepId === "a1" ? { ...s, authorizedActions: [] } : s,
        ),
      },
      "at least one authorized action",
    ],
    [
      "duplicate step ids",
      { ...validDefinition, steps: [step("t1"), step("t1")] },
      "Duplicate stepId",
    ],
    [
      "retry with zero attempts",
      {
        ...validDefinition,
        onFailure: { kind: "retry", maxAttempts: 0, backoffSeconds: 30 },
      },
      "maxAttempts",
    ],
    [
      "retry with negative backoff",
      {
        ...validDefinition,
        onFailure: { kind: "retry", maxAttempts: 2, backoffSeconds: -1 },
      },
      "backoffSeconds",
    ],
  ] as const)("rejects %s", (_label, def, fragment) => {
    const result = validateWorkflowDefinition(def);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(fragment);
    }
  });
});

describe("run state transitions (fail closed)", () => {
  it("allows governed forward transitions", () => {
    expect(isRunTransitionAllowed("running", "waiting_approval")).toBe(true);
    expect(isRunTransitionAllowed("running", "completed")).toBe(true);
    expect(isRunTransitionAllowed("running", "failed")).toBe(true);
    expect(isRunTransitionAllowed("running", "cancelled")).toBe(true);
    expect(isRunTransitionAllowed("waiting_approval", "running")).toBe(true);
    expect(isRunTransitionAllowed("waiting_approval", "failed")).toBe(true);
    expect(isRunTransitionAllowed("waiting_approval", "cancelled")).toBe(true);
  });

  it.each([
    ["completed", ["running", "waiting_approval", "completed", "failed", "cancelled"] as const],
    ["failed", ["running", "waiting_approval", "completed", "failed", "cancelled"] as const],
    ["cancelled", ["running", "waiting_approval", "completed", "failed", "cancelled"] as const],
  ])("terminal state %s is immutable", (terminal, targets) => {
    const from = terminal as WorkflowRunState;
    for (const target of targets as readonly WorkflowRunState[]) {
      expect(isRunTransitionAllowed(from, target)).toBe(false);
    }
  });

  it("denies backwards transitions", () => {
    expect(isRunTransitionAllowed("completed", "running")).toBe(false);
    expect(isRunTransitionAllowed("failed", "running")).toBe(false);
    expect(isRunTransitionAllowed("cancelled", "running")).toBe(false);
  });
});

describe("trigger matching across the eight Part 17 kinds", () => {
  const triggers: readonly WorkflowTrigger[] = [
    { kind: "manual", actorRef: "user-1" },
    { kind: "event", eventType: "attendance.marked" },
    { kind: "scheduled", schedule: "0 6 * * *" },
    { kind: "form", formRef: "form-admission" },
    { kind: "payment", paymentEvent: "payment.succeeded" },
    { kind: "user_action", action: "profile.updated" },
    { kind: "ai", agentRef: "agent-1", proposalRef: "proposal-7" },
    { kind: "webhook", source: "gateway-ingress" },
  ];

  it.each(triggers)("matches an identical $kind trigger", (trigger) => {
    expect(isTriggerMatch(trigger, { ...trigger })).toBe(true);
  });

  it("denies kind mismatches", () => {
    expect(isTriggerMatch(triggers[0], triggers[1])).toBe(false);
    expect(isTriggerMatch(triggers[3], triggers[6])).toBe(false);
  });

  it("denies field mismatches within the same kind", () => {
    expect(
      isTriggerMatch(triggers[1], { kind: "event", eventType: "other.event" }),
    ).toBe(false);
    expect(
      isTriggerMatch(triggers[4], { kind: "payment", paymentEvent: "payment.refunded" }),
    ).toBe(false);
    expect(isTriggerMatch(triggers[0], { kind: "manual", actorRef: "user-2" })).toBe(false);
  });

  it("denies an AI trigger without a proposal reference", () => {
    expect(
      isTriggerMatch(triggers[6], { kind: "ai", agentRef: "agent-1", proposalRef: "  " }),
    ).toBe(false);
  });
});

describe("authorizedActions containment", () => {
  const actionStep = step("a1", {
    kind: "action",
    authorizedActions: ["badge.issue", "badge.revoke"],
  });

  it("authorizes only declared actions", () => {
    expect(isActionAuthorized(actionStep, "badge.issue")).toBe(true);
    expect(isActionAuthorized(actionStep, "badge.revoke")).toBe(true);
  });

  it("denies unlisted actions (fail closed)", () => {
    expect(isActionAuthorized(actionStep, "badge.delete")).toBe(false);
    expect(isActionAuthorized(actionStep, "")).toBe(false);
  });
});

describe("evidence usability (foundation vocabulary)", () => {
  const usable: WorkflowEvidenceRecord = {
    evidenceId: "ev-1",
    runId: "run-1",
    stepId: "t1",
    evidenceKind: "task_completed",
    producer: "workflow-runtime",
    actorId: "user-1",
    tenantRef: TENANT_A,
    recordedAt: "2026-10-01T00:00:00.000Z",
    provenance: "controlled-fixture",
    integrity: "hash-1",
  };

  it("accepts a fully populated record", () => {
    expect(workflowEvidenceIsUsable(usable)).toBe(true);
  });

  it.each(["producer", "provenance", "integrity", "recordedAt", "evidenceId"] as const)(
    "rejects a record with empty %s",
    (field) => {
      expect(workflowEvidenceIsUsable({ ...usable, [field]: " " })).toBe(false);
    },
  );
});