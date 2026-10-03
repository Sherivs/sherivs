/**
 * CoreGrid — Phase 45 AI Compute Civilization Engine: compute-offer clearance
 * contracts (H3 wave Squad G, mission G-065, Contract Architect role).
 *
 * WHAT: the typed, fail-closed contract surface for the phase-45 substrate —
 * GOVERNED COMPUTE OFFER CLEARANCE. A compute offer joins CoreGrid as a
 * declaration (capacity, workload kinds, residency, isolation, metering
 * rate); a workload requests compute against an offer; the decision is
 * ALLOW or DENY with typed reasons. Under the phase-45 kernel contract the
 * principle is: compute is METERED and GOVERNED — every workload declares
 * its purpose, budget, metering key and residency, and unmetered or
 * undeclared compute is refused.
 *
 * WHERE/WHY: phase 45 canonically owns compute registration, serving
 * capacity, scheduling and compute governance (phase-45 acceptance map;
 * kernel seed `kernel/phase-contracts/phase-45-ai-compute.ts`). This module
 * encodes the SEMANTICS of that ownership as pure contracts:
 *   - a compute offer descriptor (bounded capacity, explicit metering rate,
 *     explicit residency scope, fail-closed tenant scoping)
 *   - an allocation request carrying a gateway purpose, a metering key, a
 *     budget commitment and a residency constraint (AGENTS §12 provenance)
 *   - a server-resolved clearance context (the caller NEVER supplies the
 *     tenant, the offer snapshot or the metering ledger — §26/§27)
 *   - an ALLOW/DENY decision that FAILS CLOSED: every missing, malformed,
 *     unresolvable, unmetered, over-budget or cross-tenant input denies
 *     with a typed reason
 *   - a tenant-scoped capacity-status read projection (cross-tenant rows
 *     are never returned to a client)
 *
 * UNDER WHICH POLICY: AGENTS §16 (layered authorization, DENY result),
 * §20 (ALL AI operations route through the centralized AI gateway — an
 * allowed allocation carries invocationPath "gateway" and compute
 * allocation never becomes a second path to models), §21 (compute is
 * capacity, never autonomy), §26 (never trust client tenant/role fields),
 * §27 (server functions authenticate → resolve tenant → authorize →
 * validate → execute → audit → return permitted data), §12 (provenance),
 * §31 (tenant A cannot act on tenant B); phase-45 acceptance map. Platform
 * primitives are consumed READ-ONLY: canonical ref law from
 * `kernel/domain-manifest.ts`, gateway-purpose vocabulary locked in
 * lockstep with `metering/usage-ledger.ts` so the vocabularies cannot
 * drift.
 *
 * BOUNDARY: pure typed CONTRACT module — no I/O, no persistence, no vendor
 * imports, no secrets, no timers (all instants flow in from the caller).
 * Model routing, serving and invocation remain owned by the phase-26
 * gateway; the reliability contracts own volumetric quota enforcement; this
 * module only governs what compute may be OFFERED and ADMITTED. Domain-
 * neutral throughout (J-037): no education vocabulary anywhere.
 */

import { z } from "zod";
import { isValidManifestId } from "../kernel/domain-manifest";

/* ─────────────────────────────────────────────────────────────
 * Hard ceilings (no unbounded compute declarations)
 * ────────────────────────────────────────────────────────────*/

export const MAX_OFFER_CAPACITY_UNITS = 1_000_000;
export const MAX_REQUESTED_CONCURRENCY = 100_000;
export const MAX_DURATION_SECONDS = 604_800; // 7 days
export const MAX_SNAPSHOT_OFFERS = 10_000;
export const MAX_METERING_LEDGER_ENTRIES = 10_000;
export const MAX_ALLOWED_REGIONS = 256;
export const MAX_DECISION_DETAIL_ITEMS = 20;

/** Cost projection precision (matches the usage-ledger rounding law). */
const COST_PRECISION = 1e6;

function roundCost(value: number): number {
  return Math.round(value * COST_PRECISION) / COST_PRECISION;
}

/* ─────────────────────────────────────────────────────────────
 * Shared primitives
 * ────────────────────────────────────────────────────────────*/

const REF_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;
/** Strict RFC-3339 instant (UTC), e.g. 2026-10-03T00:00:00.000Z. */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function refSchema(label: string) {
  return z
    .string()
    .regex(
      REF_PATTERN,
      `${label} must be a lowercase reference identifier (letters, digits, _ . : -; starts with a letter; at most 128 characters)`,
    );
}

