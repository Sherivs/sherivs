/**
 * CoreGrid — governed tool runtime & sandbox (J-008 / V1CAP-056, MISSION-R-62,
 * wave 3). THE ONLY way workers execute tools.
 *
 * Law of this module (fail closed on every axis):
 * - SANDBOX GATE: a tool invocation enters the gate and is either executed,
 *   rejected with a named typed reason, or failed with a surfaced reason.
 *   Every invocation — executed, rejected or failed — produces an invocation
 *   record (worker, tool, capability refs, lease handle refs, delegation ref,
 *   outcome, REDACTED params). Nothing executes outside the gate.
 * - CAPABILITY GATE (E-035): the tool's required capabilities must be
 *   REGISTERED in the capability registry and DECLARED by the worker,
 *   evaluated FRESH at the invocation instant from the definitions presented
 *   — no cached or stale grant survives a revocation (a worker whose
 *   declaration no longer carries the capability is denied on the very next
 *   invocation). Capability risk above the worker's authority ceiling is
 *   denied, never clamped.
 * - LEASE MEDIATION (J-007): the runtime NEVER sees raw secret material. A
 *   secret-dependent tool declares its credential requirements; the runtime
 *   acquires a `CredentialLeaseHandle` per requirement through the credential
 *   broker and passes HANDLES (never secrets) to the tool's broker-mediated
 *   executor. Invocation records carry lease handle REFERENCES only, and
 *   params are redacted (declared sensitive keys) plus probed against the
 *   vault's non-observability guard — params containing live secret material
 *   are rejected, never executed, never recorded.
 * - DELEGATION BOUNDING (E-045 / AGENTS §21): an invocation running under a
 *   delegation must find the tool's action in the contract's authorized
 *   action set, with the contract valid AS-OF the invocation instant
 *   (`evaluateDelegationAsOf`) and the action bounded
 *   (`authorizeDelegatedAction`). Expired, revoked, suspended, not-yet-
 *   effective and out-of-scope delegations authorize nothing.
 * - SANDBOX ISOLATION: unregistered tools are unexecutable (fail closed); a
 *   tool's risk class bounds which workers may invoke it; rate and budget
 *   guards are declarable per tool and their exhaustion is a typed, audited
 *   rejection — never a silent slowdown.
 * - ROTATION INVALIDATION: when a lease is rotated or revoked, in-flight
 *   handles fail through the broker's own re-verification. The runtime
 *   SURFACES the failure on the invocation record and NEVER retries with a
 *   stale handle (one execution attempt per invocation, structurally).
 *
 * Composition: worker definitions from `worker-definition.ts` (persistent
 * governed substrate), the capability vocabulary from
 * `capability-registry.ts` (registry integrity law), lease handles from
 * `security/credential-broker.ts` (the ONLY credential path), and delegation
 * contracts from `mission/delegation-contract.ts`. This module owns none of
 * those vocabularies — it gates against them.
 *
 * Boundary: pure data + pure functions over injected dependencies. No
 * persistence, no I/O, no vendor. Time is supplied by the caller; nothing
 * runs implicitly. All checks FAIL CLOSED.
 */

import type { AgentRiskClassification } from "../agent-core";
import {
  authorizeDelegatedAction,
  evaluateDelegationAsOf,
  type MissionDelegation,
} from "../mission/delegation-contract";
import {
  CredentialBroker,
  type CredentialLeaseHandle,
  type CredentialSubjectAuthority,
} from "../security/credential-broker";
import type { CapabilityRegistry } from "./capability-registry";
import { riskClassRank, type WorkerDefinition } from "./worker-definition";

/* ─────────────────────────────────────────────────────────────
 * Rejection / failure vocabulary (typed, every denial names its axis)
 * ────────────────────────────────────────────────────────────*/

export type ToolInvocationRejectionCode =
  | "invalid_invocation_input"
  | "tool_not_registered"
  | "cross_tenant_invocation_denied"
  | "worker_lifecycle_unusable"
  | "capability_not_registered"
  | "capability_not_declared"
  | "capability_risk_escalation_denied"
  | "tool_risk_class_bounding_denied"
  | "delegation_denied"
  | "delegation_action_denied"
  | "tool_rate_guard_exceeded"
  | "tool_budget_guard_exceeded"
  | "param_secret_material_detected"
  | "credential_lease_denied";

