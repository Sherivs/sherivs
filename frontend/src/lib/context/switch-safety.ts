/**
 * CoreGrid — contract-level context-switch safety (MISSION-H2-22 / J-012, G-070).
 *
 * A switch between tenants/realities is a FIRST-CLASS operation on the
 * session's resolved context, not an ambient reassignment. This module owns
 * the pure contract for that operation on top of the context-assembly
 * substrate (`../context-assembly`): it never performs I/O, never resolves
 * permissions itself, and never reads a wall clock — time is injected
 * (`SwitchSafetyConfig.now`).
 *
 * Invariants (Constitution §13, §19, §21; J-012 "one user, many realities"):
 * - A switch INVALIDATES all derived in-memory context (assembled packages,
 *   cached scopes, resolved tenant) bound to the outgoing epoch. Nothing from
 *   the prior epoch stays active unless it is explicitly carried over under a
 *   policy grant from the audited allow-list.
 * - Carry-over can never smuggle data across boundaries: a grant is an
 *   explicit per-entry allow-list entry (origin tenant, target tenant,
 *   permission, policy reference) that must match the entry's canonical
 *   tenant truth, and an entry whose data belongs to a tenant other than the
 *   switch target is denied even when a grant claims to authorize it
 *   (Constitution §13 — a policy grant never overrides the tenant boundary).
 * - The contract FAILS CLOSED: after a switch, an operation that presents the
 *   stale epoch id, presents no epoch at all (ambiguous), or consumes a
 *   derived entry invalidated by the switch is denied AND audited.
 * - Everything is auditable: epoch resolution, derived-context registration,
 *   invalidation, carry decisions (admitted and denied) and stale denials are
 *   first-class audit records stamped with the injected audit instant
 *   (§12 — provenance, §29 — observability).
 * - The module is PURE: state is an immutable value (every operation returns
 *   a new state; inputs are never mutated) and every identifier is derived
 *   deterministically (FNV-1a, never sampled or random).
 */
import type { ContextActorRef } from "../context-assembly";

/** Re-exported so consumers of this contract share one actor vocabulary. */
export type { ContextActorRef };

/* ─────────────────────────────────────────────────────────────
 * Epoch + derived in-memory context vocabulary
 * ────────────────────────────────────────────────────────────*/

/**
 * A resolved context epoch: the server-resolved tenant/actor context a
 * session operates under (Constitution §13 — every request has tenant
 * context, resolved server-side, never trusted from the client).
 */
export interface ContextEpoch {
  epochId: string;
  tenantRef: string;
  actorRef: ContextActorRef;
  /** Resolution instant — from the injected clock, never wall-clock sampled. */
  resolvedAt: string;
  traceId: string;
}

/** Kinds of derived in-memory context the switch contract guards. */
export type DerivedContextKind = "assembled_package" | "cached_scope" | "resolved_tenant";

/**
 * A piece of derived in-memory context (an assembled package, a cached
 * scope, a resolved tenant reference). Bound to exactly one epoch; a switch
 * invalidates every entry not explicitly carried over under policy.
 */
export interface DerivedContextEntry {
  id: string;
  kind: DerivedContextKind;
  /**
   * Tenant whose data the entry references — canonical origin truth
   * (Constitution §13), independent of any grant or declaration.
   */
  tenantRef: string;
  derivedUnderEpochId: string;
  derivedAt: string;
  /** Opaque reference to the derived material (package trace id, cache key, …). */
  ref: string;
}

/**
 * A derived entry that crossed a switch boundary. Provenance fields
 * (carried-from epoch/entry, policy grant) make every hop auditable (§12).
 */
export interface CarriedDerivedContextEntry extends DerivedContextEntry {
  carriedFromEntryId: string;
  carriedFromEpochId: string;
  carriedAt: string;
  /** Policy allow-list entry that authorized the carry (audited). */
  policyRef: string;
}

/* ─────────────────────────────────────────────────────────────
 * Audit ledger
 * ────────────────────────────────────────────────────────────*/

