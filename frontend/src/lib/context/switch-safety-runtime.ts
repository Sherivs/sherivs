/**
 * CoreGrid — runtime switch-safety guard (H3 B-013 / J-012).
 *
 * Runtime layer on top of the pure switch-safety contract
 * (`./switch-safety`, imported READ-ONLY — this module composes it, it does
 * not re-implement it). The contract owns the epoch state machine, the
 * carry-over allow-list semantics and the freshness verdicts; this module
 * adds the operational guard a session runtime needs:
 *
 * - SINGLE HELD STATE: the runtime holds exactly one immutable contract
 *   state; every operation delegates to the contract and commits the
 *   returned state. Callers can never patch state, skip the contract, or
 *   resurrect an invalidated epoch.
 * - INJECTED CLOCK: time comes only from `SwitchSafetyRuntimeConfig.now`.
 *   An invalid instant fails EVERY operation closed (no wall-clock sampling,
 *   Constitution §21).
 * - ZOD INPUT VALIDATION: every boundary input is schema-validated before
 *   delegation; malformed input is rejected without touching state.
 * - GUARDED EXECUTION: `withFreshContext` probes freshness through the
 *   contract, then — and only then — invokes the callback with an
 *   epoch-bound scope. Callback failures are contained: they are audited
 *   (error NAME only — never messages, never values) and leave the resolved
 *   epoch current, so a failed operation cannot strand stale context.
 * - NO BLEED ACROSS SWITCHES: scopes are bound to the epoch that issued
 *   them. After a switch, a captured scope is dead — `assertActive()` throws
 *   and `scopeIsActive` reports inactive. Only the contract's audited
 *   carry-over path can move derived context across a boundary (and never
 *   across the tenant boundary itself).
 * - RUNTIME AUDIT: runtime-level decisions (input rejection, scope issuance,
 *   guarded denials, execution outcomes) are appended to a dedicated
 *   append-only ledger alongside the contract's own ledger (§12, §29). No
 *   record ever carries secret material.
 *
 * Purity: identifiers are deterministic (FNV-1a); nothing here samples
 * randomness, reads a wall clock, or performs I/O.
 */
import { z } from "zod";
import {
  assertFreshContext,
  deriveContext,
  initialSwitchSafetyState,
  resolveContextEpoch,
  switchContext,
  type ContextEpoch,
  type ContextSwitchResult,
  type DerivedContextEntry,
  type DerivedContextInput,
  type DeriveContextResult,
  type ResolveEpochResult,
  type SafeContextSwitchRequest,
  type SwitchSafetyAuditRecord,
  type SwitchSafetyState,
  type ContextSwitchTarget,
} from "./switch-safety";

/* ─────────────────────────────────────────────────────────────
 * Runtime input schemas (Zod, fail-closed at the boundary)
 * ────────────────────────────────────────────────────────────*/

const actorRefSchema = z.object({
  userId: z.string().min(1),
  role: z.string().min(1),
  permissions: z.array(z.string()),
});

const contextSwitchTargetSchema = z.object({
  tenantRef: z.string().min(1),
  actorRef: actorRefSchema,
});

const derivedContextKindValues = [
  "assembled_package",
  "cached_scope",
  "resolved_tenant",
] as const;

const derivedContextInputSchema = z.object({
  kind: z.enum(derivedContextKindValues),
  tenantRef: z.string().min(1),
  ref: z.string().min(1),
});

const carryPolicyGrantSchema = z.object({
  entryId: z.string().min(1),
  originTenantRef: z.string().min(1),
  targetTenantRef: z.string().min(1),
  permission: z.string().min(1),
  policyRef: z.string().min(1),
});

const contextSwitchRequestSchema = z.object({
  target: contextSwitchTargetSchema,
  carryOver: z.array(z.object({ entryId: z.string().min(1) })).optional(),
  policyGrants: z.array(carryPolicyGrantSchema).optional(),
});

const guardedOperationSchema = z.object({
  operation: z.string().min(1),
  entryIds: z.array(z.string().min(1)),
});

/* ─────────────────────────────────────────────────────────────
 * Runtime audit vocabulary (§12, §29) — runtime-level decisions only
 * ────────────────────────────────────────────────────────────*/