export const isoInstantSchema = z
  .string()
  .regex(ISO_INSTANT_PATTERN, "must be a UTC RFC-3339 instant (e.g. 2026-10-03T00:00:00.000Z)")
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a parseable instant");

/**
 * Canonical compute-offer reference. Validated against the kernel manifest
 * id law (read-only import) AND pinned to the phase-45 `compute:` namespace —
 * phase 45 only registers compute offers, never other kernel objects.
 */
export const computeOfferRefSchema = z
  .string()
  .refine(isValidManifestId, "must be a canonical kernel manifest id of the form <namespace>:<slug>")
  .refine((value) => value.startsWith("compute:"), 'must use the canonical "compute:" namespace');

/**
 * Gateway-purpose vocabulary, kept in lockstep with the metering usage
 * ledger by construction (lockstep assertion in the test suite; the ledger
 * owns the canonical list — this module never widens it).
 */
export const COMPUTE_GATEWAY_PURPOSES = [
  "summarization",
  "classification",
  "drafting",
  "extraction",
  "support",
  "workflow_assistance",
] as const;

export type ComputeGatewayPurpose = (typeof COMPUTE_GATEWAY_PURPOSES)[number];

export const computeGatewayPurposeSchema = z.enum(COMPUTE_GATEWAY_PURPOSES);

/* ─────────────────────────────────────────────────────────────
 * Offer lifecycle (phase-45 compute state machine, clearance slice)
 * ────────────────────────────────────────────────────────────*/

/**
 * Offer statuses relevant to clearance. The phase-45 state machine
 * (registered → validated → available → allocated → … → retired) is encoded
 * as a transition law below; only `available` offers admit workloads.
 */
export const COMPUTE_OFFER_STATUSES = [
  "registered",
  "validated",
  "available",
  "allocated",
  "maintenance",
  "retired",
] as const;

export type ComputeOfferStatus = (typeof COMPUTE_OFFER_STATUSES)[number];

export const computeOfferStatusSchema = z.enum(COMPUTE_OFFER_STATUSES);

export const OFFER_STATUS_TRANSITIONS: Readonly<
  Record<ComputeOfferStatus, readonly ComputeOfferStatus[]>
> = {
  registered: ["validated", "retired"],
  validated: ["available", "retired"],
  available: ["allocated", "maintenance", "retired"],
  allocated: ["available", "maintenance", "retired"],
  maintenance: ["available", "retired"],
  retired: [],
};

/** Kernel-grade transition law for compute offers. */
export function canTransitionOfferStatus(
  from: ComputeOfferStatus,
  to: ComputeOfferStatus,
): boolean {
  return OFFER_STATUS_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Compute offer descriptor (the registration payload — data, not code)
 * ────────────────────────────────────────────────────────────*/

/** Neutral workload kinds compute capacity can be offered for. */
export const WORKLOAD_KINDS = ["serving", "training", "batch", "reasoning"] as const;

export type WorkloadKind = (typeof WORKLOAD_KINDS)[number];

export const workloadKindSchema = z.enum(WORKLOAD_KINDS);

export const computeOfferDescriptorSchema = z
  .strictObject({
    offerRef: computeOfferRefSchema,
    name: z.string().min(1).max(128),
    summary: z.string().min(1).max(512),
    /** Workload kinds this capacity may serve; empty offers cannot register. */
    workloadKinds: z.array(workloadKindSchema).min(1).max(WORKLOAD_KINDS.length),
    capacity: z.strictObject({
      /** Maximum concurrent workloads the offer can host. */
      maxConcurrentWorkloads: z.number().int().min(1).max(MAX_OFFER_CAPACITY_UNITS),
      /**
       * Declared metering rate (USD per compute-unit-hour). An offer without
       * an explicit finite positive rate is UNMETERED and cannot register —
       * unmetered compute is refused by the phase-45 principle.
       */
      unitRateUsdPerHour: z.number().finite().gt(0),
    }),
    residency: z.strictObject({
      /** Posture: capacity pinned to its declared region set. */
      mode: z.enum(["pinned_regions"]),
      /** Allowed placement regions (canonical region references). */
      allowedRegions: z.array(refSchema("regionRef")).min(1).max(MAX_ALLOWED_REGIONS),
    }),
    isolation: z.strictObject({
      /**
       * Fail-closed: only `true` parses. An offer that does not explicitly
       * declare tenant scoping cannot register at all (AGENTS §13, §17).
       */
      tenantScoped: z.literal(true),
      /** Egress posture; the least-privilege value must be declared explicitly. */
      egress: z.enum(["none", "allowlisted"]),
    }),
  })
  .superRefine((offer, ctx) => {
    const regions = new Set<string>();
    offer.residency.allowedRegions.forEach((region, index) => {
      if (regions.has(region)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate allowed region "${region}"`,
          path: ["residency", "allowedRegions", index],
        });
      }
      regions.add(region);
    });

    const kinds = new Set<string>();
    offer.workloadKinds.forEach((kind, index) => {
      if (kinds.has(kind)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate workload kind "${kind}"`,
          path: ["workloadKinds", index],
        });
      }
      kinds.add(kind);
    });
  });

