/**
 * Jarvis enterprise loop — Executive + Quality Command.
 *
 * Proves Jarvis observes stamped evidence, staffs specialists, never
 * implements, never fabricates, and sleeps. Night mode escalates high-risk
 * work instead of executing it unattended.
 */
import { describe, expect, it } from "vitest";
import { JarvisCapability } from "@/lib/jarvis/jarvis-contract";
import {
  morningExecutiveReport,
  runJarvisEnterpriseCycle,
  type JarvisObservation,
} from "@/lib/jarvis/enterprise-loop";

const TENANT = "tenant-alpha";
const NOW = "2026-10-13T08:00:00.000Z";
const GRANTED = Object.values(JarvisCapability);

function observation(partial: Partial<JarvisObservation> & Pick<JarvisObservation, "kind" | "summary">): JarvisObservation {
  return {
    observationId: partial.observationId ?? `obs:${partial.kind}`,
    tenantRef: partial.tenantRef ?? TENANT,
    at: partial.at ?? NOW,
    kind: partial.kind,
    severity: partial.severity ?? "warning",
    summary: partial.summary,
    evidenceRef: partial.evidenceRef ?? `evidence:${partial.kind}`,
    claimClass: partial.claimClass ?? "OBSERVED",
  };
}

describe("Jarvis enterprise loop", () => {
  it("sleeps without inventing missions when nothing was observed", () => {
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      observations: [],
      grantedCapabilities: GRANTED,
    });
    expect(result.detections).toEqual([]);
    expect(result.missionProposals).toEqual([]);
    expect(result.staffingPlans).toEqual([]);
    expect(result.briefing).toBeNull();
    expect(result.sleep.reason).toMatch(/cycle complete/i);
    expect(result.phases.map((phase) => phase.phase)).toContain("SLEEP");
    const report = morningExecutiveReport(result);
    expect(report.happened).toEqual([]);
    expect(report.requiresHuman).toEqual([]);
  });

  it("ignores unknown observation kinds instead of inventing conditions", () => {
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      grantedCapabilities: GRANTED,
      observations: [
        observation({
          kind: "mysterious_blip",
          summary: "an unknown signal",
        }),
      ],
    });
    expect(result.detections).toEqual([]);
    expect(result.missionProposals).toEqual([]);
    expect(result.claims[0]?.claimClass).toBe("OBSERVED");
    expect(result.briefing?.lines[0]?.summary).toBe("an unknown signal");
  });

  it("detects an evidenced API failure, staffs one implementer plus verifier, and does not execute", () => {
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      grantedCapabilities: GRANTED,
      observations: [
        observation({
          kind: "api_failure",
          summary: "public webhook returned 5xx",
          severity: "warning",
        }),
      ],
    });
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]?.condition).toBe("api_failure");
    expect(result.missionProposals).toHaveLength(1);
    expect(result.missionProposals[0]?.evaluation.decision).toBe("allow");
    expect(result.staffingPlans).toHaveLength(1);
    const plan = result.staffingPlans[0];
    expect(plan?.slots.some((slot) => slot.slotKind === "implement")).toBe(true);
    expect(plan?.slots.some((slot) => slot.slotKind === "verify")).toBe(true);
    expect(plan?.coordinatorRoleId).toBe("jarvis");
    expect(result.delegations[0]?.evaluation.decision).toBe("allow");
    expect(result.delegations[0]?.directive).toMatch(/Jarvis does not perform the work/);
  });

  it("escalates high-risk night work instead of deploying unattended", () => {
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      grantedCapabilities: GRANTED,
      nightMode: true,
      observations: [
        observation({
          kind: "deployment_failure",
          severity: "critical",
          summary: "production deploy failed health checks",
        }),
      ],
    });
    expect(result.nightMode).toBe(true);
    expect(result.missionProposals[0]?.requiresHumanApproval).toBe(true);
    expect(result.staffingPlans).toEqual([]);
    expect(result.escalations.length).toBeGreaterThan(0);
    expect(result.escalations[0]?.humanApprovalRequired).toBe(true);
    const report = morningExecutiveReport(result);
    expect(report.requiresHuman).toContain("production deploy failed health checks");
  });

  it("refuses to observe without the granted capability and fabricates nothing", () => {
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      grantedCapabilities: [],
      observations: [
        observation({ kind: "api_failure", summary: "should not be consumed" }),
      ],
    });
    expect(result.missionProposals).toEqual([]);
    expect(result.briefing).toBeNull();
    expect(result.phases.find((phase) => phase.phase === "OBSERVE")?.ok).toBe(false);
  });

  it("never stamps VERIFIED claims from Jarvis itself", () => {
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      grantedCapabilities: GRANTED,
      observations: [
        observation({
          kind: "test_regression",
          summary: "unit suite failed on mission-staffing",
          claimClass: "OBSERVED",
        }),
      ],
    });
    expect(result.claims.every((claim) => claim.claimClass !== "VERIFIED")).toBe(true);
    expect(result.claims.every((claim) => claim.claimClass !== "EXECUTED")).toBe(true);
  });

  it("drops cross-tenant observations", () => {
    const result = runJarvisEnterpriseCycle({
      tenantRef: TENANT,
      now: NOW,
      grantedCapabilities: GRANTED,
      observations: [
        observation({
          kind: "api_failure",
          summary: "other tenant outage",
          tenantRef: "tenant-beta",
        }),
      ],
    });
    expect(result.detections).toEqual([]);
    expect(result.claims[0]?.claimClass).toBe("UNKNOWN");
  });
});
