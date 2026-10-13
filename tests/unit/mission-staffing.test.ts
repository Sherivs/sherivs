/**
 * Dynamic mission staffing — Engineering + Security Command.
 *
 * Proves teams are sized from mission complexity, Jarvis never implements,
 * frozen roles cannot be staffed, and four-eyes keeps implementer ≠ verifier.
 */
import { describe, expect, it } from "vitest";
import { staffMission } from "@/lib/workforce/mission-staffing";
import {
  buildV1RoleCapabilityRegistry,
  roleCapabilityId,
} from "@/lib/workforce/v1-workforce-lock";
import { defineWorkerDefinition } from "@/lib/workforce/worker-definition";

const TENANT = "tenant-alpha";

function live(roleId: string) {
  const defined = defineWorkerDefinition({
    id: `live:${roleId}`,
    tenantScope: TENANT,
    identityRef: `identity:${roleId}`,
    classification: "ai",
    capabilities: [{ capabilityId: roleCapabilityId(roleId), description: `declared ${roleId}` }],
    authorityBounds: { maxRiskClass: "critical", resourceScopes: ["scope:all"] },
    lifecycle: "active",
  });
  if (!defined.ok) throw new Error(defined.errors.join("; "));
  return defined.definition;
}

describe("mission staffing", () => {
  it("staffs a simple defect as one implementer plus an independent verifier", () => {
    const result = staffMission({
      tenantId: TENANT,
      missionRef: "mission-simple",
      profile: "simple_defect",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const implement = result.plan.slots.filter((slot) => slot.slotKind === "implement");
    const verify = result.plan.slots.filter((slot) => slot.slotKind === "verify");
    expect(implement).toHaveLength(1);
    expect(implement[0]?.roleId).toBe("backend_engineer");
    expect(verify).toHaveLength(1);
    expect(verify[0]?.roleId).toBe("qa_engineer");
    expect(result.plan.coordinatorRoleId).toBe("jarvis");
    expect(result.plan.sleepPolicy).toBe("workers_sleep_when_mission_completes");
    expect(result.plan.slots.every((slot) => slot.activation !== "already_live")).toBe(true);
  });

  it("staffs a database migration with database + security + independent verification", () => {
    const result = staffMission({
      tenantId: TENANT,
      missionRef: "mission-db",
      profile: "database_migration",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const roleIds = result.plan.slots.map((slot) => slot.roleId);
    expect(roleIds).toEqual(
      expect.arrayContaining(["jarvis", "database_engineer", "security_architect", "security_verification_agent"]),
    );
    expect(result.plan.slots.some((slot) => slot.slotKind === "verify")).toBe(true);
  });

  it("staffs a major infrastructure change with a specialist graph, not a standing swarm of 50", () => {
    const result = staffMission({
      tenantId: TENANT,
      missionRef: "mission-infra",
      profile: "infrastructure_migration",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.slots.length).toBeGreaterThan(5);
    expect(result.plan.slots.length).toBeLessThan(20);
    expect(result.plan.slots.map((slot) => slot.roleId)).toEqual(
      expect.arrayContaining([
        "platform_engineer",
        "database_engineer",
        "security_architect",
        "sre",
        "release_verification_engineer",
      ]),
    );
  });

  it("refuses to staff Jarvis as implementer or verifier", () => {
    const asImplementer = staffMission({
      tenantId: TENANT,
      missionRef: "mission-bad",
      requiredImplementerRoles: ["jarvis"],
      requiredVerifierRole: "qa_engineer",
    });
    expect(asImplementer.ok).toBe(false);
    if (asImplementer.ok) return;
    expect(asImplementer.errors.join(" ")).toMatch(/must not implement or verify/i);

    const asVerifier = staffMission({
      tenantId: TENANT,
      missionRef: "mission-bad-2",
      requiredImplementerRoles: ["backend_engineer"],
      requiredVerifierRole: "jarvis",
    });
    expect(asVerifier.ok).toBe(false);
  });

  it("refuses frozen and deferred roles", () => {
    const result = staffMission({
      tenantId: TENANT,
      missionRef: "mission-frozen",
      requiredImplementerRoles: ["sdk_engineer"],
      requiredVerifierRole: "qa_engineer",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/DEFERRED-BEYOND-V2|cannot be staffed/i);
  });

  it("refuses the same role implementing and verifying", () => {
    const result = staffMission({
      tenantId: TENANT,
      missionRef: "mission-same",
      requiredImplementerRoles: ["qa_engineer"],
      requiredVerifierRole: "qa_engineer",
    });
    expect(result.ok).toBe(false);
  });

  it("binds live worker definitions when they declare the role capability", () => {
    const registry = buildV1RoleCapabilityRegistry();
    const result = staffMission({
      tenantId: TENANT,
      missionRef: "mission-live",
      profile: "simple_defect",
      liveWorkers: [live("backend_engineer"), live("qa_engineer")],
      capabilityRegistry: registry,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const backend = result.plan.slots.find((slot) => slot.roleId === "backend_engineer");
    const qa = result.plan.slots.find((slot) => slot.roleId === "qa_engineer");
    expect(backend?.assignedWorkerId).toBe("live:backend_engineer");
    expect(backend?.activation).toBe("already_live");
    expect(qa?.assignedWorkerId).toBe("live:qa_engineer");
  });
});
