/**
 * CoreGrid — resource-quota contract layered on the reliability lease
 * contracts (H3 wave Squad B, mission B-019 / J-031).
 *
 * WHAT: metered resource-quota admission — a typed ceiling on how much of a
 * named resource class a principal (tenant, or agent within a tenant) may
 * consume per bounded window, enforced fail-closed BEFORE consumption is
 * recorded. Where `leases.ts` owns the concurrency plane (single-holder,
 * fencing tokens, FIFO waiters), this module owns the VOLUME plane: a lease
 * answers "may this principal hold the resource now"; a quota answers "how
 * much of this resource may this principal use in this window".
 *
 * The layering is explicit: a consumption may be presented WITH a lease
 * binding (`LeaseHandleRef` from `./leases`, read-only import). When a lease
 * binding is presented, the authority consults an injected lease plane and
 * FAILS CLOSED unless the binding is the currently-live, holder-matching
 * fencing token on that target. No lease plane configured + lease binding
 * presented = denial, never a bypass.
 *
 * Laws of this module:
 * - Fail-closed admission: an undeclared (scope, principal, resource-class)
 *   triple admits nothing (`undeclared_quota`); a principal at its ceiling is
 *   denied `quota_exhausted` with a structured detail (scope, principal,
 *   class, limit, consumed, window bounds, retry time). Zero-limit ceilings
 *   deny everything. There is no permissive default and no silent overflow.
 * - Bounded declarations: every ceiling carries a provenance record (who
 *   declared it, under which authority, when — AGENTS §12), a positive whole
 *   unit limit under a hard ceiling, and a window no larger than
 *   `MAX_QUOTA_WINDOW_MS`. No unbounded windows, no unbounded budgets.
 * - One binding per (scope, principalRef, resourceClass): a duplicate
 *   declaration is a parse failure, never a silent override.
 * - Fixed windows anchored at the epoch, evaluated lazily from the injected
 *   clock; a rolled-over window restores capacity exactly and only then.
 *   All time flows from the injected clock (AdapterClock pattern); nothing
 *   runs implicitly and no timers are set.
 * - Denials are audited, never silent: every admission and denial is an
 *   append-only in-memory event, with a DB-backed sink injectable through
 *   the event hook. Observability must never break containment.
 *
 * Pure in-process contract: no I/O, no persistence, no vendors, no secrets.
 */

import { z } from "zod";
import { systemClock, type AdapterClock } from "../adapters/failure-policy";
import type { FenceResult, LeaseHandleRef, LeasePrincipal } from "./leases";

/* ─────────────────────────────────────────────────────────────
 * Ceilings (no unbounded quota declarations)
 * ────────────────────────────────────────────────────────────*/

/** Hard ceiling on any per-window quota budget, in resource units. */
export const MAX_UNITS_PER_WINDOW = 1_000_000_000;

/** Hard ceiling on any quota window length, in ms (24h). */
export const MAX_QUOTA_WINDOW_MS = 86_400_000;

/** Hard ceiling on units accepted by a single consumption request. */
export const MAX_UNITS_PER_CONSUMPTION = 1_000_000;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

const REF_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;

function refSchema(label: string) {
  return z
    .string()
    .regex(
      REF_PATTERN,
      `${label} must be a lowercase identifier (letters, digits, _ . : -; starts with a letter; at most 128 characters)`,
    );
}

export const resourceClassSchema = refSchema("resourceClass");
export type ResourceClass = z.infer<typeof resourceClassSchema>;

export const quotaProvenanceSchema = z.strictObject({
  /** Who made the declaration (role or principal reference, not a secret). */
  declaredBy: z
    .string()
    .min(1, "provenance.declaredBy must be a non-empty string")
    .refine((value) => value.trim().length > 0, "provenance.declaredBy must not be blank"),
  /** Under which authority the declaration was made (AGENTS §43). */
  authority: z
    .string()
    .min(1, "provenance.authority must be a non-empty string")
    .refine((value) => value.trim().length > 0, "provenance.authority must not be blank"),
  /** ISO-8601 timestamp of the declaration. */
  declaredAt: z.string().datetime(),
});