export type SwitchSafetyRuntimeAuditKind =
  | "runtime_input_rejected"
  | "runtime_guard_denied_invalid_clock"
  | "runtime_scope_issued"
  | "runtime_execution_denied_freshness"
  | "runtime_execution_completed"
  | "runtime_execution_failed";

export interface SwitchSafetyRuntimeAuditRecord {
  id: string;
  kind: SwitchSafetyRuntimeAuditKind;
  detail: string;
  recordedAt: string;
  epochId: string | null;
  entryIds: readonly string[];
}

export type SwitchSafetyRuntimeDenialReason =
  | "invalid_clock"
  | "invalid_input"
  | "no_resolved_epoch"
  | "ambiguous_epoch"
  | "stale_epoch"
  | "entry_invalidated";

export type GuardedExecutionOutcome<T> =
  | { verdict: "allowed"; value: T; scope: FreshContextScope }
  | {
      verdict: "denied";
      reason: SwitchSafetyRuntimeDenialReason;
      detail: string;
      scope: null;
    }
  | { verdict: "failed"; error: unknown; scope: null };

/**
 * The context a guarded callback may see. Bound to the epoch that issued it;
 * frozen; carrying only references the callback is authorized to consume.
 */
export interface FreshContextScope {
  readonly epochId: string;
  readonly tenantRef: string;
  readonly issuedAt: string;
  readonly entries: readonly DerivedContextEntry[];
  /**
   * Fails closed: throws `StaleContextError` when the runtime has switched
   * to a different epoch since this scope was issued. A captured scope can
   * therefore never bleed context across a switch.
   */
  assertActive(): void;
}

export class StaleContextError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "StaleContextError";
  }
}

export interface SwitchSafetyRuntimeConfig {
  /**
   * Injected clock (ISO-8601). NEVER wall-clock sampled here; an invalid
   * instant fails every operation closed.
   */
  now: () => string;
}

/* ─────────────────────────────────────────────────────────────
 * Plumbing — deterministic ids (FNV-1a), never sampled
 * ────────────────────────────────────────────────────────────*/

function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function isValidInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

interface RuntimeAuditFields {
  epochId?: string | null;
  entryIds?: readonly string[];
}

function appendRuntimeAudit(
  ledger: readonly SwitchSafetyRuntimeAuditRecord[],
  kind: SwitchSafetyRuntimeAuditKind,
  detail: string,
  recordedAt: string,
  fields: RuntimeAuditFields,
): SwitchSafetyRuntimeAuditRecord[] {
  const entryIds = fields.entryIds ?? [];
  const record: SwitchSafetyRuntimeAuditRecord = {
    id: `switch-runtime-audit-${fnv1a32Hex(
      [kind, detail, fields.epochId ?? "", entryIds.join(","), recordedAt, String(ledger.length)].join(
        "|",
      ),
    )}`,
    kind,
    detail,
    recordedAt,
    epochId: fields.epochId ?? null,
    entryIds: Object.freeze([...entryIds]),
  };
  return [...ledger, record];
}

function zodIssueSummary(error: z.ZodError): string {
  const first = error.issues[0];
  const path = first.path.length > 0 ? first.path.join(".") : "<root>";
  return `path "${path}": ${first.message}`;
}

/* ─────────────────────────────────────────────────────────────
 * SwitchSafetyRuntimeGuard
 * ────────────────────────────────────────────────────────────*/

/**
 * The runtime guard. Holds ONE contract state; every mutation path goes
 * through the read-only contract and commits its returned state. There is
 * no accessor that mutates state and no path that bypasses the contract's
 * verdicts.
 */
export class SwitchSafetyRuntimeGuard {
  private state: SwitchSafetyState;
  private runtimeLedger: SwitchSafetyRuntimeAuditRecord[];
  private readonly config: SwitchSafetyRuntimeConfig;

  constructor(config: SwitchSafetyRuntimeConfig, state?: SwitchSafetyState) {
    this.config = config;
    this.state = state ?? initialSwitchSafetyState();
    this.runtimeLedger = [];
  }

  /** Current instant from the injected clock; null when invalid (fail closed). */
  private instant(): string | null {
    const value = this.config.now();
    return typeof value === "string" && isValidInstant(value) ? value : null;
  }

  private commit(next: SwitchSafetyState): void {
    this.state = next;
  }

  /** Contract-level audit ledger (append-only view). */
  auditTrail(): readonly SwitchSafetyAuditRecord[] {
    return this.state.audit;
  }

