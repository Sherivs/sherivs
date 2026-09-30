// ─── Phase 20 — Government Education Cloud: government-policy ─────────
import { describe, it, expect } from "vitest";
import {
  createPolicy,
  transitionPolicy,
  acknowledgePolicy,
  createProgramme,
  transitionProgramme,
  createFundingProgramme,
  submitApprovalWorkflow,
  reviewWorkflow,
  declareEmergency,
} from "@/lib/government-policy";

describe("government-policy — Policy Lifecycle", () => {
  it("creates policy in draft status", () => {
    const p = createPolicy({
      id: "POL-001" as any,
      title: "National Curriculum Policy",
      jurisdiction: "ng-fed",
      effectiveFrom: "2025-01-01",
    });
    expect(p.status).toBe("draft");
    expect(p.version).toBe(1);
  });

  it("transitions through valid states", () => {
    let p = createPolicy({
      id: "POL-001" as any,
      title: "Test Policy",
      jurisdiction: "ng",
      effectiveFrom: "2025-01-01",
    });
    p = transitionPolicy(p, "review");
    expect(p.status).toBe("review");
    p = transitionPolicy(p, "approved");
    expect(p.status).toBe("approved");
    p = transitionPolicy(p, "active");
    expect(p.status).toBe("active");
    p = transitionPolicy(p, "suspended");
    expect(p.status).toBe("suspended");
    p = transitionPolicy(p, "archived");
    expect(p.status).toBe("archived");
  });

  it("rejects invalid transition", () => {
    const p = createPolicy({
      id: "POL-001" as any,
      title: "Test",
      jurisdiction: "ng",
      effectiveFrom: "2025-01-01",
    });
    expect(() => transitionPolicy(p, "active")).toThrow();
  });

  it("acknowledges active policy", () => {
    let p = createPolicy({
      id: "POL-001" as any,
      title: "Test",
      jurisdiction: "ng",
      effectiveFrom: "2025-01-01",
      requiresAcknowledgement: true,
    });
    p = transitionPolicy(p, "review");
    p = transitionPolicy(p, "approved");
    p = transitionPolicy(p, "active");
    const ack = acknowledgePolicy(p, "entity-1", "user-1");
    expect(ack.policyId).toBe("POL-001" as any);
    expect(ack.acknowledgedBy).toBe("user-1");
  });
});

describe("government-policy — Programme Lifecycle", () => {
  it("creates programme in proposed status", () => {
    const prog = createProgramme({
      id: "PROG-001" as any,
      name: "School Feeding Programme",
      jurisdiction: "ng-fed",
      startDate: "2025-09-01",
      objectives: ["Improve nutrition"],
    });
    expect(prog.status).toBe("proposed");
  });

  it("transitions through valid states", () => {
    let p = createProgramme({
      id: "PROG-001" as any,
      name: "Test",
      jurisdiction: "ng",
      startDate: "2025-01-01",
    });
    p = transitionProgramme(p, "approved");
    expect(p.status).toBe("approved");
    p = transitionProgramme(p, "active");
    expect(p.status).toBe("active");
    p = transitionProgramme(p, "completed");
    expect(p.status).toBe("completed");
  });

  it("rejects invalid transition", () => {
    const p = createProgramme({
      id: "PROG-001" as any,
      name: "Test",
      jurisdiction: "ng",
      startDate: "2025-01-01",
    });
    expect(() => transitionProgramme(p, "completed")).toThrow();
  });
});

describe("government-policy — Funding Programme", () => {
  it("creates funding programme with positive budget", () => {
    const f = createFundingProgramme({
      id: "FUND-001" as any,
      programmeId: "PROG-001" as any,
      totalBudget: 50000000,
      allocationMethod: "formula",
      disbursementSchedule: "quarterly",
    });
    expect(f.totalBudget).toBe(50000000);
  });

  it("rejects zero budget", () => {
    expect(() =>
      createFundingProgramme({
        id: "f" as any,
        programmeId: "p" as any,
        totalBudget: 0,
        allocationMethod: "formula",
        disbursementSchedule: "annual",
      }),
    ).toThrow();
  });
});

describe("government-policy — Approval Workflow", () => {
  it("creates pending workflow", () => {
    const w = submitApprovalWorkflow({
      id: "WF-001",
      type: "policy",
      referenceId: "POL-001",
      submittedBy: "user-1",
    });
    expect(w.status).toBe("pending");
  });

  it("approves workflow", () => {
    let w = submitApprovalWorkflow({
      id: "WF-001",
      type: "policy",
      referenceId: "POL-001",
      submittedBy: "user-1",
    });
    w = reviewWorkflow(w, "approver-1", "approved", "Looks good");
    expect(w.status).toBe("approved");
    expect(w.reviewedBy).toBe("approver-1");
  });

  it("rejects already completed workflow", () => {
    let w = submitApprovalWorkflow({
      id: "WF-001",
      type: "policy",
      referenceId: "POL-001",
      submittedBy: "user-1",
    });
    w = reviewWorkflow(w, "approver-1", "approved");
    expect(() => reviewWorkflow(w, "approver-2", "approved")).toThrow();
  });
});

describe("government-policy — Emergency Declaration", () => {
  it("declares emergency", () => {
    const e = declareEmergency({
      jurisdiction: "ng-fed",
      declaredBy: "minister-1",
      status: "emergency",
      affectedRegions: ["Lagos", "Abuja"],
      educationContinuityPlan: true,
    });
    expect(e.status).toBe("emergency");
    expect(e.affectedRegions).toContain("Lagos");
  });

  it("rejects normal status with affected regions", () => {
    expect(() =>
      declareEmergency({
        jurisdiction: "ng",
        declaredBy: "admin",
        status: "normal",
        affectedRegions: ["Lagos"],
      }),
    ).toThrow();
  });
});