export type QuotaProvenance = z.infer<typeof quotaProvenanceSchema>;

export const quotaScopeSchema = z.enum(["tenant", "agent"]);
export type QuotaScope = z.infer<typeof quotaScopeSchema>;

/**
 * One quota binding: how much of one resource class one principal may
 * consume per bounded window. A missing binding admits nothing.
 */
export const quotaCeilingSchema = z.strictObject({
  scope: quotaScopeSchema,
  principalRef: refSchema("principalRef"),
  resourceClass: resourceClassSchema,
  /** Maximum units consumable per window; 0 is a valid deny-all binding. */
  maxUnitsPerWindow: z
    .number()
    .int()
    .min(0)
    .max(MAX_UNITS_PER_WINDOW, `maxUnitsPerWindow exceeds the hard ceiling of ${MAX_UNITS_PER_WINDOW}`),
  /** Fixed window length in ms; bounded, anchored at the epoch. */
  windowMs: z
    .number()
    .int()
    .positive()
    .max(MAX_QUOTA_WINDOW_MS, `windowMs exceeds the bounded maximum of ${MAX_QUOTA_WINDOW_MS}ms`),
  provenance: quotaProvenanceSchema,
});

export type QuotaCeiling = z.infer<typeof quotaCeilingSchema>;

export const resourceQuotaRegistrySchema = z.strictObject({
  ceilings: z.array(quotaCeilingSchema).min(1, "a quota registry must declare at least one ceiling"),
});

export type ResourceQuotaRegistryInput = z.infer<typeof resourceQuotaRegistrySchema>;

/** A validated, duplicate-free quota registry produced only by parsing. */
export interface ResourceQuotaRegistry {
  readonly ceilings: readonly QuotaCeiling[];
}

export type ResourceQuotaRegistryParseResult =
  | { ok: true; registry: ResourceQuotaRegistry }
  | { ok: false; reason: "invalid_registry"; issues: readonly string[] };