export type ComputeOfferDescriptor = z.infer<typeof computeOfferDescriptorSchema>;

/* ─────────────────────────────────────────────────────────────
 * Provenance (AGENTS §12 — every request answers WHO/WHEN/WHY)
 * ────────────────────────────────────────────────────────────*/

export const allocationProvenanceSchema = z.strictObject({
  /** Requesting actor or role REFERENCE — never a credential. */
  requestedBy: refSchema("requestedBy"),
  /** Governing authority the request is made under (policy/mission citation). */
  authority: z.string().min(1).max(256),
  requestedAt: isoInstantSchema,
  justification: z.string().min(1).max(512),
});

export type AllocationProvenance = z.infer<typeof allocationProvenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Allocation request (governed, metered — fail closed on omission)
 * ────────────────────────────────────────────────────────────*/

export const computeAllocationRequestSchema = z.strictObject({
    /** Neutral workload kind being scheduled. */
    workloadKind: workloadKindSchema,
    /**
     * §20: every compute request names the gateway purpose it serves. An
     * allocation is capacity FOR a governed inference path, never a
     * substitute for it.
     */
    gatewayPurpose: computeGatewayPurposeSchema,
    offerRef: computeOfferRefSchema,
    /** Concurrent compute units requested. */
    requestedConcurrency: z.number().int().min(1).max(MAX_REQUESTED_CONCURRENCY),
    /** Bounded reservation duration in seconds. */
    maxDurationSeconds: z.number().int().min(1).max(MAX_DURATION_SECONDS),
    /** Required placement region (must be inside the offer's residency). */
    requiredRegion: refSchema("regionRef"),
    /**
     * Metering commitment: the per-allocation cost ceiling and the metering
     * key consumption is attributed to. A request without both is
     * UNMETERED and is refused.
     */
    budget: z.strictObject({
      maxCostUsd: z.number().finite().gt(0),
      meteringKey: refSchema("meteringKey"),
    }),
    provenance: allocationProvenanceSchema,
  });

export type ComputeAllocationRequest = z.infer<typeof computeAllocationRequestSchema>;

/* ─────────────────────────────────────────────────────────────
 * Server-resolved clearance context
 * (the caller NEVER supplies tenant, offers or metering — §26/§27)
 * ────────────────────────────────────────────────────────────*/

export const offerSnapshotRowSchema = z.strictObject({
  offerRef: computeOfferRefSchema,
  /** Owning tenant of the offer — resolved server-side. */
  tenantRef: refSchema("tenantRef"),
  status: computeOfferStatusSchema,
  workloadKinds: z.array(workloadKindSchema).min(1),
  /** Concurrency units currently available on the offer. */
  availableConcurrency: z.number().int().min(0),
  /**
   * Declared metering rate (USD per compute-unit-hour), carried from the
   * registered descriptor. A row without a finite positive rate cannot
   * price a reservation and clearance fails closed.
   */
  unitRateUsdPerHour: z.number().finite().gt(0),
  /** Declared residency scope, carried from the registered descriptor. */
  allowedRegions: z.array(refSchema("regionRef")).min(1),
});

export type OfferSnapshotRow = z.infer<typeof offerSnapshotRowSchema>;

export const meteringRowSchema = z.strictObject({
  meteringKey: refSchema("meteringKey"),
  /** Consumption already attributed to the key this period. */
  consumedCostUsd: z.number().finite().min(0),
  /** Period budget bound for the key (server-declared, not client-declared). */
  periodBudgetUsd: z.number().finite().min(0),
});

