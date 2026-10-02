/**
 * CoreGrid — governed tool runtime & sandbox tests
 * (J-008 / V1CAP-056, MISSION-R-62, wave 3).
 *
 * Validates the sandbox law of
 * `frontend/src/lib/workforce/tool-runtime.ts`:
 *  1. capability-gated execution — a worker without the tool's required
 *     capability is rejected with a typed reason, evaluated FRESH per
 *     invocation (no stale grant survives a revocation), with capability
 *     risk escalation denied, never clamped;
 *  2. lease mediation — secret-dependent tools acquire CredentialLeaseHandles
 *     through the credential broker, executors receive HANDLES only and
 *     resolve through the broker, and zero raw-secret material ever reaches
 *     an invocation record or the audit log (vault-probed);
 *  3. delegation bounding — the tool action must be granted by the
 *     delegation and the contract must be valid AS-OF the invocation
 *     instant (expired/revoked authorize nothing);
 *  4. sandbox isolation — unregistered tools are unexecutable, a tool's risk
 *     class bounds which workers may invoke it, and rate/budget guards
 *     produce typed, audited rejections;
 *  5. rotation invalidation — a lease rotated or revoked mid-flight fails
 *     through the broker, the runtime surfaces the failure, and it NEVER
 *     retries with the stale handle;
 *  6. invocation record completeness + redaction;
 *  7. cross-tenant isolation — invocation tenant mismatch and cross-tenant
 *     credential leasing are both denied.
 */

import { describe, expect, it } from "vitest";
import {
  ToolRuntime,
  InMemoryToolInvocationAuditSink,
  TOOL_PARAM_REDACTED,
  type GovernedToolDeclaration,
  type ToolExecutor,
  type ToolInvocationRecord,
  type ToolRuntimeAuditEvent,
} from "@/lib/workforce/tool-runtime";
import { createCapabilityRegistry, type CapabilityRegistry } from "@/lib/workforce/capability-registry";
import { defineWorkerDefinition, type WorkerDefinition } from "@/lib/workforce/worker-definition";
import {
  CredentialBroker,
  InMemoryCredentialVault,
  rawSecret,
  type BrokeredCredentialPolicy,
} from "@/lib/security/credential-broker";
import {
  DELEGATION_CONTRACT_SCHEMA_VERSION,
  stampDelegationContract,
  type MissionDelegation,
} from "@/lib/mission/delegation-contract";
import type { KernelObjectEnvelopeInput } from "@/lib/kernel/reality";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const NOW_MS = Date.parse("2026-10-01T12:00:00.000Z");
const PAST_ISO = "2026-09-01T00:00:00.000Z";
const FUTURE_ISO = "2027-01-01T00:00:00.000Z";

const CAPABILITY_DELIVER = "delivery.invoke";
const CAPABILITY_READ = "report.read";
const SECRET = "s3cr3t-material";

const CRED_A: BrokeredCredentialPolicy = {
  credentialRef: "cred:tenant-a:delivery-api",
  tenantRef: TENANT_A,
  resourceScope: "resource:delivery-api",
  requiredCapabilities: [CAPABILITY_DELIVER],
  riskClass: "medium",
  maxLeaseTtlMs: 30_000,
};

const CRED_B: BrokeredCredentialPolicy = {
  credentialRef: "cred:tenant-b:other-api",
  tenantRef: TENANT_B,
  resourceScope: "resource:other-api",
  requiredCapabilities: [CAPABILITY_DELIVER],
  riskClass: "medium",
  maxLeaseTtlMs: 30_000,
};

const LEASE_PURPOSE = "mission:deliver-report";

function registryWith(): CapabilityRegistry {
  const result = createCapabilityRegistry([
    {
      capabilityId: CAPABILITY_DELIVER,
      contract: "invoke the delivery API on behalf of the mission",
      riskClass: "medium",
      evidenceRequirements: ["evidence:delivery-invoke"],
    },
    {
      capabilityId: CAPABILITY_READ,
      contract: "read mission reports",
      riskClass: "low",
      evidenceRequirements: ["evidence:report-read"],
    },
  ]);
  if (!result.ok) throw new Error(`fixture registry rejected: ${result.errors.join("; ")}`);
  return result.registry;
}