export function parseResourceQuotaRegistry(input: unknown): ResourceQuotaRegistryParseResult {
  const parsed = resourceQuotaRegistrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_registry",
      issues: parsed.error.issues.map((issue) => {
        const path = issue.path.map(String).join(".");
        return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }
  const seen = new Set<string>();
  for (const ceiling of parsed.data.ceilings) {
    const key = `${ceiling.scope}:${ceiling.principalRef}:${ceiling.resourceClass}`;
    if (seen.has(key)) {
      return {
        ok: false,
        reason: "invalid_registry",
        issues: [`duplicate quota binding for ${key}: one binding per scope, principal and resource class`],
      };
    }
    seen.add(key);
  }
  return { ok: true, registry: { ceilings: parsed.data.ceilings } };
}

/* ─────────────────────────────────────────────────────────────
 * Admission results
 * ────────────────────────────────────────────────────────────*/

export type ResourceQuotaDenialReason =
  | "invalid_input"
  | "undeclared_quota"
  | "quota_exhausted"
  | "lease_not_active"
  | "lease_plane_unavailable";

/** Structured over-quota detail carried on every exhaustion denial. */
export interface QuotaExhaustionDetail {
  readonly scope: QuotaScope;
  readonly principalRef: string;
  readonly resourceClass: ResourceClass;
  readonly limit: number;
  readonly consumedInWindow: number;
  readonly windowStartedAtMs: number;
  readonly windowEndsAtMs: number;
  /** Earliest time capacity is restored (the fixed-window rollover). */
  readonly retryAtMs: number;
}

export interface ConsumptionRequest {
  readonly principal: LeasePrincipal;
  readonly resourceClass: ResourceClass;
  /** Units requested; a positive whole number under the per-call ceiling. */
  readonly units: number;
  /**
   * Optional lease binding: when presented, consumption is admitted only if
   * this is the live, holder-matching fencing token on that target according
   * to the injected lease plane.
   */
  readonly lease?: LeaseHandleRef;
}

export type ConsumeResult =
  | {
      ok: true;
      scopeLedgers: readonly {
        readonly scope: QuotaScope;
        readonly consumedInWindow: number;
        readonly remainingInWindow: number;
        readonly windowEndsAtMs: number;
      }[];
      readonly units: number;
      readonly leaseFencingToken: number | null;
    }
  | {
      ok: false;
      reason: ResourceQuotaDenialReason;
      detail: string;
      quota: QuotaExhaustionDetail | null;
    };

/** The structural lease-plane surface this authority depends on. */
export interface QuotaLeasePlane {
  assertFencingToken(request: LeaseHandleRef): FenceResult;
}

/* ─────────────────────────────────────────────────────────────
 * Observation
 * ────────────────────────────────────────────────────────────*/

export interface QuotaScopeSnapshot {
  readonly scope: QuotaScope;
  readonly principalRef: string;
  readonly resourceClass: ResourceClass;
  readonly declared: boolean;
  /** 0 when undeclared (fail-closed view). */
  readonly limit: number;
  readonly consumedInWindow: number;
  /** null when undeclared: no capacity is assumed, none is promised. */
  readonly remainingInWindow: number | null;
  readonly windowEndsAtMs: number | null;
}

/* ─────────────────────────────────────────────────────────────
 * Audit events (denials are never silent)
 * ────────────────────────────────────────────────────────────*/

export type ResourceQuotaAuditEvent =
  | {
      kind: "quota_consumed";
      scopeLedgers: readonly { scope: QuotaScope; principalRef: string; consumedInWindow: number }[];
      resourceClass: ResourceClass;
      units: number;
      leaseFencingToken: number | null;
      atMs: number;
    }
  | {
      kind: "quota_denied";
      scope: QuotaScope | null;
      principalRef: string;
      resourceClass: ResourceClass;
      reason: ResourceQuotaDenialReason;
      detail: string;
      atMs: number;
    };

/* ─────────────────────────────────────────────────────────────
 * Configuration (fail fast on misconfiguration at construction)
 * ────────────────────────────────────────────────────────────*/

export interface ResourceQuotaAuthorityConfig {
  /** A validated registry from `parseResourceQuotaRegistry`. */
  readonly registry: ResourceQuotaRegistry;
  /** Injectable clock; defaults to the system clock. */
  readonly clock?: AdapterClock;
  /** Lease plane consulted when a consumption presents a lease binding. */
  readonly leasePlane?: QuotaLeasePlane;
  /** Observability sink for consumptions and denials. */
  readonly onEvent?: (event: ResourceQuotaAuditEvent) => void;
}

/* ─────────────────────────────────────────────────────────────
 * Authority
 * ────────────────────────────────────────────────────────────*/

interface WindowLedger {
  readonly windowIndex: number;
  readonly windowMs: number;
  consumed: number;
}

interface BindingEntry {
  readonly ceiling: QuotaCeiling;
}

/**
 * Fail-closed metered-quota admission over declared ceilings, layered on the
 * lease plane. See the module header for the laws of this class.
 */
export class ResourceQuotaAuthority {
  private readonly clock: AdapterClock;
  private readonly leasePlane: QuotaLeasePlane | null;
  private readonly onEvent: ((event: ResourceQuotaAuditEvent) => void) | null;
  private readonly tenants = new Map<string, BindingEntry>();
  private readonly agents = new Map<string, BindingEntry>();
  private readonly ledgers = new Map<string, WindowLedger>();
  private readonly auditLog: ResourceQuotaAuditEvent[] = [];
  private deniedTotal = 0;
  private consumedTotalUnits = 0;

  constructor(config: ResourceQuotaAuthorityConfig) {
    if (!Number.isFinite(config.registry?.ceilings?.length ?? 0) || config.registry.ceilings.length === 0) {
      throw new TypeError(
        "ResourceQuotaAuthority.registry must be a parsed registry with at least one ceiling",
      );
    }
    this.clock = config.clock ?? systemClock;
    this.leasePlane = config.leasePlane ?? null;
    this.onEvent = config.onEvent ?? null;
    for (const ceiling of config.registry.ceilings) {
      const map = ceiling.scope === "tenant" ? this.tenants : this.agents;
      map.set(`${ceiling.principalRef}:${ceiling.resourceClass}`, { ceiling });
    }
  }

  /* ── Admission: consume (lease binding first, then quota, in order) ── */

  consume(request: ConsumptionRequest): ConsumeResult {
    const now = this.clock.nowMs();
    const invalid = this.validateRequest(request);
    if (invalid !== null) return this.deny(request, invalid.scope, invalid.reason, invalid.detail, null, now);

    // Layer 1 — the lease plane. A presented lease binding must be the live,
    // holder-matching token; a missing lease plane is a denial, not a bypass.
    if (request.lease !== undefined) {
      if (this.leasePlane === null) {
        return this.deny(
          request,
          "tenant",
          "lease_plane_unavailable",
          "a lease binding was presented but no lease plane is configured; lease-backed admission fails closed",
          null,
          now,
        );
      }
      const fence = this.leasePlane.assertFencingToken(request.lease);
      if (!fence.ok) {
        return this.deny(request, "tenant", "lease_not_active", `lease binding rejected: ${fence.detail}`, null, now);
      }
      const bindingPrincipal = request.lease.principal;
      if (
        bindingPrincipal.tenantRef !== request.principal.tenantRef ||
        bindingPrincipal.agentRef !== request.principal.agentRef
      ) {
        return this.deny(
          request,
          "tenant",
          "lease_not_active",
          "the presented lease binding belongs to a different principal than the consumer; consumption fails closed",
          null,
          now,
        );
      }
    }

    // Layer 2 — fail-closed quota admission, tenant then agent; the first
    // breach denies. Undeclared principals admit nowhere.
    const classKey = request.resourceClass;
    const tenantBinding = this.tenants.get(`${request.principal.tenantRef}:${classKey}`) ?? null;
    if (tenantBinding === null) {
      return this.deny(
        request,
        "tenant",
        "undeclared_quota",
        `tenant ${request.principal.tenantRef} has no declared ceiling for resource class ${classKey}; admission fails closed`,
        null,
        now,
      );
    }
    const agentRef = request.principal.agentRef;
    let agentBinding: BindingEntry | null = null;
    if (agentRef !== null) {
      agentBinding = this.agents.get(`${agentRef}:${classKey}`) ?? null;
      if (agentBinding === null) {
        return this.deny(
          request,
          "agent",
          "undeclared_quota",
          `agent ${agentRef} has no declared ceiling for resource class ${classKey}; admission fails closed`,
          null,
          now,
        );
      }
    }

    const checks: readonly { binding: BindingEntry; scope: QuotaScope; principalRef: string }[] =
      agentBinding === null || agentRef === null
        ? [{ binding: tenantBinding, scope: "tenant", principalRef: request.principal.tenantRef }]
        : [
            { binding: tenantBinding, scope: "tenant", principalRef: request.principal.tenantRef },
            { binding: agentBinding, scope: "agent", principalRef: agentRef },
          ];

    // Two-pass admission: every scope in scope must clear its ceiling BEFORE
    // any ledger is mutated — a denied consumption leaves no partial charge.
    const admitted: { ledger: WindowLedger; ceiling: QuotaCeiling; scope: QuotaScope; principalRef: string }[] = [];
    for (const check of checks) {
      const ledger = this.ledgerFor(check.binding.ceiling, now);
      const limit = check.binding.ceiling.maxUnitsPerWindow;
      if (ledger.consumed + request.units > limit) {
        const windowStartedAtMs = ledger.windowIndex * ledger.windowMs;
        const windowEndsAtMs = windowStartedAtMs + ledger.windowMs;
        return this.deny(
          request,
          check.scope,
          "quota_exhausted",
          `${check.scope} ${check.principalRef} is at its ${classKey} ceiling: ${ledger.consumed}/${limit} units consumed in the current window`,
          {
            scope: check.scope,
            principalRef: check.principalRef,
            resourceClass: classKey,
            limit,
            consumedInWindow: ledger.consumed,
            windowStartedAtMs,
            windowEndsAtMs,
            retryAtMs: windowEndsAtMs,
          },
          now,
        );
      }
      admitted.push({ ledger, ceiling: check.binding.ceiling, scope: check.scope, principalRef: check.principalRef });
    }
    const scopeLedgers: { scope: QuotaScope; consumedInWindow: number; remainingInWindow: number; windowEndsAtMs: number }[] =
      [];
    for (const pass of admitted) {
      pass.ledger.consumed += request.units;
      scopeLedgers.push({
        scope: pass.scope,
        consumedInWindow: pass.ledger.consumed,
        remainingInWindow: pass.ceiling.maxUnitsPerWindow - pass.ledger.consumed,
        windowEndsAtMs: pass.ledger.windowIndex * pass.ledger.windowMs + pass.ledger.windowMs,
      });
    }

    this.consumedTotalUnits += request.units;
    const leaseFencingToken = request.lease === undefined ? null : request.lease.fencingToken;
    this.emit(
      {
        kind: "quota_consumed",
        scopeLedgers: scopeLedgers.map((s) => ({
          scope: s.scope,
          principalRef:
            s.scope === "tenant"
              ? request.principal.tenantRef
              : (agentRef as string),
          consumedInWindow: s.consumedInWindow,
        })),
        resourceClass: classKey,
        units: request.units,
        leaseFencingToken,
        atMs: now,
      },
    );
    return { ok: true, scopeLedgers, units: request.units, leaseFencingToken };
  }

  /* ── Observation ── */

  /** Fail-closed view of a principal's declared (and undeclared) capacity. */
  snapshot(principal: LeasePrincipal, resourceClass: ResourceClass): readonly QuotaScopeSnapshot[] {
    const now = this.clock.nowMs();
    const snapshots: QuotaScopeSnapshot[] = [];
    const scopes: readonly { scope: QuotaScope; principalRef: string }[] = [
      { scope: "tenant", principalRef: principal.tenantRef },
      ...(principal.agentRef === null ? [] : [{ scope: "agent" as const, principalRef: principal.agentRef }]),
    ];
    for (const { scope, principalRef } of scopes) {
      const binding =
        scope === "tenant"
          ? (this.tenants.get(`${principalRef}:${resourceClass}`) ?? null)
          : (this.agents.get(`${principalRef}:${resourceClass}`) ?? null);
      if (binding === null) {
        snapshots.push({
          scope,
          principalRef,
          resourceClass,
          declared: false,
          limit: 0,
          consumedInWindow: 0,
          remainingInWindow: null,
          windowEndsAtMs: null,
        });
        continue;
      }
      const ledger = this.ledgerFor(binding.ceiling, now);
      const windowEndsAtMs = ledger.windowIndex * ledger.windowMs + ledger.windowMs;
      snapshots.push({
        scope,
        principalRef,
        resourceClass,
        declared: true,
        limit: binding.ceiling.maxUnitsPerWindow,
        consumedInWindow: ledger.consumed,
        remainingInWindow: binding.ceiling.maxUnitsPerWindow - ledger.consumed,
        windowEndsAtMs,
      });
    }
    return snapshots;
  }

  /** Immutable audit trail: every consumption and denial. */
  auditTrail(): readonly ResourceQuotaAuditEvent[] {
    return [...this.auditLog];
  }

  totals(): { consumedUnits: number; denied: number; events: number } {
    return {
      consumedUnits: this.consumedTotalUnits,
      denied: this.deniedTotal,
      events: this.auditLog.length,
    };
  }

  /**
   * Drop ledgers whose fixed windows have rolled over and cannot be
   * resurrected by any clock the authority can observe (windows are anchored
   * at the epoch, so a past index can never recur). Returns the count.
   */
  pruneClosedWindows(): number {
    const now = this.clock.nowMs();
    let pruned = 0;
    for (const [key, ledger] of this.ledgers) {
      if ((ledger.windowIndex + 1) * ledger.windowMs <= now) {
        this.ledgers.delete(key);
        pruned += 1;
      }
    }
    return pruned;
  }

  /* ── Internals ── */

  private ledgerFor(ceiling: QuotaCeiling, now: number): WindowLedger {
    const windowIndex = Math.floor(now / ceiling.windowMs);
    const key = `${ceiling.scope}:${ceiling.principalRef}:${ceiling.resourceClass}:${windowIndex}`;
    const existing = this.ledgers.get(key);
    if (existing !== undefined) return existing;
    const created: WindowLedger = { windowIndex, windowMs: ceiling.windowMs, consumed: 0 };
    this.ledgers.set(key, created);
    return created;
  }

  private validateRequest(
    request: ConsumptionRequest,
  ): { reason: ResourceQuotaDenialReason; detail: string; scope: QuotaScope | null } | null {
    const principal = request?.principal;
    if (principal === null || principal === undefined || typeof principal !== "object") {
      return { reason: "invalid_input", detail: "principal is required", scope: null };
    }
    if (typeof principal.tenantRef !== "string" || principal.tenantRef.trim() === "") {
      return { reason: "invalid_input", detail: "principal.tenantRef must be a non-empty string", scope: null };
    }
    if (
      principal.agentRef !== null &&
      (typeof principal.agentRef !== "string" || principal.agentRef.trim() === "")
    ) {
      return { reason: "invalid_input", detail: "principal.agentRef must be null or a non-empty string", scope: null };
    }
    if (typeof request.resourceClass !== "string" || !resourceClassSchema.safeParse(request.resourceClass).success) {
      return { reason: "invalid_input", detail: "resourceClass must be a lowercase identifier", scope: null };
    }
    const units = request.units;
    if (!Number.isFinite(units) || !Number.isInteger(units) || units <= 0) {
      return { reason: "invalid_input", detail: "units must be a positive whole number", scope: null };
    }
    if (units > MAX_UNITS_PER_CONSUMPTION) {
      return {
        reason: "invalid_input",
        detail: `units exceeds the per-consumption ceiling of ${MAX_UNITS_PER_CONSUMPTION}`,
        scope: null,
      };
    }
    const lease = request.lease;
    if (lease !== undefined) {
      const leaseRecord = lease as unknown as Record<string, unknown>;
      const hasShape =
        typeof leaseRecord.target === "object" &&
        leaseRecord.target !== null &&
        typeof leaseRecord.leaseId === "string" &&
        typeof leaseRecord.fencingToken === "number" &&
        typeof leaseRecord.principal === "object" &&
        leaseRecord.principal !== null;
      if (!hasShape) {
        return { reason: "invalid_input", detail: "lease binding must be a complete lease handle reference", scope: null };
      }
      if (
        typeof leaseRecord.principal === "object" &&
        leaseRecord.principal !== null &&
        (leaseRecord.principal as LeasePrincipal).tenantRef !== principal.tenantRef
      ) {
        return {
          reason: "invalid_input",
          detail: "the lease binding names a different tenant than the consuming principal",
          scope: null,
        };
      }
    }
    return null;
  }

  private deny(
    request: ConsumptionRequest,
    scope: QuotaScope | null,
    reason: ResourceQuotaDenialReason,
    detail: string,
    quota: QuotaExhaustionDetail | null,
    now: number,
  ): ConsumeResult {
    this.deniedTotal += 1;
    this.emit(
      {
        kind: "quota_denied",
        scope,
        principalRef: scope === "agent" ? (request.principal?.agentRef ?? "") : (request.principal?.tenantRef ?? ""),
        resourceClass: typeof request.resourceClass === "string" ? request.resourceClass : "",
        reason,
        detail,
        atMs: now,
      },
      );
    return { ok: false, reason, detail, quota };
  }

  private emit(event: ResourceQuotaAuditEvent): void {
    this.auditLog.push(event);
    if (this.onEvent === null) return;
    try {
      this.onEvent(event);
    } catch {
      // Observability must never break containment.
    }
  }
}

export function createResourceQuotaAuthority(config: ResourceQuotaAuthorityConfig): ResourceQuotaAuthority {
  return new ResourceQuotaAuthority(config);
}