export type MeteringRow = z.infer<typeof meteringRowSchema>;

export const computeClearanceContextSchema = z
  .strictObject({
    actorRef: refSchema("actorRef"),
    resolvedTenantRef: refSchema("resolvedTenantRef"),
    /** Instant the context was resolved; every decision stamps this instant. */
    observedAt: isoInstantSchema,
    /** Offer snapshot visible to this tenant resolution. */
    offerSnapshot: z.array(offerSnapshotRowSchema).max(MAX_SNAPSHOT_OFFERS),
    /** Metering ledger slice for this tenant resolution. */
    meteringLedger: z.array(meteringRowSchema).max(MAX_METERING_LEDGER_ENTRIES),
  })
  .superRefine((ctx, zctx) => {
    const seen = new Set<string>();
    ctx.offerSnapshot.forEach((row, index) => {
      if (seen.has(row.offerRef)) {
        zctx.addIssue({
          code: "custom",
          message: `duplicate offerRef "${row.offerRef}" in snapshot`,
          path: ["offerSnapshot", index],
        });
      }
      seen.add(row.offerRef);
    });

    const keys = new Set<string>();
    ctx.meteringLedger.forEach((row, index) => {
      if (keys.has(row.meteringKey)) {
        zctx.addIssue({
          code: "custom",
          message: `duplicate meteringKey "${row.meteringKey}" in ledger`,
          path: ["meteringLedger", index],
        });
      }
      keys.add(row.meteringKey);
    });
  });

export type ComputeClearanceContext = z.infer<typeof computeClearanceContextSchema>;

/* ─────────────────────────────────────────────────────────────
 * Decisions (ALLOW / DENY — §16; denial always carries typed reasons)
 * ────────────────────────────────────────────────────────────*/

export const DENIAL_REASONS = [
  "invalid_request_shape",
  "invalid_context",
  "unknown_source",
  "unknown_offer",
  "offer_not_available",
  "workload_kind_unsupported",
  "residency_violation",
  "capacity_exhausted",
  "tenant_mismatch",
  "unmetered_request",
  "budget_exhausted",
] as const;

export type DenialReason = (typeof DENIAL_REASONS)[number];

export const denialReasonSchema = z.enum(DENIAL_REASONS);

/**
 * The ONLY execution path an allowed allocation carries. A literal, not a
 * field a caller can set: §20 routes every AI operation through the
 * centralized gateway, so compute clearance can never mint a second path
 * to models.
 */
export const ALLOWED_INVOCATION_PATH = "gateway" as const;

export const computeClearanceDecisionSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("allow"),
    workloadKind: workloadKindSchema,
    gatewayPurpose: computeGatewayPurposeSchema,
    offerRef: computeOfferRefSchema,
    tenantRef: refSchema("tenantRef"),
    meteringKey: refSchema("meteringKey"),
    /** Reserved concurrency units. */
    reservedConcurrency: z.number().int().min(1),
    /** Metered projection of the reservation cost (USD). */
    projectedCostUsd: z.number().finite().min(0),
    invocationPath: z.literal(ALLOWED_INVOCATION_PATH),
    decidedAt: isoInstantSchema,
    decidedBy: refSchema("actorRef"),
  }),
  z.strictObject({
    outcome: z.literal("deny"),
    workloadKind: workloadKindSchema.optional(),
    offerRef: computeOfferRefSchema.optional(),
    tenantRef: refSchema("tenantRef").optional(),
    meteringKey: refSchema("meteringKey").optional(),
    reasons: z.array(denialReasonSchema).min(1).max(DENIAL_REASONS.length),
    detail: z.array(z.string().max(300)).max(MAX_DECISION_DETAIL_ITEMS),
    decidedAt: isoInstantSchema,
    decidedBy: refSchema("actorRef").optional(),
  }),
]);

export type ComputeClearanceDecision = z.infer<typeof computeClearanceDecisionSchema>;

/* ─────────────────────────────────────────────────────────────
 * Fail-closed parsing (unknown input is untrusted; shape is proven)
 * ────────────────────────────────────────────────────────────*/

export type ComputeContractParse<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly string[] };

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return `${path.length > 0 ? path : "(root)"}: ${issue.message}`;
  });
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown): ComputeContractParse<T> {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: zodIssues(result.error) };
}