export type ToolExecutionFailureCode =
  "lease_invalidated" | "tool_execution_failed" | "result_secret_material_detected";

export interface ToolInvocationRejection {
  readonly code: ToolInvocationRejectionCode;
  /** Named axis detail (missing capability id, deny reason, credential ref…). */
  readonly detail: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Tool declarations (the registered sandbox surface)
 * ────────────────────────────────────────────────────────────*/

/** One secret-dependent credential the tool needs, per invocation. */
export interface ToolCredentialRequirement {
  readonly credentialRef: string;
  /** Declared lease purpose; every use must present exactly this purpose. */
  readonly purpose: string;
  readonly ttlMs: number;
  /** Usage budget the runtime requests on the lease (broker enforces). */
  readonly maxUses: number;
}

export interface ToolRateGuard {
  readonly windowMs: number;
  readonly maxInvocationsPerWindow: number;
}

export interface ToolBudgetGuard {
  readonly maxTotalInvocations: number;
}

/** The ONLY execution boundary a tool gets: handles in, summary out. */
export interface ToolExecutionContext {
  readonly workerIdentityRef: string;
  readonly tenantRef: string;
  readonly toolId: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** credentialRef -> live lease handle. Handles only — never secrets. */
  readonly leaseHandles: ReadonlyMap<string, CredentialLeaseHandle>;
  readonly delegationRef: string | null;
}

/**
 * The executor output. `leaseFailureReason` is the dedicated channel through
 * which broker-mediated lease failures (rotation, revocation, expiry,
 * exhaustion) surface to the runtime — the runtime reports them as lease
 * invalidation and never retries.
 */
export type ToolExecutionOutput =
  | { ok: true; summary: string; evidenceRef: string | null }
  | { ok: false; error: string; leaseFailureReason: string | null };

export type ToolExecutor = (ctx: ToolExecutionContext) => ToolExecutionOutput;

export interface GovernedToolDeclaration {
  readonly toolId: string;
  readonly contract: string;
  /** Capability ids the invoking worker must hold (registry-checked, fresh). */
  readonly requiredCapabilityIds: readonly string[];
  /** Risk class of invoking the tool; bounds which workers may call it. */
  readonly riskClass: AgentRiskClassification;
  /** The broker-mediated executor. Receives lease handles, never secrets. */
  readonly executor: ToolExecutor;
  /** Secret-dependent credential requirements; empty = no lease mediation. */
  readonly credentialRequirements?: readonly ToolCredentialRequirement[];
  /** Param keys redacted from invocation records (defence in depth). */
  readonly sensitiveParamKeys?: readonly string[];
  readonly rateGuard?: ToolRateGuard | null;
  readonly budgetGuard?: ToolBudgetGuard | null;
}

export type ToolRegistrationResult =
  { ok: true; toolId: string } | { ok: false; errors: readonly string[] };

/* ─────────────────────────────────────────────────────────────
 * Invocation records (append-only, redacted by construction)
 * ────────────────────────────────────────────────────────────*/

export const TOOL_PARAM_REDACTED = "[REDACTED]";

export type ToolInvocationOutcome = "executed" | "rejected" | "failed";

export interface ToolInvocationRecord {
  readonly recordId: string;
  readonly atMs: number;
  readonly workerId: string;
  readonly workerIdentityRef: string;
  readonly tenantRef: string;
  readonly toolId: string;
  readonly requiredCapabilityIds: readonly string[];
  /** Lease handle REFERENCES (leaseIds) — never handles, never secrets. */
  readonly leaseHandleRefs: readonly string[];
  readonly delegationRef: string | null;
  readonly outcome: ToolInvocationOutcome;
  readonly reasonCode: ToolInvocationRejectionCode | ToolExecutionFailureCode | null;
  readonly reasonDetail: string | null;
  /** True when the failure came from lease rotation/revocation invalidation. */
  readonly leaseInvalidated: boolean;
  readonly redactedParams: Readonly<Record<string, unknown>>;
  readonly resultSummary: string | null;
  readonly evidenceRef: string | null;
}

export type ToolRuntimeAuditEvent =
  | { kind: "TOOL_REGISTERED"; atMs: number; toolId: string; riskClass: AgentRiskClassification }
  | { kind: "TOOL_INVOCATION"; atMs: number; record: ToolInvocationRecord };

export interface ToolInvocationAuditSink {
  append(event: ToolRuntimeAuditEvent): void;
}

/** In-memory append-only audit sink (V1 reference; DB-backed later). */
export class InMemoryToolInvocationAuditSink implements ToolInvocationAuditSink {
  private readonly events: ToolRuntimeAuditEvent[] = [];