function brokerWith(): { broker: CredentialBroker; vault: InMemoryCredentialVault } {
  const vault = new InMemoryCredentialVault({ [CRED_A.credentialRef]: rawSecret(SECRET) });
  const broker = new CredentialBroker({
    maxLeaseTtlMs: 60_000,
    authorizedRevokers: ["identity:security-guardian"],
    vault,
  });
  expect(broker.registerCredentialPolicy(CRED_A).ok).toBe(true);
  expect(broker.registerCredentialPolicy(CRED_B).ok).toBe(true);
  return { broker, vault };
}

function worker(
  overrides?: Partial<{
    id: string;
    tenantScope: string;
    identityRef: string;
    capabilityIds: readonly string[];
    maxRiskClass: "low" | "medium" | "high" | "critical";
    lifecycle: WorkerDefinition["lifecycle"];
  }>,
): WorkerDefinition {
  const validated = defineWorkerDefinition({
    id: overrides?.id ?? "worker-1",
    tenantScope: overrides?.tenantScope ?? TENANT_A,
    identityRef: overrides?.identityRef ?? "identity:worker-1",
    classification: "ai",
    capabilities: (overrides?.capabilityIds ?? [CAPABILITY_DELIVER, CAPABILITY_READ]).map(
      (capabilityId) => ({ capabilityId, description: `declares ${capabilityId}` }),
    ),
    authorityBounds: {
      maxRiskClass: overrides?.maxRiskClass ?? "high",
      resourceScopes: ["resource:delivery-api", "resource:other-api"],
    },
    lifecycle: overrides?.lifecycle ?? "active",
  });
  if (!validated.ok) throw new Error(`fixture worker rejected: ${validated.errors.join("; ")}`);
  return validated.definition;
}

function envelopeInput(): KernelObjectEnvelopeInput {
  return {
    objectType: "mission_delegation",
    schemaVersion: "1.0",
    status: "active",
    createdBy: "chief",
    updatedBy: "chief",
    provenance: { source: "tool-runtime-suite", originTenantId: TENANT_A },
    policyContext: { ruling: "RULING-3" },
    traceId: "trace-tool-runtime-1",
    correlationId: "corr-tool-runtime-1",
    declaredOrigin: "suite-root",
  };
}

function delegation(
  overrides: Partial<{
    delegationId: string;
    delegateRef: string;
    grantedActions: readonly string[];
    expiresAt: string;
    lifecycle: MissionDelegation["lifecycle"];
  }> = {},
): MissionDelegation {
  const lifecycle = overrides.lifecycle ?? "active";
  const revoked = lifecycle === "revoked";
  return stampDelegationContract({
    delegationId: overrides.delegationId ?? "del-1",
    schemaVersion: DELEGATION_CONTRACT_SCHEMA_VERSION,
    tenantId: TENANT_A,
    missionId: "mission-1",
    delegatorRef: "chief",
    delegateRef: overrides.delegateRef ?? "identity:worker-1",
    grantedActions: overrides.grantedActions ?? ["delivery.send"],
    grantedRoles: ["CONTRIBUTOR"],
    delegatorActions: ["delivery.send", "report.write"],
    delegatorRoles: ["CONTRIBUTOR", "OPERATOR"],
    taskRefs: null,
    notBefore: null,
    expiresAt: overrides.expiresAt ?? FUTURE_ISO,
    lifecycle,
    revokedAt: revoked ? PAST_ISO : null,
    revokedBy: revoked ? "chief" : null,
    revocationReason: revoked ? "authority withdrawn" : null,
    idempotencyKey: "idem-tool-runtime-1",
    provenance: {
      grantedBy: "chief",
      grantedAt: PAST_ISO,
      authorityRef: "tool-runtime-suite grant",
      sourceRef: null,
      generatedByAi: false,
      verified: true,
    },
    envelope: envelopeInput(),
  });
}