  /** Runtime-level audit ledger (append-only view). */
  runtimeAuditTrail(): readonly SwitchSafetyRuntimeAuditRecord[] {
    return this.runtimeLedger;
  }

  currentEpoch(): ContextEpoch | null {
    return this.state.epoch;
  }

  /* ── epoch resolution (delegates to the contract) ──*/

  resolveEpoch(target: ContextSwitchTarget): ResolveEpochResult {
    const now = this.instant();
    if (now === null) {
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_guard_denied_invalid_clock",
        "Epoch resolution denied: the injected clock did not produce a valid ISO-8601 instant",
        String(this.config.now()),
        {},
      );
      return { ok: false, state: this.state, reason: "invalid_clock" };
    }
    const parsed = contextSwitchTargetSchema.safeParse(target);
    if (!parsed.success) {
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_input_rejected",
        `Epoch resolution input rejected by schema: ${zodIssueSummary(parsed.error)}`,
        now,
        {},
      );
      return { ok: false, state: this.state, reason: "invalid_target" };
    }
    const result = resolveContextEpoch(this.state, parsed.data, { now });
    this.commit(result.state);
    return result;
  }

  /* ── derived context registration (delegates to the contract) ──*/

  derive(entries: readonly DerivedContextInput[]): DeriveContextResult {
    const now = this.instant();
    if (now === null) {
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_guard_denied_invalid_clock",
        "Derived-context registration denied: the injected clock did not produce a valid ISO-8601 instant",
        String(this.config.now()),
        {},
      );
      return { ok: false, state: this.state, admitted: [], denied: [] };
    }
    const parsed = z.array(derivedContextInputSchema).safeParse(entries);
    if (!parsed.success) {
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_input_rejected",
        `Derived-context input rejected by schema: ${zodIssueSummary(parsed.error)}`,
        now,
        {},
      );
      return { ok: false, state: this.state, admitted: [], denied: [] };
    }
    const result = deriveContext(this.state, parsed.data, { now });
    this.commit(result.state);
    return result;
  }

  /* ── first-class switch (delegates to the contract) ──*/

  switchTo(switchRequest: SafeContextSwitchRequest): ContextSwitchResult {
    const now = this.instant();
    if (now === null) {
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_guard_denied_invalid_clock",
        "Context switch denied: the injected clock did not produce a valid ISO-8601 instant",
        String(this.config.now()),
        {},
      );
      return {
        applied: false,
        reason: "invalid_clock",
        state: this.state,
        epoch: null,
        carried: [],
        invalidated: [],
      };
    }
    const parsed = contextSwitchRequestSchema.safeParse(switchRequest);
    if (!parsed.success) {
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_input_rejected",
        `Context-switch input rejected by schema: ${zodIssueSummary(parsed.error)}`,
        now,
        { epochId: this.state.epoch?.epochId ?? null },
      );
      return {
        applied: false,
        reason: "invalid_target",
        state: this.state,
        epoch: null,
        carried: [],
        invalidated: [],
      };
    }
    const result = switchContext(this.state, parsed.data, { now });
    this.commit(result.state);
    return result;
  }

  /* ── guarded execution (freshness delegated to the contract) ──*/

  /**
   * Execute `callback` under the CURRENT epoch, gated by the contract's
   * freshness probe for every derived entry the callback declares. Fails
   * closed before the callback runs on: invalid clock, unresolved epoch,
   * invalid input, or any invalidated entry. On success the callback
   * receives a frozen scope bound to the issuing epoch; on callback failure
   * the epoch REMAINS current (a failed operation cannot strand stale
   * context) and the error is contained, audited by name only.
   */
  withFreshContext<T>(
    operation: string,
    entryIds: readonly string[],
    callback: (scope: FreshContextScope) => T,
  ): GuardedExecutionOutcome<T> {
    const rawNow = String(this.config.now());
    const now = this.instant();
    if (now === null) {
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_guard_denied_invalid_clock",
        `Guarded operation "${operation}" denied: the injected clock did not produce a valid ISO-8601 instant`,
        rawNow,
        { epochId: this.state.epoch?.epochId ?? null },
      );
      return {
        verdict: "denied",
        reason: "invalid_clock",
        detail: "Injected clock did not produce a valid ISO-8601 instant",
        scope: null,
      };
    }

    const parsed = guardedOperationSchema.safeParse({ operation, entryIds });
    if (!parsed.success) {
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_input_rejected",
        `Guarded operation input rejected by schema: ${zodIssueSummary(parsed.error)}`,
        now,
        { epochId: this.state.epoch?.epochId ?? null },
      );
      return {
        verdict: "denied",
        reason: "invalid_input",
        detail: `Operation input rejected by schema: ${zodIssueSummary(parsed.error)}`,
        scope: null,
      };
    }

    const epochId = this.state.epoch?.epochId ?? null;
    for (const entryId of parsed.data.entryIds) {
      const probe = assertFreshContext(
        this.state,
        { operation: parsed.data.operation, epochId, entryId },
        { now },
      );
      if (probe.verdict === "denied") {
        this.commit(probe.state);
        this.runtimeLedger = appendRuntimeAudit(
          this.runtimeLedger,
          "runtime_execution_denied_freshness",
          `Guarded operation "${parsed.data.operation}" denied by the freshness contract: ${probe.reason}`,
          now,
          { epochId, entryIds: parsed.data.entryIds },
        );
        return {
          verdict: "denied",
          reason: probe.reason,
          detail: probe.detail,
          scope: null,
        };
      }
    }

    const epoch = this.state.epoch;
    if (epoch === null) {
      // Unreachable via the contract's probes (they deny with
      // no_resolved_epoch first); guarded defensively — fail closed.
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_execution_denied_freshness",
        `Guarded operation "${parsed.data.operation}" denied: no resolved epoch`,
        now,
        { epochId: null, entryIds: parsed.data.entryIds },
      );
      return {
        verdict: "denied",
        reason: "no_resolved_epoch",
        detail: "No context epoch is resolved",
        scope: null,
      };
    }

    const scopeEpochId = epoch.epochId;
    const scope: FreshContextScope = Object.freeze({
      epochId: scopeEpochId,
      tenantRef: epoch.tenantRef,
      issuedAt: now,
      entries: Object.freeze([...this.state.derived]),
      assertActive: (): void => {
        if (this.state.epoch?.epochId !== scopeEpochId) {
          throw new StaleContextError(
            `Scope was issued under epoch "${scopeEpochId}" but the runtime has since switched to epoch "${this.state.epoch?.epochId ?? "<none>"}"; captured scope context cannot cross a switch (fail closed, J-012)`,
          );
        }
      },
    });
    this.runtimeLedger = appendRuntimeAudit(
      this.runtimeLedger,
      "runtime_scope_issued",
      `Scope issued for operation "${parsed.data.operation}" under epoch "${scopeEpochId}"`,
      now,
      { epochId: scopeEpochId, entryIds: parsed.data.entryIds },
    );

    let value: T;
    try {
      value = callback(scope);
    } catch (error: unknown) {
      const errorName = error instanceof Error ? error.name : "non_error_throw";
      this.runtimeLedger = appendRuntimeAudit(
        this.runtimeLedger,
        "runtime_execution_failed",
        `Guarded operation "${parsed.data.operation}" failed while the epoch "${scopeEpochId}" remained current; audited by error name only ("${errorName}") — no error content is recorded`,
        now,
        { epochId: scopeEpochId, entryIds: parsed.data.entryIds },
      );
      return { verdict: "failed", error, scope: null };
    }

    this.runtimeLedger = appendRuntimeAudit(
      this.runtimeLedger,
      "runtime_execution_completed",
      `Guarded operation "${parsed.data.operation}" completed under epoch "${scopeEpochId}"`,
      now,
      { epochId: scopeEpochId, entryIds: parsed.data.entryIds },
    );
    return { verdict: "allowed", value, scope };
  }

  /* ── captured-scope staleness (no bleed across switches) ──*/

  /** Whether a captured scope is still bound to the CURRENT epoch. */
  scopeIsActive(scope: FreshContextScope): boolean {
    return this.state.epoch?.epochId === scope.epochId;
  }

  /**
   * Typed staleness check without exceptions, for callers that prefer a
   * discriminated result over `assertActive`.
   */
  validateScope(scope: FreshContextScope): { active: true } | { active: false; reason: "scope_epoch_superseded" } {
    return this.scopeIsActive(scope)
      ? { active: true }
      : { active: false, reason: "scope_epoch_superseded" };
  }
}