/**
 * CoreGrid — dynamic mission staffing (Engineering Command).
 *
 * Jarvis (or any lawful coordinator) asks for a team. This module returns a
 * workforce PLAN from the V1 lock + capability matching. It does not wake
 * processes, mint workers, or execute work.
 *
 *   MISSION COMPLEXITY → REQUIRED ROLES → FOUR-EYES → ACTIVATION PLAN
 *
 * Frozen / deferred roles cannot be staffed. Jarvis cannot implement or
 * verify. The same worker cannot implement and verify. High-risk work
 * requires the verifier to come from quality or security command.
 *
 * Reuses `matchWorkersForCapabilityRequirement` when live worker definitions
 * exist. When they do not, slots remain role-level with
 * `activation: "wake_on_mission"` — persistent identity without persistent
 * compute.
 *
 * Boundary: pure functions. No I/O, no vendor, no secrets.
 */

import type { AgentRiskClassification } from "../agent-core";
import {
  matchWorkersForCapabilityRequirement,
  type CapabilityRegistry,
} from "./capability-registry";
import type { WorkerDefinition } from "./worker-definition";
import {
  buildV1RoleCapabilityRegistry,
  getV1WorkforceWorker,
  isWorkerActivatable,
  roleCapabilityId,
  type V1WorkforceWorker,
  type WorkforceCommand,
} from "./v1-workforce-lock";

export const MISSION_STAFFING_PROFILES = [
  "simple_defect",
  "database_migration",
  "infrastructure_migration",
] as const;

export type MissionStaffingProfile = (typeof MISSION_STAFFING_PROFILES)[number];

export type StaffingSlotKind = "coordinate" | "implement" | "verify" | "observe";

export type StaffingActivation = "wake_on_mission" | "already_live" | "sleep_on_complete";

export interface MissionStaffingRequest {
  readonly tenantId: string;
  readonly missionRef: string;
  readonly profile?: MissionStaffingProfile;
  readonly requiredImplementerRoles?: readonly string[];
  readonly requiredVerifierRole?: string;
  readonly maxRiskClass?: AgentRiskClassification;
  readonly liveWorkers?: readonly WorkerDefinition[];
  readonly capabilityRegistry?: CapabilityRegistry;
}

export interface StaffingSlot {
  readonly slotKind: StaffingSlotKind;
  readonly roleId: string;
  readonly command: WorkforceCommand;
  readonly workerName: string;
  readonly assignedWorkerId: string | null;
  readonly activation: StaffingActivation;
  readonly capabilityId: string;
  readonly reason: string;
}

export type StaffingResult =
  | { ok: true; plan: MissionStaffingPlan }
  | { ok: false; errors: readonly string[] };

export interface MissionStaffingPlan {
  readonly tenantId: string;
  readonly missionRef: string;
  readonly profile: MissionStaffingProfile | "custom";
  readonly maxRiskClass: AgentRiskClassification;
  readonly coordinatorRoleId: "jarvis";
  readonly slots: readonly StaffingSlot[];
  readonly implementerCount: number;
  readonly verifierCount: number;
  readonly fourEyes: {
    readonly implementerIds: readonly string[];
    readonly verifierIds: readonly string[];
    readonly independent: true;
  };
  readonly sleepPolicy: "workers_sleep_when_mission_completes";
}

const PROFILE_IMPLEMENTERS: Readonly<Record<MissionStaffingProfile, readonly string[]>> = {
  simple_defect: ["backend_engineer"],
  database_migration: ["database_engineer", "security_architect"],
  infrastructure_migration: [
    "chief_architect",
    "platform_engineer",
    "database_engineer",
    "security_architect",
    "sre",
    "qa_engineer",
    "release_engineer",
    "observability_engineer",
  ],
};

const PROFILE_VERIFIERS: Readonly<Record<MissionStaffingProfile, string>> = {
  simple_defect: "qa_engineer",
  database_migration: "security_verification_agent",
  infrastructure_migration: "release_verification_engineer",
};