/** Executor that resolves the lease through the broker INSIDE its boundary. */
function brokeredExecutor(
  broker: CredentialBroker,
  options: Partial<{ resolveAtMs: number; rotateMidFlight: boolean }> = {},
): { executor: ToolExecutor; state: { executorCalls: number; lastHandleLeaseId: string | null } } {
  const state = { executorCalls: 0, lastHandleLeaseId: null as string | null };
  const executor: ToolExecutor = (ctx) => {
    state.executorCalls += 1;
    const handle = ctx.leaseHandles.get(CRED_A.credentialRef);
    if (handle === undefined) {
      return { ok: false, error: "no lease handle presented", leaseFailureReason: null };
    }
    state.lastHandleLeaseId = handle.leaseId;
    const resolveAtMs = options.resolveAtMs ?? NOW_MS + 10;
    if (options.rotateMidFlight === true) {
      const rotated = broker.rotateCredential({
        credentialRef: CRED_A.credentialRef,
        nextSecret: rawSecret("rotated-secret-material"),
        nowMs: NOW_MS + 5,
      });
      if (!rotated.ok) {
        return { ok: false, error: rotated.reason, leaseFailureReason: rotated.reason };
      }
    }
    const resolved = broker.resolveLease({
      handle,
      identityRef: ctx.workerIdentityRef,
      purpose: LEASE_PURPOSE,
      nowMs: resolveAtMs,
    });
    if (!resolved.ok) {
      return { ok: false, error: `lease resolve failed: ${resolved.reason}`, leaseFailureReason: resolved.reason };
    }
    return { ok: true, summary: `delivered via lease ${handle.leaseId}`, evidenceRef: `evidence:${ctx.toolId}` };
  };
  return { executor, state };
}

interface RuntimeHarness {
  runtime: ToolRuntime;
  broker: CredentialBroker;
  vault: InMemoryCredentialVault;
  audit: InMemoryToolInvocationAuditSink;
}

function runtimeWith(): RuntimeHarness {
  const { broker, vault } = brokerWith();
  const audit = new InMemoryToolInvocationAuditSink();
  const runtime = new ToolRuntime({
    registry: registryWith(),
    broker,
    auditSink: audit,
    secretExposureProbe: (serialized: string) => vault.exposesSecret(serialized),
  });
  return { runtime, broker, vault, audit };
}

const BASE_TOOL: GovernedToolDeclaration = {
  toolId: "delivery.send",
  contract: "send the delivery payload through the brokered delivery API",
  requiredCapabilityIds: [CAPABILITY_DELIVER],
  riskClass: "medium",
  executor: () => ({ ok: true, summary: "delivery sent", evidenceRef: "evidence:delivery.send" }),
};

function paramsWithSecret(): Record<string, unknown> {
  return { target: "dock-7", apiKey: SECRET };
}

function invocationRecords(
  events: readonly ToolRuntimeAuditEvent[],
): readonly ToolInvocationRecord[] {
  return events
    .filter((event): event is Extract<ToolRuntimeAuditEvent, { kind: "TOOL_INVOCATION" }> => event.kind === "TOOL_INVOCATION")
    .map((event) => event.record);
}

/* ─────────────────────────────────────────────────────────────
 * 1. Capability-gated execution
 * ────────────────────────────────────────────────────────────*/