  append(event: ToolRuntimeAuditEvent): void {
    this.events.push(event);
  }

  /** Read-only view; no mutation or deletion path exists. */
  list(): readonly ToolRuntimeAuditEvent[] {
    return this.events;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Runtime configuration
 * ────────────────────────────────────────────────────────────*/

export interface ToolRuntimeConfig {
  /** The capability registry the capability gate resolves against. */
  readonly registry: CapabilityRegistry;
  /** The credential broker — the ONLY lease source for secret-dependent tools. */
  readonly broker: CredentialBroker;
  /** Defaults to an in-memory sink; DB-backed sink injectable. */
  readonly auditSink?: ToolInvocationAuditSink;
  /**
   * Non-observability probe wired from the credential vault
   * (`vault.exposesSecret`): answers whether a serialized text contains live
   * secret material. When present, params and executor summaries are probed
   * before anything is executed or recorded — fail closed.
   */
  readonly secretExposureProbe?: ((serialized: string) => boolean) | null;
}

/* ─────────────────────────────────────────────────────────────
 * Invocation input / result
 * ────────────────────────────────────────────────────────────*/

export interface ToolDelegationBinding {
  /** The delegation contract governing this invocation. */
  readonly contract: MissionDelegation;
  readonly missionId: string;
  /** null = mission-level action; otherwise the task it is performed under. */
  readonly taskRef: string | null;
}

export interface ToolInvocationInput {
  /** The persistent worker definition, presented FRESH at the invocation. */
  readonly worker: WorkerDefinition;
  /** Tenant the call is made under (mission/claim tenant); must match. */
  readonly tenantRef: string;
  readonly toolId: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly nowMs: number;
  readonly delegation?: ToolDelegationBinding | null;
}

export type ToolInvocationResult =
  | {
      ok: true;
      outcome: "executed";
      summary: string;
      evidenceRef: string | null;
      record: ToolInvocationRecord;
    }
  | {
      ok: false;
      outcome: "rejected";
      rejection: ToolInvocationRejection;
      record: ToolInvocationRecord;
    }
  | {
      ok: false;
      outcome: "failed";
      failureCode: ToolExecutionFailureCode;
      failureDetail: string;
      record: ToolInvocationRecord;
    };

/* ─────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────*/

const AGENT_RISK_CLASSIFICATIONS = ["low", "medium", "high", "critical"] as const;

const AGENT_RISK_CLASSIFICATION_SET: ReadonlySet<string> = new Set<string>(
  AGENT_RISK_CLASSIFICATIONS,
);

function isNonEmptyTrimmed(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= maxLength;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Worker lifecycle usability — the usable subset of the identity lifecycle. */
function workerLifecycleUsable(worker: WorkerDefinition): boolean {
  return worker.lifecycle === "active" || worker.lifecycle === "provisioned";
}

function declaredCapabilityIds(worker: WorkerDefinition): readonly string[] {
  return worker.capabilities.map((declaration) => declaration.capabilityId);
}

/** The broker authority view derived from the worker definition (never caller-forged). */
function subjectAuthorityFrom(worker: WorkerDefinition): CredentialSubjectAuthority {
  return {
    identityRef: worker.identityRef,
    tenantScope: worker.tenantScope,
    declaredCapabilities: declaredCapabilityIds(worker),
    resourceScopes: worker.authorityBounds.resourceScopes,
    maxRiskClass: worker.authorityBounds.maxRiskClass,
    isUsable: workerLifecycleUsable(worker),
  };
}

function redactParams(
  params: Readonly<Record<string, unknown>>,
  sensitiveKeys: readonly string[],
): Record<string, unknown> {
  const sensitive = new Set<string>(sensitiveKeys);
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    redacted[key] = sensitive.has(key) ? TOOL_PARAM_REDACTED : value;
  }
  return redacted;
}

/* ─────────────────────────────────────────────────────────────
 * The runtime
 * ────────────────────────────────────────────────────────────*/

interface RegisteredTool {
  declaration: GovernedToolDeclaration;
  sensitiveParamKeys: readonly string[];
}

export class ToolRuntime {
  private readonly config: ToolRuntimeConfig;
  private readonly audit: ToolInvocationAuditSink;
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly executedTimestampsByTool = new Map<string, number[]>();
  private readonly executedTotalByTool = new Map<string, number>();
  private invocationSequence = 0;

  constructor(config: ToolRuntimeConfig) {
    this.config = config;
    this.audit = config.auditSink ?? new InMemoryToolInvocationAuditSink();
  }

  /** Read-only audit access for operators/verifiers. */
  auditLog(): readonly ToolRuntimeAuditEvent[] {
    if (this.audit instanceof InMemoryToolInvocationAuditSink) {
      return this.audit.list();
    }
    throw new Error("tool_runtime_audit_sink_not_inspectable");
  }

  /**
   * Register a governed tool. Fails closed on: an invalid id/contract, an
   * unknown risk class, a required capability that is unregistered or whose
   * registered risk exceeds the tool's declared risk class (a tool cannot
   * understate the risk of what it needs), and malformed guards or
   * credential requirements. An invalid tool is never partially registered.
   */
  registerTool(declaration: GovernedToolDeclaration, nowMs: number): ToolRegistrationResult {
    const errors: string[] = [];
    if (!isNonEmptyTrimmed(declaration.toolId, 200)) {
      errors.push("toolId must be 1–200 characters");
    }
    if (!isNonEmptyTrimmed(declaration.contract, 500)) {
      errors.push("tool contract must be 1–500 characters");
    }
    if (!(AGENT_RISK_CLASSIFICATION_SET as ReadonlySet<string>).has(declaration.riskClass)) {
      errors.push("tool riskClass must be in the agent risk vocabulary");
    }
    if (typeof declaration.executor !== "function") {
      errors.push("tool executor must be a function");
    }
    if (!Array.isArray(declaration.requiredCapabilityIds)) {
      errors.push("requiredCapabilityIds must be an array of capability ids");
    } else {
      for (const capabilityId of declaration.requiredCapabilityIds) {
        if (!isNonEmptyTrimmed(capabilityId, 160)) {
          errors.push("required capability ids must be non-empty strings");
          continue;
        }
        const registered = this.config.registry.get(capabilityId.trim());
        if (registered === undefined) {
          errors.push(`required capability "${capabilityId.trim()}" is not registered`);
          continue;
        }
        if (riskClassRank(registered.riskClass) > riskClassRank(declaration.riskClass)) {
          errors.push(
            `required capability "${capabilityId.trim()}" risk "${registered.riskClass}" exceeds the tool risk class "${declaration.riskClass}"`,
          );
        }
      }
    }
    const credentialRequirements = declaration.credentialRequirements ?? [];
    if (!Array.isArray(credentialRequirements)) {
      errors.push("credentialRequirements must be an array when present");
    } else {
      credentialRequirements.forEach((requirement, index) => {
        if (!isNonEmptyTrimmed(requirement?.credentialRef, 200)) {
          errors.push(`credential requirement #${index} requires a credentialRef`);
        }
        if (!isNonEmptyTrimmed(requirement?.purpose, 300)) {
          errors.push(`credential requirement #${index} requires a purpose`);
        }
        if (!Number.isFinite(requirement?.ttlMs) || (requirement?.ttlMs ?? 0) <= 0) {
          errors.push(`credential requirement #${index} requires a positive ttlMs`);
        }
        if (!isPositiveInt(requirement?.maxUses)) {
          errors.push(`credential requirement #${index} requires a positive integer maxUses`);
        }
      });
    }
    const sensitiveParamKeys = declaration.sensitiveParamKeys ?? [];
    if (!Array.isArray(sensitiveParamKeys)) {
      errors.push("sensitiveParamKeys must be an array when present");
    } else if (sensitiveParamKeys.some((key) => !isNonEmptyTrimmed(key, 160))) {
      errors.push("sensitiveParamKeys entries must be non-empty strings");
    }
    if (
      declaration.rateGuard !== undefined &&
      declaration.rateGuard !== null &&
      (!Number.isFinite(declaration.rateGuard.windowMs) ||
        declaration.rateGuard.windowMs <= 0 ||
        !isPositiveInt(declaration.rateGuard.maxInvocationsPerWindow))
    ) {
      errors.push(
        "rateGuard requires a positive windowMs and a positive integer maxInvocationsPerWindow",
      );
    }
    if (
      declaration.budgetGuard !== undefined &&
      declaration.budgetGuard !== null &&
      !isPositiveInt(declaration.budgetGuard.maxTotalInvocations)
    ) {
      errors.push("budgetGuard requires a positive integer maxTotalInvocations");
    }
    if (errors.length > 0) return { ok: false, errors };

    const toolId = (declaration.toolId as string).trim();
    this.tools.set(toolId, {
      declaration: { ...declaration, toolId },
      sensitiveParamKeys: [...sensitiveParamKeys],
    });
    this.audit.append({
      kind: "TOOL_REGISTERED",
      atMs: nowMs,
      toolId,
      riskClass: declaration.riskClass,
    });
    return { ok: true, toolId };
  }

  /**
   * THE tool invocation path. Runs the sandbox gate in fail-closed order:
   * structural validity → param non-observability (probed before ANY record
   * exists) → registration → tenant → worker lifecycle → capability gate
   * (fresh) → risk-class bounding → delegation bounding (as-of the invocation
   * instant) → rate/budget guards → lease acquisition → single execution
   * attempt. Every path produces an audited invocation record with redacted
   * params.
   */
  invoke(input: ToolInvocationInput): ToolInvocationResult {
    this.invocationSequence += 1;
    const recordId = `invocation:${String(input.toolId)}:${this.invocationSequence}`;
    const recordBase = {
      recordId,
      atMs: input.nowMs,
      workerId: input.worker?.id ?? "",
      workerIdentityRef: input.worker?.identityRef ?? "",
      tenantRef: input.tenantRef,
      toolId: input.toolId,
      requiredCapabilityIds: [] as readonly string[],
      leaseHandleRefs: [] as readonly string[],
      delegationRef: input.delegation?.contract.delegationId ?? null,
      leaseInvalidated: false,
      redactedParams: {} as Readonly<Record<string, unknown>>,
      resultSummary: null as string | null,
      evidenceRef: null as string | null,
    };

    const rejected = (
      rejection: ToolInvocationRejection,
      base: typeof recordBase,
    ): ToolInvocationResult => {
      const record = this.emitRecord({
        ...base,
        outcome: "rejected",
        reasonCode: rejection.code,
        reasonDetail: rejection.detail,
      });
      return { ok: false, outcome: "rejected", rejection, record };
    };

    // 1. Structural validity (fail closed before anything else runs).
    if (
      !Number.isFinite(input.nowMs) ||
      !isNonEmptyTrimmed(input.tenantRef, 128) ||
      !isNonEmptyTrimmed(input.toolId, 200) ||
      input.worker === undefined ||
      input.worker === null ||
      typeof input.params !== "object" ||
      input.params === null
    ) {
      return rejected(
        {
          code: "invalid_invocation_input",
          detail: "worker, tenantRef, toolId, params and nowMs are required",
        },
        recordBase,
      );
    }

    // 2. Param non-observability — BEFORE any record is emitted and before
    //    anything resolves: params carrying live secret material are rejected
    //    (the runtime never sees raw secrets; workers present handles, not
    //    secrets) and nothing of them is recorded. Unserializable params fail
    //    closed for the same reason: they cannot be proven non-observational.
    const probe = this.config.secretExposureProbe ?? null;
    let rawParamsSerialized: string;
    try {
      rawParamsSerialized = JSON.stringify(input.params) ?? "";
    } catch {
      return rejected(
        { code: "invalid_invocation_input", detail: "params are not serializable" },
        recordBase,
      );
    }
    if (probe !== null && probe(rawParamsSerialized)) {
      return rejected(
        {
          code: "param_secret_material_detected",
          detail: "invocation params contain live secret material",
        },
        recordBase,
      );
    }

    const tool = this.tools.get(input.toolId.trim());
    // 3. Unregistered tools are unexecutable (sandbox isolation, fail closed).
    if (tool === undefined) {
      return rejected(
        { code: "tool_not_registered", detail: `"${input.toolId}" is not registered` },
        recordBase,
      );
    }

    const base: typeof recordBase = {
      ...recordBase,
      requiredCapabilityIds: [...tool.declaration.requiredCapabilityIds],
      redactedParams: redactParams(input.params, tool.sensitiveParamKeys),
    };
    const worker = input.worker;

    // 4. Tenant boundary: the invocation tenant must equal the worker's scope.
    if (input.tenantRef.trim() !== worker.tenantScope) {
      return rejected(
        {
          code: "cross_tenant_invocation_denied",
          detail: `invocation tenant "${input.tenantRef.trim()}" does not match worker tenant scope "${worker.tenantScope}"`,
        },
        base,
      );
    }

    // 5. Worker lifecycle (revocation propagation — fresh at invocation).
    if (!workerLifecycleUsable(worker)) {
      return rejected(
        {
          code: "worker_lifecycle_unusable",
          detail: `worker lifecycle "${worker.lifecycle}" is unusable`,
        },
        base,
      );
    }

    // 6. Capability gate — evaluated FRESH from the presented definition and
    //    the current registry (no stale grant survives a revocation).
    const declared = new Set<string>(declaredCapabilityIds(worker));
    const workerCeiling = riskClassRank(worker.authorityBounds.maxRiskClass);
    for (const capabilityId of tool.declaration.requiredCapabilityIds) {
      const registered = this.config.registry.get(capabilityId);
      if (registered === undefined) {
        return rejected(
          {
            code: "capability_not_registered",
            detail: `required capability "${capabilityId}" vanished from the registry`,
          },
          base,
        );
      }
      if (!declared.has(capabilityId)) {
        return rejected(
          {
            code: "capability_not_declared",
            detail: `required capability "${capabilityId}" is not declared by worker "${worker.id}"`,
          },
          base,
        );
      }
      if (riskClassRank(registered.riskClass) > workerCeiling) {
        return rejected(
          {
            code: "capability_risk_escalation_denied",
            detail: `capability "${capabilityId}" risk "${registered.riskClass}" exceeds worker authority ceiling "${worker.authorityBounds.maxRiskClass}"`,
          },
          base,
        );
      }
    }

    // 7. Risk-class bounding: the tool's risk bounds which workers invoke it.
    if (riskClassRank(tool.declaration.riskClass) > workerCeiling) {
      return rejected(
        {
          code: "tool_risk_class_bounding_denied",
          detail: `tool risk "${tool.declaration.riskClass}" exceeds worker authority ceiling "${worker.authorityBounds.maxRiskClass}"`,
        },
        base,
      );
    }

    // 8. Delegation bounding — contract valid AS-OF the invocation instant,
    //    then the action bounded against the contract's authorized actions.
    const delegation = input.delegation ?? null;
    if (delegation !== null) {
      const nowIso = new Date(input.nowMs).toISOString();
      const asOf = evaluateDelegationAsOf(delegation.contract, nowIso);
      if (!asOf.ok) {
        return rejected(
          { code: "delegation_denied", detail: `${asOf.denyReason}: ${asOf.error}` },
          base,
        );
      }
      const authorization = authorizeDelegatedAction(
        delegation.contract,
        {
          delegateRef: worker.identityRef,
          tenantId: input.tenantRef.trim(),
          missionId: delegation.missionId,
          action: input.toolId.trim(),
          taskRef: delegation.taskRef,
        },
        nowIso,
      );
      if (!authorization.ok) {
        return rejected(
          { code: "delegation_action_denied", detail: authorization.denyReason },
          base,
        );
      }
    }

    // 9. Rate / budget guards (declarable per tool; typed, audited rejection).
    const rateGuard = tool.declaration.rateGuard ?? null;
    if (rateGuard !== null) {
      const timestamps = (this.executedTimestampsByTool.get(tool.declaration.toolId) ?? []).filter(
        (atMs) => atMs > input.nowMs - rateGuard.windowMs,
      );
      if (timestamps.length >= rateGuard.maxInvocationsPerWindow) {
        return rejected(
          {
            code: "tool_rate_guard_exceeded",
            detail: `${timestamps.length} invocations within the ${rateGuard.windowMs}ms window (limit ${rateGuard.maxInvocationsPerWindow})`,
          },
          base,
        );
      }
    }
    const budgetGuard = tool.declaration.budgetGuard ?? null;
    if (budgetGuard !== null) {
      const executed = this.executedTotalByTool.get(tool.declaration.toolId) ?? 0;
      if (executed >= budgetGuard.maxTotalInvocations) {
        return rejected(
          {
            code: "tool_budget_guard_exceeded",
            detail: `${executed} lifetime invocations (limit ${budgetGuard.maxTotalInvocations})`,
          },
          base,
        );
      }
    }

    // 10. Lease mediation: acquire handles through the broker — the runtime
    //     never sees raw secrets, only opaque handles.
    const leaseHandles = new Map<string, CredentialLeaseHandle>();
    const subject = subjectAuthorityFrom(worker);
    for (const requirement of tool.declaration.credentialRequirements ?? []) {
      const grant = this.config.broker.grant({
        subject,
        credentialRef: requirement.credentialRef,
        purpose: requirement.purpose,
        ttlMs: requirement.ttlMs,
        maxUses: requirement.maxUses,
        nowMs: input.nowMs,
      });
      if (!grant.ok) {
        return rejected(
          {
            code: "credential_lease_denied",
            detail: `${requirement.credentialRef}: ${grant.reason}`,
          },
          base,
        );
      }
      leaseHandles.set(requirement.credentialRef, grant.handle);
    }

    const baseWithLeases: typeof recordBase = {
      ...base,
      leaseHandleRefs: [...leaseHandles.values()].map((handle) => handle.leaseId),
    };

    // 11. Single execution attempt — the runtime NEVER retries, so a stale
    //     handle can never be replayed.
    let output: ToolExecutionOutput;
    try {
      output = tool.declaration.executor({
        workerIdentityRef: worker.identityRef,
        tenantRef: worker.tenantScope,
        toolId: tool.declaration.toolId,
        params: input.params,
        leaseHandles,
        delegationRef: delegation?.contract.delegationId ?? null,
      });
    } catch (error) {
      output = {
        ok: false,
        error: error instanceof Error ? error.message : "executor threw a non-error value",
        leaseFailureReason: null,
      };
    }

    if (!output.ok) {
      const leaseInvalidated = output.leaseFailureReason !== null;
      const failureCode: ToolExecutionFailureCode = leaseInvalidated
        ? "lease_invalidated"
        : "tool_execution_failed";
      const failureDetail = leaseInvalidated
        ? `lease invalidated: ${output.leaseFailureReason}`
        : output.error;
      const record = this.emitRecord({
        ...baseWithLeases,
        recordId,
        outcome: "failed",
        reasonCode: failureCode,
        reasonDetail: failureDetail,
        leaseInvalidated,
      });
      return { ok: false, outcome: "failed", failureCode, failureDetail, record };
    }

    // Result non-observability: a summary carrying secret material is never
    // recorded (fail closed — the execution happened, the evidence cannot).
    if (probe !== null && probe(output.summary)) {
      const record = this.emitRecord({
        ...baseWithLeases,
        recordId,
        outcome: "failed",
        reasonCode: "result_secret_material_detected",
        reasonDetail: "executor summary contains live secret material and was not recorded",
      });
      return {
        ok: false,
        outcome: "failed",
        failureCode: "result_secret_material_detected",
        failureDetail: "executor summary contained secret material",
        record,
      };
    }

    // Guards count EXECUTED invocations only — rejections are free, so a
    // guard can never be exhausted by denied traffic.
    const now = input.nowMs;
    this.executedTimestampsByTool.set(tool.declaration.toolId, [
      ...(this.executedTimestampsByTool.get(tool.declaration.toolId) ?? []),
      now,
    ]);
    this.executedTotalByTool.set(
      tool.declaration.toolId,
      (this.executedTotalByTool.get(tool.declaration.toolId) ?? 0) + 1,
    );

    const record = this.emitRecord({
      ...baseWithLeases,
      recordId,
      outcome: "executed",
      reasonCode: null,
      reasonDetail: null,
      resultSummary: output.summary,
      evidenceRef: output.evidenceRef,
    });
    return {
      ok: true,
      outcome: "executed",
      summary: output.summary,
      evidenceRef: output.evidenceRef,
      record,
    };
  }

  private emitRecord(record: ToolInvocationRecord): ToolInvocationRecord {
    this.audit.append({ kind: "TOOL_INVOCATION", atMs: record.atMs, record });
    return record;
  }
}