const PROFILE_RISK: Readonly<Record<MissionStaffingProfile, AgentRiskClassification>> = {
  simple_defect: "medium",
  database_migration: "high",
  infrastructure_migration: "high",
};

const VERIFY_COMMANDS: ReadonlySet<WorkforceCommand> = new Set([
  "quality_command",
  "security_command",
]);

function isNonEmptyTrimmed(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 128;
}

function unique(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function roleOrError(roleId: string): { ok: true; worker: V1WorkforceWorker } | { ok: false; error: string } {
  const worker = getV1WorkforceWorker(roleId);
  if (!worker) return { ok: false, error: `unknown workforce role "${roleId}"` };
  if (!isWorkerActivatable(roleId)) {
    return {
      ok: false,
      error: `role "${roleId}" is ${worker.versionTarget} and cannot be staffed in V1`,
    };
  }
  return { ok: true, worker };
}

function matchLiveWorker(
  roleId: string,
  tenantId: string,
  liveWorkers: readonly WorkerDefinition[],
  registry: CapabilityRegistry,
  maxRiskClass: AgentRiskClassification,
): string | null {
  const capabilityId = roleCapabilityId(roleId);
  if (!registry.has(capabilityId)) return null;
  const result = matchWorkersForCapabilityRequirement(registry, liveWorkers, {
    tenantId,
    requiredCapabilityIds: [capabilityId],
    maxRiskClass,
  });
  return result.qualified[0]?.workerId ?? null;
}

function slotFor(
  slotKind: StaffingSlotKind,
  worker: V1WorkforceWorker,
  assignedWorkerId: string | null,
  reason: string,
): StaffingSlot {
  return {
    slotKind,
    roleId: worker.workerId,
    command: worker.command,
    workerName: worker.workerName,
    assignedWorkerId,
    activation: assignedWorkerId ? "already_live" : "wake_on_mission",
    capabilityId: roleCapabilityId(worker.workerId),
    reason,
  };
}

/**
 * Staff a mission from the V1 lock. Returns a plan, never a running swarm.
 */
export function staffMission(request: MissionStaffingRequest): StaffingResult {
  const errors: string[] = [];
  if (!isNonEmptyTrimmed(request.tenantId)) errors.push("tenantId is required");
  if (!isNonEmptyTrimmed(request.missionRef)) errors.push("missionRef is required");

  const profile = request.profile;
  const implementerRoles = unique(
    request.requiredImplementerRoles ?? (profile ? PROFILE_IMPLEMENTERS[profile] : []),
  );
  const verifierRole =
    request.requiredVerifierRole ?? (profile ? PROFILE_VERIFIERS[profile] : undefined);
  const maxRiskClass = request.maxRiskClass ?? (profile ? PROFILE_RISK[profile] : "medium");

  if (implementerRoles.length === 0) {
    errors.push("staffing requires at least one implementer role or a known profile");
  }
  if (!verifierRole?.trim()) {
    errors.push("staffing requires an independent verifier role (four-eyes)");
  }
  if (errors.length > 0) return { ok: false, errors };

  const jarvis = getV1WorkforceWorker("jarvis");
  if (!jarvis) return { ok: false, errors: ["jarvis is missing from the V1 lock"] };

  if (implementerRoles.includes("jarvis") || verifierRole === "jarvis") {
    return {
      ok: false,
      errors: ["Jarvis commands the organization and must not implement or verify mission work"],
    };
  }

  const registry = request.capabilityRegistry ?? buildV1RoleCapabilityRegistry();
  const liveWorkers = request.liveWorkers ?? [];
  const slots: StaffingSlot[] = [];

  slots.push(
    slotFor(
      "coordinate",
      jarvis,
      null,
      "Jarvis coordinates; specialists execute; the cycle ends (sleep)",
    ),
  );

  const implementerWorkers: V1WorkforceWorker[] = [];
  for (const roleId of implementerRoles) {
    const resolved = roleOrError(roleId);
    if (!resolved.ok) {
      errors.push(resolved.error);
      continue;
    }
    implementerWorkers.push(resolved.worker);
    const assigned = matchLiveWorker(roleId, request.tenantId.trim(), liveWorkers, registry, maxRiskClass);
    slots.push(
      slotFor(
        implementerKindForRole(roleId),
        resolved.worker,
        assigned,
        `profile slot for ${roleId}`,
      ),
    );
  }

  const verifierResolved = roleOrError(verifierRole!.trim());
  if (!verifierResolved.ok) {
    errors.push(verifierResolved.error);
  } else {
    if (!VERIFY_COMMANDS.has(verifierResolved.worker.command)) {
      errors.push(
        `verifier "${verifierRole}" must belong to quality_command or security_command (four-eyes)`,
      );
    }
    if (implementerRoles.includes(verifierResolved.worker.workerId)) {
      errors.push("the same role cannot implement and verify the same mission");
    }
    if (maxRiskClass === "high" || maxRiskClass === "critical") {
      const implementerCommands = new Set(implementerWorkers.map((entry) => entry.command));
      if (implementerCommands.has(verifierResolved.worker.command) && implementerWorkers.length === 1) {
        errors.push(
          `high-risk four-eyes: verifier command "${verifierResolved.worker.command}" must differ from the sole implementer command`,
        );
      }
    }
    const assigned = matchLiveWorker(
      verifierResolved.worker.workerId,
      request.tenantId.trim(),
      liveWorkers,
      registry,
      maxRiskClass,
    );
    if (assigned && slots.some((slot) => slot.assignedWorkerId === assigned && slot.slotKind === "implement")) {
      errors.push("the same live worker cannot implement and verify the same mission");
    }
    slots.push(
      slotFor(
        "verify",
        verifierResolved.worker,
        assigned,
        "independent verification — the implementer cannot declare success",
      ),
    );
  }

  if (errors.length > 0) return { ok: false, errors };

  const implementSlots = slots.filter((slot) => slot.slotKind === "implement" || slot.slotKind === "observe");
  const verifySlots = slots.filter((slot) => slot.slotKind === "verify");
  if (verifySlots.length < 1) {
    return { ok: false, errors: ["four-eyes failed: no verifier slot"] };
  }

  return {
    ok: true,
    plan: {
      tenantId: request.tenantId.trim(),
      missionRef: request.missionRef.trim(),
      profile: profile ?? "custom",
      maxRiskClass,
      coordinatorRoleId: "jarvis",
      slots: slots.map((slot) =>
        slot.slotKind === "implement" || slot.slotKind === "observe" || slot.slotKind === "verify"
          ? { ...slot, activation: slot.assignedWorkerId ? "already_live" : "wake_on_mission" }
          : slot,
      ),
      implementerCount: implementSlots.length,
      verifierCount: verifySlots.length,
      fourEyes: {
        implementerIds: implementSlots.map((slot) => slot.roleId),
        verifierIds: verifySlots.map((slot) => slot.roleId),
        independent: true,
      },
      sleepPolicy: "workers_sleep_when_mission_completes",
    },
  };
}

/**
 * Classify implementer slots after the fact so architecture-only roles stay
 * observe/propose even when listed on a large infrastructure mission.
 */
export function implementerKindForRole(roleId: string): StaffingSlotKind {
  const worker = getV1WorkforceWorker(roleId);
  if (!worker) return "observe";
  if (worker.workerId === "jarvis") return "coordinate";
  if (worker.command === "quality_command" || worker.command === "security_command") {
    return worker.authorityVerbs.includes("execute") ? "implement" : "verify";
  }
  if (worker.authorityVerbs.includes("execute")) return "implement";
  return "observe";
}