export type SwitchSafetyAuditKind =
  | "epoch_resolved"
  | "epoch_resolution_denied"
  | "derived_context_registered"
  | "derived_context_denied_no_epoch"
  | "derived_context_denied_cross_tenant"
  | "derived_context_denied_invalid_clock"
  | "switch_applied"
  | "switch_denied"
  | "derived_context_invalidated"
  | "carry_over_admitted"
  | "carry_over_denied_unknown_entry"
  | "carry_over_denied_duplicate"
  | "carry_over_denied_no_policy_grant"
  | "carry_over_denied_cross_tenant"
  | "carry_over_denied_permission"
  | "stale_context_denied";

/**
 * First-class audit record (§12, §29). Nothing in this module happens
 * without one: every resolution, registration, invalidation, carry decision
 * and denial is recorded with the injected audit instant.
 */
export interface SwitchSafetyAuditRecord {
  id: string;
  kind: SwitchSafetyAuditKind;
  detail: string;
  recordedAt: string;
  /** Epoch in effect (or, for a switch, the NEW epoch) when recorded. */
  epochId: string | null;
  entryId: string | null;
  tenantRef: string | null;
  policyRef: string | null;
  permission: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * State, config, requests
 * ────────────────────────────────────────────────────────────*/

/**
 * The pure switch-safety state. Treated as immutable: every operation
 * returns a NEW state; inputs are never mutated.
 */
export interface SwitchSafetyState {
  /** Currently resolved epoch; null before the first resolution. */
  epoch: ContextEpoch | null;
  /**
   * Active derived in-memory context — bound to the current epoch only.
   * Empty immediately after a switch except for explicitly carried entries.
   */
  derived: readonly DerivedContextEntry[];
  /** Append-only audit ledger. */
  audit: readonly SwitchSafetyAuditRecord[];
}

export interface SwitchSafetyConfig {
  /** Operation instant (ISO-8601). Required for purity — never wall-clock sampled. */
  now: string;
}

/** Server-resolved target of a switch: the NEW tenant/actor context. */
export interface ContextSwitchTarget {
  tenantRef: string;
  actorRef: ContextActorRef;
}

/** Explicit request to carry one prior-epoch entry across the switch boundary. */
export interface ContextSwitchCarryOverRequest {
  entryId: string;
}

/**
 * One entry of the carry-over allow-list (J-012). Carry-over is NEVER
 * implied: an entry crosses only when a grant names it exactly — entry id,
 * declared origin tenant, declared target tenant, the permission the NEW
 * actor must hold, and the policy under which the grant exists (§43).
 */
export interface SwitchCarryPolicyGrant {
  entryId: string;
  originTenantRef: string;
  targetTenantRef: string;
  permission: string;
  policyRef: string;
}

export interface SafeContextSwitchRequest {
  target: ContextSwitchTarget;
  /** Prior-epoch entries explicitly requested to cross the boundary. */
  carryOver?: readonly ContextSwitchCarryOverRequest[];
  /** The audited allow-list that authorizes requested carries. */
  policyGrants?: readonly SwitchCarryPolicyGrant[];
}

export interface ContextSwitchResult {
  /** Whether the switch was applied and a NEW epoch is now current. */
  applied: boolean;
  /** Denial reason when not applied (fail-closed; prior epoch stays current). */
  reason: string | null;
  state: SwitchSafetyState;
  /** The NEW epoch when applied, else null. */
  epoch: ContextEpoch | null;
  carried: readonly CarriedDerivedContextEntry[];
  /** Prior-epoch entries invalidated by the switch (audit-backed). */
  invalidated: readonly DerivedContextEntry[];
}

export interface DerivedContextInput {
  kind: DerivedContextKind;
  tenantRef: string;
  ref: string;
}

export type DeriveContextResult =
  | {
      ok: true;
      state: SwitchSafetyState;
      admitted: readonly DerivedContextEntry[];
      denied: readonly SwitchSafetyAuditRecord[];
    }
  | {
      ok: false;
      state: SwitchSafetyState;
      admitted: readonly DerivedContextEntry[];
      denied: readonly SwitchSafetyAuditRecord[];
    };

export interface ContextFreshnessProbe {
  /** Operation name (audit vocabulary). */
  operation: string;
  /**
   * The epoch id the operation believes it is executing under. Null or
   * absent is AMBIGUOUS and is denied — the contract fails closed.
   */
  epochId?: string | null;
  /** Derived entry the operation wants to consume; must still be active. */
  entryId?: string | null;
}

export type ContextFreshnessDenialReason =
  "invalid_clock" | "no_resolved_epoch" | "ambiguous_epoch" | "stale_epoch" | "entry_invalidated";

export type ContextFreshnessVerdict =
  | {
      verdict: "allowed";
      state: SwitchSafetyState;
      epochId: string;
      auditedAt: string;
    }
  | {
      verdict: "denied";
      state: SwitchSafetyState;
      reason: ContextFreshnessDenialReason;
      detail: string;
      auditedAt: string;
    };

/* ─────────────────────────────────────────────────────────────
 * Deterministic identifiers + audit plumbing (purity law)
 * ────────────────────────────────────────────────────────────*/

/** FNV-1a 32-bit — deterministic, short, no crypto sampling (purity law). */
function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function initialSwitchSafetyState(): SwitchSafetyState {
  return { epoch: null, derived: [], audit: [] };
}

interface AuditFields {
  epochId?: string | null;
  entryId?: string | null;
  tenantRef?: string | null;
  policyRef?: string | null;
  permission?: string | null;
}

/**
 * Pure audit-appender: returns the record plus the new ledger. Sequence salt
 * keeps ids unique even when kind/detail/fields repeat within one instant.
 */
function appendAudit(
  ledger: readonly SwitchSafetyAuditRecord[],
  kind: SwitchSafetyAuditKind,
  detail: string,
  recordedAt: string,
  fields: AuditFields,
): { record: SwitchSafetyAuditRecord; ledger: SwitchSafetyAuditRecord[] } {
  const record: SwitchSafetyAuditRecord = {
    id: `switch-audit-${fnv1a32Hex(
      [
        kind,
        detail,
        fields.epochId ?? "",
        fields.entryId ?? "",
        fields.tenantRef ?? "",
        fields.policyRef ?? "",
        fields.permission ?? "",
        recordedAt,
        String(ledger.length),
      ].join("|"),
    )}`,
    kind,
    detail,
    recordedAt,
    epochId: fields.epochId ?? null,
    entryId: fields.entryId ?? null,
    tenantRef: fields.tenantRef ?? null,
    policyRef: fields.policyRef ?? null,
    permission: fields.permission ?? null,
  };
  return { record, ledger: [...ledger, record] };
}

function validActorRef(actorRef: ContextActorRef | undefined): boolean {
  return (
    typeof actorRef?.userId === "string" &&
    actorRef.userId.length > 0 &&
    typeof actorRef?.role === "string" &&
    actorRef.role.length > 0 &&
    Array.isArray(actorRef?.permissions)
  );
}

function isValidTarget(target: ContextSwitchTarget | undefined): boolean {
  return (
    typeof target?.tenantRef === "string" &&
    target.tenantRef.length > 0 &&
    validActorRef(target.actorRef)
  );
}

/** Raw declared tenantRef of a target, even when the target fails validation. */
function declaredTenantRef(target: ContextSwitchTarget | undefined): string | null {
  return typeof target?.tenantRef === "string" ? target.tenantRef : null;
}

function newEpoch(target: ContextSwitchTarget, now: string): ContextEpoch {
  const key = [target.tenantRef, target.actorRef.userId, target.actorRef.role, now].join("|");
  return {
    epochId: `ctx-epoch-${fnv1a32Hex(key)}`,
    tenantRef: target.tenantRef,
    actorRef: { ...target.actorRef, permissions: [...target.actorRef.permissions] },
    resolvedAt: now,
    traceId: `ctx-epoch-trace-${fnv1a32Hex(`trace|${key}`)}`,
  };
}

function parseInstant(now: string): number | null {
  const ms = Date.parse(now);
  return Number.isNaN(ms) ? null : ms;
}

/* ─────────────────────────────────────────────────────────────
 * resolveContextEpoch — first/only server-side epoch resolution
 * ────────────────────────────────────────────────────────────*/

export type ResolveEpochResult =
  | { ok: true; state: SwitchSafetyState; epoch: ContextEpoch }
  | {
      ok: false;
      state: SwitchSafetyState;
      reason: "invalid_clock" | "invalid_target" | "epoch_already_resolved";
    };

/**
 * Resolve the session's context epoch (Constitution §13). Deliberately
 * restricted: once an epoch is resolved, changing tenant/reality is a
 * FIRST-CLASS switch via `switchContext` — never an ambient
 * re-resolution. Fails closed on invalid clock or target; denials are
 * audited.
 */
export function resolveContextEpoch(
  state: SwitchSafetyState,
  target: ContextSwitchTarget,
  config: SwitchSafetyConfig,
): ResolveEpochResult {
  if (parseInstant(config.now) === null) {
    const { ledger } = appendAudit(
      state.audit,
      "epoch_resolution_denied",
      "Config `now` is not a valid ISO-8601 timestamp",
      config.now,
      { tenantRef: declaredTenantRef(target) },
    );
    return { ok: false, state: { ...state, audit: ledger }, reason: "invalid_clock" };
  }
  if (!isValidTarget(target)) {
    const { ledger } = appendAudit(
      state.audit,
      "epoch_resolution_denied",
      "Epoch resolution denied: tenantRef and actorRef (userId, role, permissions) must be resolved server-side",
      config.now,
      { tenantRef: declaredTenantRef(target) },
    );
    return { ok: false, state: { ...state, audit: ledger }, reason: "invalid_target" };
  }
  if (state.epoch !== null) {
    const { ledger } = appendAudit(
      state.audit,
      "epoch_resolution_denied",
      `Epoch "${state.epoch.epochId}" is already resolved; changing tenant/reality requires switchContext (J-012)`,
      config.now,
      { epochId: state.epoch.epochId, tenantRef: state.epoch.tenantRef },
    );
    return {
      ok: false,
      state: { ...state, audit: ledger },
      reason: "epoch_already_resolved",
    };
  }

  const epoch = newEpoch(target, config.now);
  const { ledger } = appendAudit(
    state.audit,
    "epoch_resolved",
    `Epoch "${epoch.epochId}" resolved for tenant "${epoch.tenantRef}"`,
    config.now,
    { epochId: epoch.epochId, tenantRef: epoch.tenantRef },
  );
  return { ok: true, state: { ...state, epoch, audit: ledger }, epoch };
}

/* ─────────────────────────────────────────────────────────────
 * deriveContext — register derived in-memory context
 * ────────────────────────────────────────────────────────────*/

/**
 * Register derived in-memory context (assembled package, cached scope,
 * resolved tenant) under the CURRENT epoch. Fails closed with no resolved
 * epoch, and denies entries whose canonical data tenant differs from the
 * epoch tenant (Constitution §13 — derived context cannot reference data
 * outside the tenant context it was derived under).
 */
export function deriveContext(
  state: SwitchSafetyState,
  entries: readonly DerivedContextInput[],
  config: SwitchSafetyConfig,
): DeriveContextResult {
  if (parseInstant(config.now) === null) {
    const { record, ledger } = appendAudit(
      state.audit,
      "derived_context_denied_invalid_clock",
      "Config `now` is not a valid ISO-8601 timestamp",
      config.now,
      {},
    );
    return { ok: false, state: { ...state, audit: ledger }, admitted: [], denied: [record] };
  }
  if (state.epoch === null) {
    const { record, ledger } = appendAudit(
      state.audit,
      "derived_context_denied_no_epoch",
      "No context epoch is resolved; derived in-memory context cannot exist outside a resolved tenant context",
      config.now,
      {},
    );
    return { ok: false, state: { ...state, audit: ledger }, admitted: [], denied: [record] };
  }

  const epoch = state.epoch;
  let ledger = state.audit;
  const denied: SwitchSafetyAuditRecord[] = [];
  const admitted: DerivedContextEntry[] = [];

  for (const entry of entries) {
    if (entry.tenantRef !== epoch.tenantRef) {
      const { record, ledger: next } = appendAudit(
        ledger,
        "derived_context_denied_cross_tenant",
        `Derived entry references tenant "${entry.tenantRef}" but the resolved epoch belongs to tenant "${epoch.tenantRef}" (Constitution §13)`,
        config.now,
        { epochId: epoch.epochId, tenantRef: entry.tenantRef },
      );
      ledger = next;
      denied.push(record);
      continue;
    }
    const derivedEntry: DerivedContextEntry = {
      id: `dctx-${fnv1a32Hex(
        [
          entry.kind,
          entry.tenantRef,
          entry.ref,
          epoch.epochId,
          config.now,
          String(ledger.length),
        ].join("|"),
      )}`,
      kind: entry.kind,
      tenantRef: entry.tenantRef,
      derivedUnderEpochId: epoch.epochId,
      derivedAt: config.now,
      ref: entry.ref,
    };
    const { ledger: next } = appendAudit(
      ledger,
      "derived_context_registered",
      `Derived ${entry.kind} "${entry.ref}" registered under epoch "${epoch.epochId}"`,
      config.now,
      { epochId: epoch.epochId, entryId: derivedEntry.id, tenantRef: entry.tenantRef },
    );
    ledger = next;
    admitted.push(derivedEntry);
  }

  return {
    ok: true,
    state: { ...state, derived: [...state.derived, ...admitted], audit: ledger },
    admitted,
    denied,
  };
}

/* ─────────────────────────────────────────────────────────────
 * switchContext — first-class zero-bleed tenant/reality switch (J-012)
 * ────────────────────────────────────────────────────────────*/

/**
 * Switch the session's resolved context to a NEW tenant/reality. Zero-bleed
 * is structural:
 *
 * - EVERY prior-epoch derived entry not explicitly carried over is
 *   invalidated and audited (`derived_context_invalidated`).
 * - A carry request is admitted only when a policy grant from the audited
 *   allow-list names the entry exactly (origin tenant, target tenant,
 *   permission held by the NEW actor, policy reference) — and even then only
 *   when the entry's canonical data tenant equals the NEW tenant
 *   (Constitution §13; a grant never overrides the tenant boundary).
 * - A denied switch leaves the prior epoch current (fail-closed); denials
 *   are audited.
 * - Carried entries are re-derived under the NEW epoch with full
 *   provenance; they never reuse prior identity.
 */
export function switchContext(
  state: SwitchSafetyState,
  switchRequest: SafeContextSwitchRequest,
  config: SwitchSafetyConfig,
): ContextSwitchResult {
  const deny = (reason: string, detail: string, fields: AuditFields = {}): ContextSwitchResult => {
    const { ledger } = appendAudit(state.audit, "switch_denied", detail, config.now, fields);
    return {
      applied: false,
      reason,
      state: { ...state, audit: ledger },
      epoch: null,
      carried: [],
      invalidated: [],
    };
  };

  if (parseInstant(config.now) === null) {
    return deny("invalid_clock", "Config `now` is not a valid ISO-8601 timestamp");
  }
  if (!isValidTarget(switchRequest?.target)) {
    return deny(
      "invalid_target",
      "Switch target is invalid: tenantRef and actorRef (userId, role, permissions) must be resolved server-side",
    );
  }
  const target: ContextSwitchTarget = switchRequest.target;
  const prior = state.epoch;
  if (prior === null) {
    return deny(
      "no_resolved_epoch",
      "No context epoch is resolved; resolve the first epoch before switching (J-012)",
      { tenantRef: target.tenantRef },
    );
  }

  const epoch = newEpoch(target, config.now);
  let ledger = state.audit;
  const carryOver = switchRequest.carryOver ?? [];
  const policyGrants = switchRequest.policyGrants ?? [];
  const carried: CarriedDerivedContextEntry[] = [];
  const carriedFromIds = new Set<string>();

  for (const carry of carryOver) {
    const duplicate = carriedFromIds.has(carry.entryId);
    const priorEntry = duplicate
      ? undefined
      : state.derived.find((entry) => entry.id === carry.entryId);

    if (priorEntry === undefined) {
      const { ledger: next } = appendAudit(
        ledger,
        duplicate ? "carry_over_denied_duplicate" : "carry_over_denied_unknown_entry",
        duplicate
          ? `Duplicate carry request for prior entry "${carry.entryId}" (already carried)`
          : `Carry request references entry "${carry.entryId}" which is not active in the prior epoch "${prior.epochId}"`,
        config.now,
        { epochId: prior.epochId, entryId: carry.entryId, tenantRef: prior.tenantRef },
      );
      ledger = next;
      continue;
    }

    const grant = policyGrants.find((g) => g.entryId === carry.entryId);
    const grantCovers =
      grant !== undefined &&
      grant.originTenantRef === priorEntry.tenantRef &&
      grant.targetTenantRef === target.tenantRef &&
      typeof grant.permission === "string" &&
      grant.permission.length > 0 &&
      typeof grant.policyRef === "string" &&
      grant.policyRef.length > 0;

    if (!grantCovers) {
      const { ledger: next } = appendAudit(
        ledger,
        "carry_over_denied_no_policy_grant",
        `Carry request for entry "${carry.entryId}" is not covered by the audited allow-list: a grant naming the entry, its origin tenant "${priorEntry.tenantRef}", the target tenant "${target.tenantRef}", a permission and a policyRef is required`,
        config.now,
        {
          epochId: prior.epochId,
          entryId: carry.entryId,
          tenantRef: priorEntry.tenantRef,
          policyRef: grant?.policyRef ?? null,
        },
      );
      ledger = next;
      continue;
    }

    // Tenant boundary (Constitution §13): an entry whose canonical data
    // tenant differs from the NEW tenant cannot cross, even under a
    // covering grant.
    if (priorEntry.tenantRef !== target.tenantRef) {
      const { ledger: next } = appendAudit(
        ledger,
        "carry_over_denied_cross_tenant",
        `Entry "${carry.entryId}" references tenant "${priorEntry.tenantRef}" and cannot cross a switch to tenant "${target.tenantRef}" (Constitution §13); policy grant "${grant.policyRef}" does not override the tenant boundary`,
        config.now,
        {
          epochId: prior.epochId,
          entryId: carry.entryId,
          tenantRef: priorEntry.tenantRef,
          policyRef: grant.policyRef,
          permission: grant.permission,
        },
      );
      ledger = next;
      continue;
    }

    if (!target.actorRef.permissions.includes(grant.permission)) {
      const { ledger: next } = appendAudit(
        ledger,
        "carry_over_denied_permission",
        `Carry of entry "${carry.entryId}" requires permission "${grant.permission}" which the NEW-scope actor "${target.actorRef.userId}" does not hold`,
        config.now,
        {
          epochId: prior.epochId,
          entryId: carry.entryId,
          tenantRef: priorEntry.tenantRef,
          policyRef: grant.policyRef,
          permission: grant.permission,
        },
      );
      ledger = next;
      continue;
    }

    const carriedEntry: CarriedDerivedContextEntry = {
      id: `dctx-${fnv1a32Hex(
        [
          "carried",
          priorEntry.kind,
          priorEntry.tenantRef,
          priorEntry.ref,
          epoch.epochId,
          priorEntry.id,
          String(ledger.length),
        ].join("|"),
      )}`,
      kind: priorEntry.kind,
      tenantRef: priorEntry.tenantRef,
      derivedUnderEpochId: epoch.epochId,
      derivedAt: config.now,
      ref: priorEntry.ref,
      carriedFromEntryId: priorEntry.id,
      carriedFromEpochId: prior.epochId,
      carriedAt: config.now,
      policyRef: grant.policyRef,
    };
    const { ledger: next } = appendAudit(
      ledger,
      "carry_over_admitted",
      `Entry "${carriedEntry.id}" (${carriedEntry.kind}, "${carriedEntry.ref}") carried from epoch "${prior.epochId}" into epoch "${epoch.epochId}" under policy "${grant.policyRef}"`,
      config.now,
      {
        epochId: epoch.epochId,
        entryId: carriedEntry.id,
        tenantRef: carriedEntry.tenantRef,
        policyRef: grant.policyRef,
      },
    );
    ledger = next;
    carried.push(carriedEntry);
    carriedFromIds.add(priorEntry.id);
  }

  const invalidated = state.derived.filter((entry) => !carriedFromIds.has(entry.id));
  for (const entry of invalidated) {
    const { ledger: next } = appendAudit(
      ledger,
      "derived_context_invalidated",
      `Derived ${entry.kind} "${entry.ref}" (entry "${entry.id}", epoch "${entry.derivedUnderEpochId}") invalidated by switch to tenant "${target.tenantRef}"; prior-epoch context never bleeds by default (J-012)`,
      config.now,
      { epochId: epoch.epochId, entryId: entry.id, tenantRef: entry.tenantRef },
    );
    ledger = next;
  }
  const { ledger: finalLedger } = appendAudit(
    ledger,
    "switch_applied",
    `Context switch applied: epoch "${prior.epochId}" (tenant "${prior.tenantRef}") -> epoch "${epoch.epochId}" (tenant "${target.tenantRef}"); ${carried.length} carried, ${invalidated.length} invalidated`,
    config.now,
    { epochId: epoch.epochId, tenantRef: target.tenantRef },
  );
  ledger = finalLedger;

  return {
    applied: true,
    reason: null,
    state: { ...state, epoch, derived: carried, audit: ledger },
    epoch,
    carried,
    invalidated,
  };
}

/* ─────────────────────────────────────────────────────────────
 * assertFreshContext — fail-closed gate for post-switch operations
 * ────────────────────────────────────────────────────────────*/

/**
 * Gate every operation that consumes session context. Fails closed:
 *
 * - no resolved epoch -> denied (`no_resolved_epoch`);
 * - operation presents NO epoch id -> denied (`ambiguous_epoch`);
 * - operation presents a STALE epoch id (pre-switch) -> denied
 *   (`stale_epoch`);
 * - operation consumes a derived entry the switch invalidated -> denied
 *   (`entry_invalidated`).
 *
 * Every denial is audited (`stale_context_denied`); allowed probes are not
 * audited (the ledger records denials and switch events only).
 */
export function assertFreshContext(
  state: SwitchSafetyState,
  probe: ContextFreshnessProbe,
  config: SwitchSafetyConfig,
): ContextFreshnessVerdict {
  const deny = (reason: ContextFreshnessDenialReason, detail: string): ContextFreshnessVerdict => {
    const { ledger } = appendAudit(state.audit, "stale_context_denied", detail, config.now, {
      epochId: state.epoch?.epochId ?? null,
      entryId: probe.entryId ?? null,
      tenantRef: state.epoch?.tenantRef ?? null,
    });
    return {
      verdict: "denied",
      state: { ...state, audit: ledger },
      reason,
      detail,
      auditedAt: config.now,
    };
  };

  if (parseInstant(config.now) === null) {
    return {
      verdict: "denied",
      state,
      reason: "invalid_clock",
      detail: "Config `now` is not a valid ISO-8601 timestamp",
      auditedAt: config.now,
    };
  }
  if (state.epoch === null) {
    return deny(
      "no_resolved_epoch",
      `Operation "${probe.operation}" denied: no context epoch is resolved`,
    );
  }
  if (typeof probe.operation !== "string" || probe.operation.length === 0) {
    return deny(
      "ambiguous_epoch",
      "Operation denied: an operation name is required to audit a context probe",
    );
  }
  if (typeof probe.epochId !== "string" || probe.epochId.length === 0) {
    return deny(
      "ambiguous_epoch",
      `Operation "${probe.operation}" denied: it presented no epoch id, which is ambiguous after a context switch (fail closed, J-012)`,
    );
  }
  if (probe.epochId !== state.epoch.epochId) {
    return deny(
      "stale_epoch",
      `Operation "${probe.operation}" denied: it presented epoch "${probe.epochId}" but the resolved epoch is "${state.epoch.epochId}" (stale resolution after a context switch, J-012)`,
    );
  }
  if (probe.entryId != null) {
    const entry = state.derived.find((candidate) => candidate.id === probe.entryId);
    if (entry === undefined) {
      return deny(
        "entry_invalidated",
        `Operation "${probe.operation}" denied: derived entry "${probe.entryId}" is not active in epoch "${state.epoch.epochId}" (invalidated by a context switch, J-012)`,
      );
    }
  }

  return {
    verdict: "allowed",
    state,
    epochId: state.epoch.epochId,
    auditedAt: config.now,
  };
}
