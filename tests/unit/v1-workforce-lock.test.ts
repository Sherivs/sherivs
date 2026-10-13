/**
 * V1 AI workforce scope lock — Architecture Council.
 *
 * Proves the lock is 64 capability definitions (not 64 running agents),
 * Jarvis is not omnipotent, frozen roles cannot be staffed, and the
 * executable registry matches the committed machine-readable artifact.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_VERBS,
  V1_WORKFORCE_WORKERS,
  WORKFORCE_COMMANDS,
  buildV1RoleCapabilityRegistry,
  isWorkerActivatable,
  listActivatableV1Workers,
  serializeV1WorkforceLock,
  validateV1WorkforceLock,
} from "@/lib/workforce/v1-workforce-lock";

const ARTIFACT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../architecture/COREGRID_V1_AI_WORKFORCE_REGISTRY.json",
);

describe("V1 AI workforce scope lock", () => {
  it("locks exactly 64 capability definitions and validates", () => {
    const integrity = validateV1WorkforceLock();
    expect(integrity.ok).toBe(true);
    expect(integrity.errors).toEqual([]);
    expect(integrity.workerCount).toBe(64);
    expect(V1_WORKFORCE_WORKERS).toHaveLength(64);
    expect(integrity.v1Count + integrity.frozenCount).toBe(64);
    expect(integrity.frozenCount).toBeGreaterThan(0);
    expect(integrity.v1Count).toBeGreaterThan(40);
  });

  it("does not instantiate standing processes", () => {
    for (const worker of V1_WORKFORCE_WORKERS) {
      expect(worker.status).toBe("capability_defined");
      expect(worker.lease).toBe("ephemeral_cycle");
      expect(worker.budgetLimit.tokensPerCycle).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps Jarvis non-omnipotent", () => {
    const jarvis = V1_WORKFORCE_WORKERS.find((worker) => worker.workerId === "jarvis");
    expect(jarvis).toBeDefined();
    expect(jarvis?.authorityVerbs).toEqual(["observe", "analyze", "propose"]);
    expect(jarvis?.authorityVerbs).not.toContain("execute");
    expect(jarvis?.authorityVerbs).not.toContain("verify");
    expect(jarvis?.authorityVerbs).not.toContain("deploy");
    expect(jarvis?.authorityVerbs).not.toContain("approve");
    expect(jarvis?.forbiddenOperations).toEqual(
      expect.arrayContaining([
        "implement_mission_work",
        "verify_mission_work",
        "deploy",
        "access_secrets",
        "self_authority_grant",
      ]),
    );
  });

  it("classifies every directive role and freezes non-V1 work instead of deleting it", () => {
    const ids = V1_WORKFORCE_WORKERS.map((worker) => worker.workerId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "jarvis",
        "chief_architect",
        "backend_engineer",
        "sdk_engineer",
        "ml_engineer",
        "knowledge_engineer",
        "growth_intelligence_agent",
        "customer_success_agent",
        "cost_optimization_agent",
      ]),
    );
    expect(isWorkerActivatable("sdk_engineer")).toBe(false);
    expect(isWorkerActivatable("ml_engineer")).toBe(false);
    expect(isWorkerActivatable("knowledge_engineer")).toBe(false);
    expect(isWorkerActivatable("backend_engineer")).toBe(true);
    expect(new Set(V1_WORKFORCE_WORKERS.map((worker) => worker.command)).size).toBe(
      WORKFORCE_COMMANDS.length,
    );
  });

  it("registers V1 role capabilities only", () => {
    const registry = buildV1RoleCapabilityRegistry();
    expect(registry.has("v1.role.backend_engineer")).toBe(true);
    expect(registry.has("v1.role.jarvis")).toBe(true);
    expect(registry.has("v1.role.sdk_engineer")).toBe(false);
    expect(registry.has("mission:execute")).toBe(true);
    expect(registry.has("mission:verify")).toBe(true);
    expect(listActivatableV1Workers().every((worker) => worker.versionTarget === "ACTIVE-V1")).toBe(
      true,
    );
  });

  it("uses the closed authority vocabulary", () => {
    for (const worker of V1_WORKFORCE_WORKERS) {
      for (const verb of worker.authorityVerbs) {
        expect(AUTHORITY_VERBS).toContain(verb);
      }
    }
  });

  it("matches the committed machine-readable artifact", () => {
    const snapshot = JSON.parse(readFileSync(ARTIFACT, "utf8")) as {
      artifact: string;
      status: string;
      workerCount: number;
      workers: readonly { workerId: string; versionTarget: string }[];
    };
    const serialized = serializeV1WorkforceLock();
    expect(snapshot.artifact).toBe("COREGRID_V1_AI_WORKFORCE_REGISTRY");
    expect(snapshot.status).toBe("SCOPE_LOCKED");
    expect(snapshot.workerCount).toBe(64);
    expect(snapshot.workers).toHaveLength(64);
    expect(snapshot.workers.map((worker) => worker.workerId)).toEqual(
      serialized.workers.map((worker) => worker.workerId),
    );
    expect(snapshot.workers.map((worker) => worker.versionTarget)).toEqual(
      serialized.workers.map((worker) => worker.versionTarget),
    );
  });
});