export function parseComputeOfferDescriptor(
  input: unknown,
): ComputeContractParse<ComputeOfferDescriptor> {
  return parseWith(computeOfferDescriptorSchema, input);
}

export function parseComputeAllocationRequest(
  input: unknown,
): ComputeContractParse<ComputeAllocationRequest> {
  return parseWith(computeAllocationRequestSchema, input);
}

export function parseComputeClearanceContext(
  input: unknown,
): ComputeContractParse<ComputeClearanceContext> {
  return parseWith(computeClearanceContextSchema, input);
}

export function parseComputeClearanceDecision(
  input: unknown,
): ComputeContractParse<ComputeClearanceDecision> {
  return parseWith(computeClearanceDecisionSchema, input);
}

/* ─────────────────────────────────────────────────────────────
 * The fail-closed clearance decision function
 * ────────────────────────────────────────────────────────────*/

function deny(
  request: ComputeAllocationRequest | undefined,
  context: ComputeClearanceContext | undefined,
  reasons: readonly DenialReason[],
  detail: readonly string[],
): ComputeClearanceDecision {
  return {
    outcome: "deny",
    workloadKind: request?.workloadKind,
    offerRef: request?.offerRef,
    tenantRef: context?.resolvedTenantRef,
    meteringKey: request?.budget.meteringKey,
    reasons: [...reasons],
    detail: detail.slice(0, MAX_DECISION_DETAIL_ITEMS),
    decidedAt: context?.observedAt ?? "1970-01-01T00:00:00.000Z",
    decidedBy: context?.actorRef,
  };
}

/**
 * Project the metered cost of an allocation:
 * concurrency × hours × the offer's declared unit rate.
 */
export function projectAllocationCostUsd(
  requestedConcurrency: number,
  maxDurationSeconds: number,
  unitRateUsdPerHour: number,
): number {
  return roundCost((maxDurationSeconds / 3600) * requestedConcurrency * unitRateUsdPerHour);
}

/**
 * Decide a compute allocation request against a server-resolved context.
 *
 * Fail-closed invariants:
 * - an unparseable request or context denies (never throws, never guesses);
 * - the tenant, offer snapshot and metering ledger come ONLY from the
 *   context (§26: never trust client-supplied tenant/role fields);
 * - the offer must exist in the snapshot, be owned by the resolved tenant
 *   (§31), be in `available` status, and support the requested workload kind;
 * - placement must satisfy the offer's residency scope;
 * - the request MUST be metered: a missing budget, an unknown metering key
 *   or a malformed ledger row refuses the allocation (unmetered compute is
 *   refused by the phase-45 principle);
 * - the metered projection must fit BOTH the per-allocation budget and the
 *   remaining period budget for the metering key;
 * - an allowed allocation carries invocationPath "gateway" (§20) — this
 *   module never grants model access, only governed capacity.
 */