describe("capability gate (J-008 a)", () => {
  it("executes when the worker declares the required capability", () => {
    const { runtime } = runtimeWith();
    expect(runtime.registerTool(BASE_TOOL, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: { target: "dock-7" },
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.outcome).toBe("executed");
  });

  it("rejects with a typed reason when the capability is not declared (executor never runs)", () => {
    const { runtime } = runtimeWith();
    let executed = 0;
    expect(
      runtime.registerTool(
        { ...BASE_TOOL, executor: () => { executed += 1; return { ok: true, summary: "sent", evidenceRef: null }; } },
        NOW_MS,
      ).ok,
    ).toBe(true);
    const result = runtime.invoke({
      worker: worker({ capabilityIds: [CAPABILITY_READ] }),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("capability_not_declared");
      expect(result.rejection.detail).toContain(CAPABILITY_DELIVER);
      expect(result.record.outcome).toBe("rejected");
      expect(result.record.reasonCode).toBe("capability_not_declared");
    }
    expect(executed).toBe(0);
  });

  it("evaluates the capability set FRESH per invocation — no stale grant survives revocation", () => {
    const { runtime } = runtimeWith();
    expect(runtime.registerTool(BASE_TOOL, NOW_MS).ok).toBe(true);
    const first = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(first.ok).toBe(true);
    // The same worker, re-presented WITHOUT the capability (declaration
    // revoked between invocations), is denied on the very next invocation.
    const second = runtime.invoke({
      worker: worker({ capabilityIds: [CAPABILITY_READ] }),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS + 1,
    });
    expect(second.ok).toBe(false);
    if (!second.ok && second.outcome === "rejected") {
      expect(second.rejection.code).toBe("capability_not_declared");
    }
  });

  it("denies capability risk above the worker authority ceiling (never clamped)", () => {
    const { runtime } = runtimeWith();
    expect(runtime.registerTool(BASE_TOOL, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker({ maxRiskClass: "low" }),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("capability_risk_escalation_denied");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Lease mediation — zero raw-secret exposure
 * ────────────────────────────────────────────────────────────*/

describe("lease mediation (J-008 b, J-007)", () => {
  const SECRET_TOOL: GovernedToolDeclaration = {
    ...BASE_TOOL,
    credentialRequirements: [
      { credentialRef: CRED_A.credentialRef, purpose: LEASE_PURPOSE, ttlMs: 10_000, maxUses: 3 },
    ],
    sensitiveParamKeys: ["sessionToken"],
  };

  it("acquires the lease through the broker and passes HANDLES only (broker-mediated flow)", () => {
    const { runtime, broker, vault } = runtimeWith();
    const { executor } = brokeredExecutor(broker);
    expect(
      runtime.registerTool({ ...SECRET_TOOL, executor }, NOW_MS).ok,
    ).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: { target: "dock-7", sessionToken: "opaque-user-token" },
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.leaseHandleRefs).toHaveLength(1);
      expect(result.record.leaseHandleRefs[0]).toContain(CRED_A.credentialRef);
    }
    // The use flowed through the broker (LEASE_USED audited by the broker).
    const brokerKinds = broker.auditLog().map((event) => event.kind);
    expect(brokerKinds).toContain("LEASE_GRANTED");
    expect(brokerKinds).toContain("LEASE_USED");
    // Non-observability: no record or audit event carries secret material.
    expect(vault.exposesSecret(JSON.stringify(runtime.auditLog()))).toBe(false);
  });

  it("rejects params carrying raw secret material before anything executes or records", () => {
    const { runtime, broker } = runtimeWith();
    const { executor } = brokeredExecutor(broker);
    expect(runtime.registerTool({ ...SECRET_TOOL, executor }, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: paramsWithSecret(),
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("param_secret_material_detected");
    }
    expect(result.record.redactedParams).toEqual({});
    // No lease was acquired and the executor never ran.
    expect(broker.auditLog().some((event) => event.kind === "LEASE_GRANTED")).toBe(false);
  });

  it("redacts declared sensitive param keys in the invocation record", () => {
    const { runtime, broker } = runtimeWith();
    const { executor } = brokeredExecutor(broker);
    expect(runtime.registerTool({ ...SECRET_TOOL, executor }, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: { target: "dock-7", sessionToken: "opaque-user-token" },
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(true);
    expect(result.record.redactedParams).toEqual({
      target: "dock-7",
      sessionToken: TOOL_PARAM_REDACTED,
    });
    // Even with the probe disengaged, declared sensitive keys never record.
    const { broker: probelessBroker } = brokerWith();
    const probelessRuntime = new ToolRuntime({
      registry: registryWith(),
      broker: probelessBroker,
    });
    expect(
      probelessRuntime.registerTool(
        { ...SECRET_TOOL, executor: () => ({ ok: true, summary: "sent", evidenceRef: null }) },
        NOW_MS,
      ).ok,
    ).toBe(true);
    const probeless = probelessRuntime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: { sessionToken: "opaque-user-token" },
      nowMs: NOW_MS,
    });
    expect(probeless.ok).toBe(true);
    if (probeless.ok) expect(probeless.record.redactedParams.sessionToken).toBe(TOOL_PARAM_REDACTED);
  });

  it("denies the lease when the broker denies it (typed rejection, audited)", () => {
    // A broker whose policy is registered but whose vault entry is missing:
    // the credential gate denies (fail closed) even for a fully authorized
    // worker — and the runtime surfaces it as a typed rejection.
    const emptyVault = new InMemoryCredentialVault();
    const entrylessBroker = new CredentialBroker({
      maxLeaseTtlMs: 60_000,
      authorizedRevokers: ["identity:security-guardian"],
      vault: emptyVault,
    });
    expect(entrylessBroker.registerCredentialPolicy(CRED_A).ok).toBe(true);
    const entrylessRuntime = new ToolRuntime({
      registry: registryWith(),
      broker: entrylessBroker,
      secretExposureProbe: (serialized: string) => emptyVault.exposesSecret(serialized),
    });
    expect(
      entrylessRuntime.registerTool(
        {
          ...BASE_TOOL,
          credentialRequirements: [
            { credentialRef: CRED_A.credentialRef, purpose: LEASE_PURPOSE, ttlMs: 10_000, maxUses: 3 },
          ],
        },
        NOW_MS,
      ).ok,
    ).toBe(true);
    const result = entrylessRuntime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("credential_lease_denied");
      expect(result.rejection.detail).toContain("vault_entry_missing");
    }
    expect(result.record.leaseHandleRefs).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Delegation bounding
 * ────────────────────────────────────────────────────────────*/

describe("delegation bounding (J-008 c)", () => {
  const DELEGATED_TOOL: GovernedToolDeclaration = {
    ...BASE_TOOL,
    credentialRequirements: [
      { credentialRef: CRED_A.credentialRef, purpose: LEASE_PURPOSE, ttlMs: 10_000, maxUses: 3 },
    ],
  };

  it("executes under a valid delegation and records the delegation ref", () => {
    const { runtime, broker } = runtimeWith();
    const { executor } = brokeredExecutor(broker);
    expect(runtime.registerTool({ ...DELEGATED_TOOL, executor }, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
      delegation: { contract: delegation(), missionId: "mission-1", taskRef: null },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.delegationRef).toBe("del-1");
  });

  it("rejects an action the delegation does not grant", () => {
    const { runtime } = runtimeWith();
    expect(runtime.registerTool(BASE_TOOL, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
      delegation: { contract: delegation({ grantedActions: ["report.write"] }), missionId: "mission-1", taskRef: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("delegation_action_denied");
      expect(result.rejection.detail).toBe("action_not_granted");
    }
  });

  it("rejects a delegation that is expired AS-OF the invocation instant", () => {
    const { runtime } = runtimeWith();
    expect(runtime.registerTool(BASE_TOOL, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
      delegation: {
        contract: delegation({ expiresAt: PAST_ISO }),
        missionId: "mission-1",
        taskRef: null,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("delegation_denied");
      expect(result.rejection.detail).toContain("expired");
    }
  });

  it("rejects a revoked delegation (an 'active' stamp cannot resurrect authority)", () => {
    const { runtime } = runtimeWith();
    expect(runtime.registerTool(BASE_TOOL, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
      delegation: {
        contract: delegation({ lifecycle: "revoked" }),
        missionId: "mission-1",
        taskRef: null,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("delegation_denied");
      expect(result.rejection.detail).toContain("revoked");
    }
  });

  it("rejects a delegation naming a different delegate (acting-on-behalf-of binding)", () => {
    const { runtime } = runtimeWith();
    expect(runtime.registerTool(BASE_TOOL, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
      delegation: {
        contract: delegation({ delegateRef: "identity:worker-2" }),
        missionId: "mission-1",
        taskRef: null,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("delegation_action_denied");
      expect(result.rejection.detail).toBe("delegate_mismatch");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Sandbox isolation: unregistered tools, risk bounding, guards
 * ────────────────────────────────────────────────────────────*/

describe("sandbox isolation (J-008 e)", () => {
  it("rejects unregistered tools (unexecutable, fail closed)", () => {
    const { runtime } = runtimeWith();
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "never.registered",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("tool_not_registered");
      expect(result.record.requiredCapabilityIds).toEqual([]);
    }
    expect(invocationRecords(runtime.auditLog())).toHaveLength(1);
  });

  it("bounds which workers may invoke a tool by its risk class", () => {
    const { runtime } = runtimeWith();
    expect(
      runtime.registerTool({ ...BASE_TOOL, riskClass: "critical" }, NOW_MS).ok,
    ).toBe(true);
    const result = runtime.invoke({
      worker: worker({ maxRiskClass: "medium" }),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("tool_risk_class_bounding_denied");
    }
  });

  it("refuses to register a tool whose required capability outweighs its own risk class", () => {
    const { runtime } = runtimeWith();
    const registration = runtime.registerTool({ ...BASE_TOOL, riskClass: "low" }, NOW_MS);
    expect(registration.ok).toBe(false);
    if (!registration.ok) {
      expect(registration.errors.join("; ")).toContain("exceeds the tool risk class");
    }
    // The refused tool is unexecutable.
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("tool_not_registered");
    }
  });

  it("enforces the per-tool rate guard (typed rejection, window recovers)", () => {
    const { runtime } = runtimeWith();
    expect(
      runtime.registerTool(
        { ...BASE_TOOL, rateGuard: { windowMs: 1_000, maxInvocationsPerWindow: 2 } },
        NOW_MS,
      ).ok,
    ).toBe(true);
    const invokeAt = (atMs: number) =>
      runtime.invoke({ worker: worker(), tenantRef: TENANT_A, toolId: "delivery.send", params: {}, nowMs: atMs });
    expect(invokeAt(NOW_MS).ok).toBe(true);
    expect(invokeAt(NOW_MS + 100).ok).toBe(true);
    const third = invokeAt(NOW_MS + 200);
    expect(third.ok).toBe(false);
    if (!third.ok && third.outcome === "rejected") {
      expect(third.rejection.code).toBe("tool_rate_guard_exceeded");
    }
    // Rejections do not consume the window; after it slides, execution resumes.
    expect(invokeAt(NOW_MS + 1_500).ok).toBe(true);
  });

  it("enforces the per-tool budget guard for the tool's lifetime", () => {
    const { runtime } = runtimeWith();
    expect(
      runtime.registerTool({ ...BASE_TOOL, budgetGuard: { maxTotalInvocations: 2 } }, NOW_MS).ok,
    ).toBe(true);
    const invokeAt = (atMs: number) =>
      runtime.invoke({ worker: worker(), tenantRef: TENANT_A, toolId: "delivery.send", params: {}, nowMs: atMs });
    expect(invokeAt(NOW_MS).ok).toBe(true);
    expect(invokeAt(NOW_MS + 60_000).ok).toBe(true);
    const third = invokeAt(NOW_MS + 120_000);
    expect(third.ok).toBe(false);
    if (!third.ok && third.outcome === "rejected") {
      expect(third.rejection.code).toBe("tool_budget_guard_exceeded");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. Rotation invalidation
 * ────────────────────────────────────────────────────────────*/

describe("rotation invalidation (J-008 f)", () => {
  const SECRET_TOOL: GovernedToolDeclaration = {
    ...BASE_TOOL,
    credentialRequirements: [
      { credentialRef: CRED_A.credentialRef, purpose: LEASE_PURPOSE, ttlMs: 10_000, maxUses: 3 },
    ],
  };

  it("surfaces a lease invalidated by rotation and never retries the stale handle", () => {
    const { runtime, broker } = runtimeWith();
    const mediating = brokeredExecutor(broker, { rotateMidFlight: true });
    expect(runtime.registerTool({ ...SECRET_TOOL, executor: mediating.executor }, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "failed") {
      expect(result.failureCode).toBe("lease_invalidated");
      expect(result.failureDetail).toContain("invalidated_by_rotation");
      expect(result.record.leaseInvalidated).toBe(true);
      expect(result.record.leaseHandleRefs).toHaveLength(1);
    }
    // Exactly ONE execution attempt — the stale handle is never replayed.
    expect(mediating.state.executorCalls).toBe(1);
  });

  it("surfaces a lease invalidated by operator revocation", () => {
    const { runtime, broker } = runtimeWith();
    const revoking = brokeredExecutor(broker);
    const base = revoking.executor;
    const executor: ToolExecutor = (ctx) => {
      const handle = ctx.leaseHandles.get(CRED_A.credentialRef);
      if (handle === undefined) return { ok: false, error: "no handle", leaseFailureReason: null };
      const revoked = broker.revokeLease({ handle, reason: "operator kill", nowMs: NOW_MS + 5 });
      if (!revoked.ok) return { ok: false, error: revoked.reason, leaseFailureReason: null };
      return base(ctx);
    };
    expect(runtime.registerTool({ ...SECRET_TOOL, executor }, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "failed") {
      expect(result.failureCode).toBe("lease_invalidated");
      expect(result.record.leaseInvalidated).toBe(true);
    }
  });

  it("treats executor failure without a lease failure as a plain tool failure", () => {
    const { runtime } = runtimeWith();
    expect(
      runtime.registerTool(
        {
          ...BASE_TOOL,
          executor: () => ({ ok: false, error: "upstream 500", leaseFailureReason: null }),
        },
        NOW_MS,
      ).ok,
    ).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "failed") {
      expect(result.failureCode).toBe("tool_execution_failed");
      expect(result.record.leaseInvalidated).toBe(false);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 6. Invocation record completeness
 * ────────────────────────────────────────────────────────────*/

describe("invocation records (J-008 d)", () => {
  it("carries worker, tool, capability refs, lease refs, delegation ref, outcome and redacted params", () => {
    const { runtime, broker } = runtimeWith();
    const { executor } = brokeredExecutor(broker);
    const tool: GovernedToolDeclaration = {
      ...BASE_TOOL,
      requiredCapabilityIds: [CAPABILITY_DELIVER, CAPABILITY_READ],
      credentialRequirements: [
        { credentialRef: CRED_A.credentialRef, purpose: LEASE_PURPOSE, ttlMs: 10_000, maxUses: 3 },
      ],
      sensitiveParamKeys: ["sessionToken"],
    };
    expect(runtime.registerTool({ ...tool, executor }, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: { target: "dock-7", sessionToken: "opaque-user-token" },
      nowMs: NOW_MS,
      delegation: { contract: delegation(), missionId: "mission-1", taskRef: null },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const record = result.record;
    expect(record.recordId).toMatch(/^invocation:delivery\.send:\d+$/);
    expect(record.atMs).toBe(NOW_MS);
    expect(record.workerId).toBe("worker-1");
    expect(record.workerIdentityRef).toBe("identity:worker-1");
    expect(record.tenantRef).toBe(TENANT_A);
    expect(record.toolId).toBe("delivery.send");
    expect(record.requiredCapabilityIds).toEqual([CAPABILITY_DELIVER, CAPABILITY_READ]);
    expect(record.leaseHandleRefs).toHaveLength(1);
    expect(record.delegationRef).toBe("del-1");
    expect(record.outcome).toBe("executed");
    expect(record.reasonCode).toBeNull();
    expect(record.reasonDetail).toBeNull();
    expect(record.leaseInvalidated).toBe(false);
    expect(record.redactedParams).toEqual({ target: "dock-7", sessionToken: TOOL_PARAM_REDACTED });
    expect(record.resultSummary).toContain("delivered via lease");
    expect(record.evidenceRef).toBe("evidence:delivery.send");
    // Every invocation — executed, rejected, failed — is audited.
    expect(invocationRecords(runtime.auditLog()).some((r) => r.recordId === record.recordId)).toBe(true);
  });

  it("records rejected invocations with the named typed reason", () => {
    const { runtime } = runtimeWith();
    expect(runtime.registerTool(BASE_TOOL, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker({ lifecycle: "suspended" }),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    const record = result.record;
    expect(record.outcome).toBe("rejected");
    expect(record.reasonCode).toBe("worker_lifecycle_unusable");
    expect(record.reasonDetail).toContain("suspended");
    expect(record.resultSummary).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────
 * 7. Cross-tenant isolation
 * ────────────────────────────────────────────────────────────*/

describe("cross-tenant isolation (multi-tenancy law)", () => {
  it("rejects an invocation whose tenant does not match the worker scope", () => {
    const { runtime } = runtimeWith();
    expect(runtime.registerTool(BASE_TOOL, NOW_MS).ok).toBe(true);
    const result = runtime.invoke({
      worker: worker(),
      tenantRef: TENANT_B,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("cross_tenant_invocation_denied");
    }
    expect(result.record.leaseHandleRefs).toEqual([]);
  });

  it("denies a lease on a credential owned by another tenant (broker-enforced)", () => {
    // Both credentials provisioned in the vault, so ONLY the tenant boundary
    // can be the failing axis.
    const seeded = new InMemoryCredentialVault({
      [CRED_A.credentialRef]: rawSecret(SECRET),
      [CRED_B.credentialRef]: rawSecret("tenant-b-material"),
    });
    const tenantBroker = new CredentialBroker({
      maxLeaseTtlMs: 60_000,
      authorizedRevokers: ["identity:security-guardian"],
      vault: seeded,
    });
    expect(tenantBroker.registerCredentialPolicy(CRED_A).ok).toBe(true);
    expect(tenantBroker.registerCredentialPolicy(CRED_B).ok).toBe(true);
    const isolated = new ToolRuntime({
      registry: registryWith(),
      broker: tenantBroker,
      secretExposureProbe: (serialized: string) => seeded.exposesSecret(serialized),
    });
    const credTool: GovernedToolDeclaration = {
      ...BASE_TOOL,
      credentialRequirements: [
        { credentialRef: CRED_B.credentialRef, purpose: LEASE_PURPOSE, ttlMs: 10_000, maxUses: 3 },
      ],
    };
    expect(isolated.registerTool(credTool, NOW_MS).ok).toBe(true);
    const result = isolated.invoke({
      worker: worker(),
      tenantRef: TENANT_A,
      toolId: "delivery.send",
      params: {},
      nowMs: NOW_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.outcome === "rejected") {
      expect(result.rejection.code).toBe("credential_lease_denied");
      expect(result.rejection.detail).toContain("cross_tenant_credential_denied");
    }
    expect(result.record.leaseHandleRefs).toEqual([]);
    // And no secret material reached the record even in failure paths.
    expect(seeded.exposesSecret(JSON.stringify(isolated.auditLog()))).toBe(false);
  });
});