export function decideComputeClearance(
  request: unknown,
  context: unknown,
): ComputeClearanceDecision {
  const parsedContext = parseComputeClearanceContext(context);
  if (!parsedContext.ok) {
    return deny(undefined, undefined, ["invalid_context"], parsedContext.issues);
  }
  const ctx = parsedContext.value;
  if (ctx.actorRef.length === 0 || ctx.resolvedTenantRef.length === 0) {
    return deny(undefined, ctx, ["unknown_source"], []);
  }

  const parsedRequest = parseComputeAllocationRequest(request);
  if (!parsedRequest.ok) {
    return deny(undefined, ctx, ["invalid_request_shape"], parsedRequest.issues);
  }
  const req = parsedRequest.value;

  const offer = ctx.offerSnapshot.find((row) => row.offerRef === req.offerRef);
  if (offer === undefined) {
    return deny(req, ctx, ["unknown_offer"], [
      `offerRef "${req.offerRef}" is not in the resolved offer snapshot`,
    ]);
  }
  if (offer.tenantRef !== ctx.resolvedTenantRef) {
    return deny(req, ctx, ["tenant_mismatch"], [
      "compute offer is registered to another tenant",
    ]);
  }
  if (offer.status !== "available") {
    return deny(req, ctx, ["offer_not_available"], [
      `offer status is "${offer.status}"; only "available" offers admit workloads`,
    ]);
  }
  if (!offer.workloadKinds.includes(req.workloadKind)) {
    return deny(req, ctx, ["workload_kind_unsupported"], [
      `offer does not support workload kind "${req.workloadKind}"`,
    ]);
  }
  if (!offer.allowedRegions.includes(req.requiredRegion)) {
    return deny(req, ctx, ["residency_violation"], [
      `required region "${req.requiredRegion}" is outside the offer's residency scope`,
    ]);
  }
  if (offer.availableConcurrency < req.requestedConcurrency) {
    return deny(req, ctx, ["capacity_exhausted"], [
      `requested ${req.requestedConcurrency} concurrent units but only ${offer.availableConcurrency} are available`,
    ]);
  }

  const meteringRow = ctx.meteringLedger.find((row) => row.meteringKey === req.budget.meteringKey);
  if (meteringRow === undefined) {
    return deny(req, ctx, ["unmetered_request"], [
      `metering key "${req.budget.meteringKey}" has no ledger row; unmetered compute is refused`,
    ]);
  }
  if (
    !Number.isFinite(meteringRow.periodBudgetUsd) ||
    meteringRow.periodBudgetUsd < 0 ||
    !Number.isFinite(meteringRow.consumedCostUsd) ||
    meteringRow.consumedCostUsd < 0
  ) {
    return deny(req, ctx, ["budget_exhausted"], [
      "metering ledger row is malformed (fail closed)",
    ]);
  }

  const projected = projectAllocationCostUsd(
    req.requestedConcurrency,
    req.maxDurationSeconds,
    offer.unitRateUsdPerHour,
  );
  const remaining = roundCost(meteringRow.periodBudgetUsd - meteringRow.consumedCostUsd);
  if (remaining <= 0) {
    return deny(req, ctx, ["budget_exhausted"], [
      "period budget for the metering key is exhausted",
    ]);
  }
  if (projected > req.budget.maxCostUsd) {
    return deny(req, ctx, ["budget_exhausted"], [
      `projected cost $${projected} exceeds the per-allocation budget $${req.budget.maxCostUsd}`,
    ]);
  }
  if (projected > remaining) {
    return deny(req, ctx, ["budget_exhausted"], [
      `projected cost $${projected} exceeds the remaining period budget $${remaining}`,
    ]);
  }

  return {
    outcome: "allow",
    workloadKind: req.workloadKind,
    gatewayPurpose: req.gatewayPurpose,
    offerRef: req.offerRef,
    tenantRef: ctx.resolvedTenantRef,
    meteringKey: req.budget.meteringKey,
    reservedConcurrency: req.requestedConcurrency,
    projectedCostUsd: projected,
    invocationPath: ALLOWED_INVOCATION_PATH,
    decidedAt: ctx.observedAt,
    decidedBy: ctx.actorRef,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Capacity-status read projection (tenant-scoped query surface)
 * ────────────────────────────────────────────────────────────*/

export const CLIENT_OFFER_POSTURE = ["available", "capacity_exhausted", "unavailable"] as const;

export type ClientOfferPosture = (typeof CLIENT_OFFER_POSTURE)[number];

export const capacityStatusRowSchema = z.strictObject({
  offerRef: computeOfferRefSchema,
  status: computeOfferStatusSchema,
  posture: z.enum(CLIENT_OFFER_POSTURE),
  availableConcurrency: z.number().int().min(0),
  workloadKinds: z.array(workloadKindSchema).min(1),
});

export type CapacityStatusRow = z.infer<typeof capacityStatusRowSchema>;

/**
 * Project a tenant-scoped capacity-status view from the server-resolved
 * snapshot. Cross-tenant rows are never returned (§27: return permitted
 * data); posture is derived, never optimistic — a non-`available` offer is
 * reported as "unavailable" even when units exist.
 */
export function capacityStatusForTenant(
  context: ComputeClearanceContext,
): CapacityStatusRow[] {
  return context.offerSnapshot
    .filter((row) => row.tenantRef === context.resolvedTenantRef)
    .map((row) => {
      const posture: ClientOfferPosture =
        row.status !== "available"
          ? "unavailable"
          : row.availableConcurrency > 0
            ? "available"
            : "capacity_exhausted";
      return {
        offerRef: row.offerRef,
        status: row.status,
        posture,
        availableConcurrency: row.availableConcurrency,
        workloadKinds: [...row.workloadKinds],
      };
    });
}