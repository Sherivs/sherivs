/**
 * CoreGrid — ESCALATE / REQUIRE_APPROVAL resolution-flow contracts
 * (J-032, mission B-020; Constitution §7, §12, §16, §21, §29).
 *
 * The authorization engine (§16) emits five decision outcomes. ALLOW, DENY
 * and REDACT are terminal in the engine. ESCALATE and REQUIRE_APPROVAL are
 * NOT terminal: they are deferred decisions that must be resolved by humans
 * before anything executes. This module is the wired resolution flow for
 * exactly those two outcomes:
 *
 *   authorization outcome (ESCALATE | REQUIRE_APPROVAL)
 *     → open a resolution case (content-addressed, provenance-bearing)
 *     → risk-classified routing to a human approval chain
 *     → human resolutions recorded (evidence-bearing, append-only)
 *     → typed flow outcome (approved | rejected | pending | blocked | invalid)
 *     → execution gate (human closure required; every decision audited)
 *
 * Laws encoded structurally:
 * - §16 — only ESCALATE and REQUIRE_APPROVAL enter this flow. A terminal
 *   engine decision (ALLOW / DENY / REDACT) is never routed here: opening a
 *   case from one fails closed with a typed code.
 * - §7 / §21 — AI proposes, humans resolve. The requester can never resolve
 *   its own case (independence), and an AI identity can never occupy a
 *   resolver position. Every risk tier mandates a depth of INDEPENDENT
 *   human resolvers; no tier resolves on AI authority alone.
 * - §12 — cases and resolutions are evidence-bearing provenance: who
 *   resolved, what (content-addressed subject digest), under which policy,
 *   when, with what capability and tenant evidence, and by what deadline.
 * - Fail-closed when no approver resolves: a chain that cannot possibly
 *   satisfy the mandated depth is BLOCKED at routing time, and a chain
 *   whose deadline passes without human closure is BLOCKED forever. Blocked
 *   is never downgraded to approved, and never silently dropped.
 * - Human closure before execution: the execution gate allows only the
 *   `approved` outcome — the mandated number of independent, eligible human
 *   resolutions, each with evidence. Every other outcome DENIES.
 * - Denial is a decision, not an exception: the gate never throws on an
 *   unmet flow; it returns DENIED plus an audit record naming every reason.
 *   A bypass path does not exist.
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no wall clock —
 * every instant is a supplied parameter. Vocabulary composes, not forks:
 * subject digests are the reasoning-provenance canonical digests, the
 * decision vocabulary is the authorization engine's §16 vocabulary, and
 * the human/ai identity split follows the workflow ApproverRef convention.
 * Persistence stays out: the durability adapter mission implements the
 * store behind these contracts without changing them.
 */

import { z } from "zod";
import { digestContent } from "../ai-gateway/reasoning-provenance";
import type { AuthorizationResult } from "../identity";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary — decisions, risk tiers and mandated resolution depth
 * ────────────────────────────────────────────────────────────*/

export const RESOLUTION_FLOW_SCHEMA_VERSION = "1.0";

/**
 * The §16 outcomes this flow resolves. ALLOW / DENY / REDACT are terminal
 * engine decisions and never enter the flow.
 */
export const RESOLUTION_FLOW_DECISIONS = [
  "ESCALATE",
  "REQUIRE_APPROVAL",
] as const;
export type ResolvableDecision = (typeof RESOLUTION_FLOW_DECISIONS)[number];

/** Identity kinds follow the workflow contract's ApproverRef human/ai split. */
export const RESOLUTION_IDENTITY_KINDS = ["human", "ai"] as const;
export type ResolutionIdentityKind = (typeof RESOLUTION_IDENTITY_KINDS)[number];

/**
 * Risk tiers for deferred decisions. Each tier mandates exactly one
 * resolution depth: how many independent human resolvers close the case.
 */
export const RESOLUTION_RISK_TIERS = ["routine", "elevated", "critical"] as const;
export type ResolutionRiskTier = (typeof RESOLUTION_RISK_TIERS)[number];

export const RESOLUTION_DEPTH_CLASSES = [
  "single-resolver",
  "two-person",
  "quorum",
] as const;
export type ResolutionDepthClass = (typeof RESOLUTION_DEPTH_CLASSES)[number];

export const DEPTH_MINIMUM_RESOLVERS: Readonly<
  Record<ResolutionDepthClass, number>
> = {
  "single-resolver": 1,
  "two-person": 2,
  quorum: 3,
};

/**
 * The risk → depth mandate. There is no risk tier without a mandated human
 * resolution depth: no deferred decision closes on AI authority alone (§7).
 */
export const MANDATED_RESOLUTION_DEPTH: Readonly<
  Record<ResolutionRiskTier, ResolutionDepthClass>
> = {
  routine: "single-resolver",
  elevated: "two-person",
  critical: "quorum",
};

/** Mandated resolution depth class for a risk tier. */
export function mandatedResolutionDepth(tier: ResolutionRiskTier): ResolutionDepthClass {
  return MANDATED_RESOLUTION_DEPTH[tier];
}

/** Minimum number of independent human resolvers a risk tier requires. */
export function mandatedResolverCount(tier: ResolutionRiskTier): number {
  return DEPTH_MINIMUM_RESOLVERS[mandatedResolutionDepth(tier)];
}

/* ─────────────────────────────────────────────────────────────
 * Typed rejection (fail-closed)
 * ────────────────────────────────────────────────────────────*/

export type ResolutionFlowErrorCode =
  | "invalid_input"
  | "invalid_timestamp"
  | "decision_not_routable"
  | "case_not_routed"
  | "chain_tenant_mismatch"
  | "deadline_invalid"
  | "no_eligible_resolver"
  | "resolver_not_human"
  | "resolver_not_in_pool"
  | "capability_missing"
  | "tenant_scope_mismatch"
  | "self_resolution_rejected"
  | "duplicate_resolution"
  | "duplicate_resolver"
  | "deadline_exceeded"
  | "evidence_required"
  | "forged_record_set";

export class ResolutionFlowError extends Error {
  readonly code: ResolutionFlowErrorCode;

  constructor(code: ResolutionFlowErrorCode, message: string) {
    super(message);
    this.name = "ResolutionFlowError";
    this.code = code;
  }
}

function fail(code: ResolutionFlowErrorCode, message: string): never {
  throw new ResolutionFlowError(code, message);
}

/* ─────────────────────────────────────────────────────────────
 * Schemas + purity helpers
 * ────────────────────────────────────────────────────────────*/

const nonEmptyString = z
  .string()
  .refine((value) => value.trim().length > 0, "must be a non-empty string")
  .transform((value) => value.trim());

const timestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a parseable timestamp");

/** The full §16 decision vocabulary of the authorization engine. */
export const authorizationOutcomeSchema = z.object({
  decision: z.enum(["ALLOW", "DENY", "REDACT", "ESCALATE", "REQUIRE_APPROVAL"]),
  reason: z.string(),
  allowedFields: z.array(z.string()).optional(),
});

export const resolutionFlowInputSchema = z.object({
  requestId: nonEmptyString,
  tenantId: nonEmptyString,
  policyId: nonEmptyString,
  decision: z.enum(RESOLUTION_FLOW_DECISIONS),
  riskTier: z.enum(RESOLUTION_RISK_TIERS),
  reason: nonEmptyString,
  requesterRef: nonEmptyString,
  requesterKind: z.enum(RESOLUTION_IDENTITY_KINDS),
  requestedAt: timestampSchema,
  /** The exact subject of the deferred decision; digested content-addressed. */
  subject: z.unknown(),
});

export const resolverPoolEntrySchema = z.object({
  resolverRef: nonEmptyString,
  identityKind: z.enum(RESOLUTION_IDENTITY_KINDS),
  capabilities: z.array(z.string()),
});

export const approvalChainSchema = z.object({
  chainId: nonEmptyString,
  tenantId: nonEmptyString,
  capabilityRequired: nonEmptyString,
  resolvers: z.array(resolverPoolEntrySchema),
  /** Resolution deadline; null/omitted means unbounded. */
  resolveBy: timestampSchema.nullish(),
});

export const resolutionInputSchema = z.object({
  resolutionId: nonEmptyString,
  verdict: z.enum(["approve", "reject"]),
  resolverRef: nonEmptyString,
  identityKind: z.enum(RESOLUTION_IDENTITY_KINDS),
  tenantId: nonEmptyString,
  capabilities: z.array(z.string()),
  decidedAt: timestampSchema,
  /** Evidence is validated separately so the rejection code stays specific. */
  evidence: z.string(),
});

function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : what;
    const message = issue ? issue.message : "schema validation failed";
    fail("invalid_input", `${where}: ${message}`);
  }
  return result.data;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value as Record<string, unknown>)) {
      deepFreeze(member);
    }
    return Object.freeze(value);
  }
  return value;
}

/* ─────────────────────────────────────────────────────────────
 * Case opening (the deferred decision becomes a resolution case)
 * ────────────────────────────────────────────────────────────*/

export type ResolutionFlowInput = z.input<typeof resolutionFlowInputSchema>;

/**
 * A resolution case: one ESCALATE / REQUIRE_APPROVAL outcome awaiting human
 * closure. `caseId` is content-addressed — the same deferred decision
 * (request, tenant, policy, subject digest, instant) always opens the same
 * case, and any change to the subject yields a different case, voiding any
 * resolution recorded against the previous content.
 */
export interface EscalationCase {
  readonly schemaVersion: string;
  readonly caseId: string;
  readonly requestId: string;
  /** Tenant the decision resolves in (§13 — every request has tenant context). */
  readonly tenantId: string;
  /** The policy under which the decision is resolved (§16 — under which policy?). */
  readonly policyId: string;
  readonly decision: ResolvableDecision;
  readonly riskTier: ResolutionRiskTier;
  readonly mandatedDepth: ResolutionDepthClass;
  readonly requiredResolvers: number;
  readonly reason: string;
  /** The proposing identity — human or AI (AI proposes, §7). */
  readonly requesterRef: string;
  readonly requesterKind: ResolutionIdentityKind;
  readonly subjectDigest: string;
  readonly requestedAt: string;
  /** Provenance of the engine outcome that opened the case; null when opened directly. */
  readonly authorizationReason: string | null;
}

/** Open a resolution case for a deferred decision. */
export function openResolutionFlow(input: ResolutionFlowInput): EscalationCase {
  const parsed = parseOrThrow(resolutionFlowInputSchema, input, "resolutionFlowInput");

  const subjectDigest = digestContent(parsed.subject);
  const caseId = digestContent({
    domain: "approval.chains",
    schemaVersion: RESOLUTION_FLOW_SCHEMA_VERSION,
    requestId: parsed.requestId,
    tenantId: parsed.tenantId,
    policyId: parsed.policyId,
    decision: parsed.decision,
    riskTier: parsed.riskTier,
    subjectDigest,
    requestedAt: parsed.requestedAt,
  });

  return deepFreeze({
    schemaVersion: RESOLUTION_FLOW_SCHEMA_VERSION,
    caseId,
    requestId: parsed.requestId,
    tenantId: parsed.tenantId,
    policyId: parsed.policyId,
    decision: parsed.decision,
    riskTier: parsed.riskTier,
    mandatedDepth: mandatedResolutionDepth(parsed.riskTier),
    requiredResolvers: mandatedResolverCount(parsed.riskTier),
    reason: parsed.reason,
    requesterRef: parsed.requesterRef,
    requesterKind: parsed.requesterKind,
    subjectDigest,
    requestedAt: parsed.requestedAt,
    authorizationReason: null,
  });
}

/**
 * Compose with the authorization engine (read-only): open a resolution case
 * from an engine outcome. Fail-closed laws:
 * - the outcome shape must match the engine's decision contract;
 * - only ESCALATE and REQUIRE_APPROVAL are routable — an ALLOW / DENY /
 *   REDACT outcome is terminal in the engine and NEVER enters this flow
 *   (routing it would let this module re-decide what the engine decided).
 */
export function openResolutionFlowForAuthorizationOutcome(
  outcome: AuthorizationResult,
  base: Omit<ResolutionFlowInput, "decision">,
): EscalationCase {
  const parsedOutcome = parseOrThrow(
    authorizationOutcomeSchema,
    outcome,
    "authorizationOutcome",
  );
  if (!RESOLUTION_FLOW_DECISIONS.includes(parsedOutcome.decision as ResolvableDecision)) {
    fail(
      "decision_not_routable",
      `decision "${parsedOutcome.decision}" is terminal in the authorization engine and never routed to resolution`,
    );
  }
  // The guard above (with fail()'s throw) proves routability at runtime; the
  // cast records it for the type system.
  const decision = parsedOutcome.decision as ResolvableDecision;
  const kase = openResolutionFlow({ ...base, decision });
  return deepFreeze({ ...kase, authorizationReason: parsedOutcome.reason });
}

/* ─────────────────────────────────────────────────────────────
 * Approval chains + risk-classified routing
 * ────────────────────────────────────────────────────────────*/

export type ApprovalChainConfig = z.input<typeof approvalChainSchema>;

export interface ResolverPoolEntry {
  readonly resolverRef: string;
  readonly identityKind: ResolutionIdentityKind;
  readonly capabilities: readonly string[];
}

export interface ApprovalChain {
  readonly chainId: string;
  readonly tenantId: string;
  readonly capabilityRequired: string;
  readonly resolvers: readonly ResolverPoolEntry[];
  readonly resolveBy: string | null;
}

/** Validate and freeze an approval-chain configuration. */
export function declareApprovalChain(config: ApprovalChainConfig): ApprovalChain {
  const parsed = parseOrThrow(approvalChainSchema, config, "approvalChain");
  return deepFreeze({
    chainId: parsed.chainId,
    tenantId: parsed.tenantId,
    capabilityRequired: parsed.capabilityRequired,
    resolvers: parsed.resolvers.map((entry) => deepFreeze({ ...entry })),
    resolveBy: parsed.resolveBy ?? null,
  });
}

export interface ApprovalRouting {
  readonly chainId: string;
  readonly tenantId: string;
  readonly riskTier: ResolutionRiskTier;
  readonly mandatedDepth: ResolutionDepthClass;
  readonly requiredResolvers: number;
  readonly eligibleResolverRefs: readonly string[];
  readonly capabilityRequired: string;
  readonly resolveBy: string | null;
}

export type RoutingBlockedCode =
  | "chain_tenant_mismatch"
  | "deadline_invalid"
  | "no_eligible_resolver";

export interface RoutingBlocked {
  readonly ok: false;
  readonly code: RoutingBlockedCode;
  readonly detail: string;
}

export interface RoutingRouted {
  readonly ok: true;
  readonly routing: ApprovalRouting;
}

export type RoutingResult = RoutingRouted | RoutingBlocked;

/**
 * Route a case to its human approval chain. Risk-classified: the case's
 * risk tier mandates the resolution depth the chain must be able to
 * satisfy with INDEPENDENT, eligible humans.
 *
 * Fail-closed when no approver resolves: a chain scoped to another tenant,
 * a chain with an already-invalid deadline, or a chain whose eligible human
 * pool is smaller than the mandated depth is BLOCKED at routing time — the
 * flow never waits on an impossible chain and never falls back to an
 * auto-allow.
 */
export function routeToApprovalChain(
  kase: EscalationCase,
  chain: ApprovalChain,
): RoutingResult {
  if (chain.tenantId !== kase.tenantId) {
    return deepFreeze({
      ok: false,
      code: "chain_tenant_mismatch",
      detail: `chain "${chain.chainId}" is scoped to tenant "${chain.tenantId}", not the case tenant "${kase.tenantId}"`,
    });
  }

  if (chain.resolveBy !== null && Date.parse(chain.resolveBy) <= Date.parse(kase.requestedAt)) {
    return deepFreeze({
      ok: false,
      code: "deadline_invalid",
      detail: `chain "${chain.chainId}" deadline ${chain.resolveBy} is not in the future of the case request ${kase.requestedAt}`,
    });
  }

  const eligible = chain.resolvers
    .filter(
      (entry) =>
        entry.identityKind === "human" &&
        entry.capabilities.includes(chain.capabilityRequired) &&
        entry.resolverRef !== kase.requesterRef,
    )
    .map((entry) => entry.resolverRef);

  if (eligible.length < kase.requiredResolvers) {
    return deepFreeze({
      ok: false,
      code: "no_eligible_resolver",
      detail:
        `risk tier "${kase.riskTier}" mandates depth "${kase.mandatedDepth}" ` +
        `(${kase.requiredResolvers} independent human resolver(s)); chain "${chain.chainId}" ` +
        `offers ${eligible.length} eligible resolver(s) — fail-closed: no approver resolves`,
    });
  }

  return deepFreeze({
    ok: true,
    routing: {
      chainId: chain.chainId,
      tenantId: chain.tenantId,
      riskTier: kase.riskTier,
      mandatedDepth: kase.mandatedDepth,
      requiredResolvers: kase.requiredResolvers,
      eligibleResolverRefs: eligible,
      capabilityRequired: chain.capabilityRequired,
      resolveBy: chain.resolveBy,
    },
  });
}

/* ─────────────────────────────────────────────────────────────
 * Recording a human resolution (append-only, evidence-bearing)
 * ────────────────────────────────────────────────────────────*/

export type ResolutionInput = z.input<typeof resolutionInputSchema>;

export type ResolutionVerdict = "approve" | "reject";

/**
 * One human resolution record — full §12 provenance: who resolved, for
 * which case, with what verdict, capability and tenant evidence, when, and
 * the recorded rationale. Append-only: a record is never mutated, only
 * followed by further records.
 */
export interface ResolutionRecord {
  readonly resolutionId: string;
  readonly caseId: string;
  readonly verdict: ResolutionVerdict;
  readonly resolverRef: string;
  readonly identityKind: ResolutionIdentityKind;
  readonly tenantId: string;
  readonly capabilities: readonly string[];
  readonly decidedAt: string;
  readonly evidence: string;
}

/**
 * Record one resolution against a routed case. Fail-closed laws:
 * - the case must be routed (a blocked routing has no positions to fill);
 * - the resolver must be a HUMAN holding the chain's required capability,
 *   scoped to the case's tenant, and never the requester (§7 independence);
 * - the resolver must occupy a position the routing offered;
 * - resolutions are unique per record and per resolver (one position each);
 * - the decision instant must lie inside the case window and before the
 *   chain deadline — a resolution after the deadline does not count;
 * - the record is evidence-bearing: a non-empty rationale is required.
 */
export function recordResolution(
  kase: EscalationCase,
  routing: RoutingResult,
  chain: ApprovalChain,
  prior: readonly ResolutionRecord[],
  input: ResolutionInput,
): ResolutionRecord {
  if (!routing.ok) {
    fail("case_not_routed", `case "${kase.caseId}" is not routed: ${routing.detail}`);
  }

  const parsed = parseOrThrow(resolutionInputSchema, input, "resolutionInput");

  if (parsed.evidence.trim().length === 0) {
    fail("evidence_required", "resolutions are evidence-bearing: a non-empty rationale is required");
  }

  if (parsed.identityKind !== "human") {
    fail(
      "resolver_not_human",
      `resolver "${parsed.resolverRef}" is an AI identity — AI can never resolve a deferred decision (§7)`,
    );
  }
  if (!parsed.capabilities.includes(routing.routing.capabilityRequired)) {
    fail(
      "capability_missing",
      `resolver "${parsed.resolverRef}" does not hold "${routing.routing.capabilityRequired}"`,
    );
  }
  if (parsed.tenantId !== kase.tenantId) {
    fail(
      "tenant_scope_mismatch",
      `resolver "${parsed.resolverRef}" is scoped to tenant "${parsed.tenantId}", not the case tenant "${kase.tenantId}"`,
    );
  }
  if (parsed.resolverRef === kase.requesterRef) {
    fail(
      "self_resolution_rejected",
      `resolver "${parsed.resolverRef}" is the requester of case "${kase.caseId}" — self-resolution is denied (§7)`,
    );
  }
  if (!routing.routing.eligibleResolverRefs.includes(parsed.resolverRef)) {
    fail(
      "resolver_not_in_pool",
      `resolver "${parsed.resolverRef}" holds no routing position on chain "${routing.routing.chainId}"`,
    );
  }

  for (const record of prior) {
    if (record.resolutionId === parsed.resolutionId) {
      fail(
        "duplicate_resolution",
        `resolution "${parsed.resolutionId}" is already recorded — records are append-only`,
      );
    }
    if (record.resolverRef === parsed.resolverRef) {
      fail(
        "duplicate_resolver",
        `resolver "${parsed.resolverRef}" already occupies a resolution position on case "${kase.caseId}" — resolutions must be independent`,
      );
    }
  }

  const decidedAtMs = Date.parse(parsed.decidedAt);
  if (decidedAtMs < Date.parse(kase.requestedAt)) {
    fail(
      "invalid_timestamp",
      `resolution ${parsed.decidedAt} precedes the case request ${kase.requestedAt}`,
    );
  }
  if (routing.routing.resolveBy !== null && decidedAtMs >= Date.parse(routing.routing.resolveBy)) {
    fail(
      "deadline_exceeded",
      `resolution at ${parsed.decidedAt} is at or past chain deadline ${routing.routing.resolveBy}`,
    );
  }

  return deepFreeze({
    resolutionId: parsed.resolutionId,
    caseId: kase.caseId,
    verdict: parsed.verdict,
    resolverRef: parsed.resolverRef,
    identityKind: parsed.identityKind,
    tenantId: parsed.tenantId,
    capabilities: [...parsed.capabilities],
    decidedAt: parsed.decidedAt,
    evidence: parsed.evidence.trim(),
  });
}

/* ─────────────────────────────────────────────────────────────
 * Flow resolution (typed outcomes)
 * ────────────────────────────────────────────────────────────*/

export const RESOLUTION_OUTCOME_KINDS = [
  "approved",
  "rejected",
  "pending",
  "blocked_no_eligible_resolver",
  "blocked_unresolved",
  "invalid",
] as const;
export type ResolutionOutcomeKind = (typeof RESOLUTION_OUTCOME_KINDS)[number];

export type ResolutionOutcome =
  | {
      readonly kind: "approved";
      readonly approvals: readonly ResolutionRecord[];
      readonly requiredResolvers: number;
      readonly depth: ResolutionDepthClass;
    }
  | {
      readonly kind: "rejected";
      readonly rejection: ResolutionRecord;
      readonly reason: string;
    }
  | {
      readonly kind: "pending";
      readonly approvals: readonly ResolutionRecord[];
      readonly requiredResolvers: number;
      readonly resolveBy: string | null;
    }
  | {
      readonly kind: "blocked_no_eligible_resolver";
      readonly code: RoutingBlockedCode;
      readonly detail: string;
    }
  | {
      readonly kind: "blocked_unresolved";
      readonly detail: string;
    }
  | {
      readonly kind: "invalid";
      readonly reasons: readonly string[];
    };

function describeIneligibleRecord(record: ResolutionRecord, routing: ApprovalRouting, kase: EscalationCase): string | null {
  if (record.caseId !== kase.caseId) {
    return `resolution "${record.resolutionId}" is bound to case "${record.caseId}", not "${kase.caseId}"`;
  }
  if (record.identityKind !== "human") {
    return `resolution "${record.resolutionId}" was cast by a non-human identity`;
  }
  if (!record.capabilities.includes(routing.capabilityRequired)) {
    return `resolution "${record.resolutionId}" lacks "${routing.capabilityRequired}" in its capability evidence`;
  }
  if (record.tenantId !== kase.tenantId) {
    return `resolution "${record.resolutionId}" carries tenant "${record.tenantId}", not the case tenant "${kase.tenantId}"`;
  }
  if (record.resolverRef === kase.requesterRef) {
    return `resolution "${record.resolutionId}" was cast by the requester — self-resolution is denied (§7)`;
  }
  if (!routing.eligibleResolverRefs.includes(record.resolverRef)) {
    return `resolution "${record.resolutionId}" was cast by "${record.resolverRef}" who holds no routing position`;
  }
  if (record.evidence.trim().length === 0) {
    return `resolution "${record.resolutionId}" carries no evidence`;
  }
  const decidedAtMs = Date.parse(record.decidedAt);
  if (decidedAtMs < Date.parse(kase.requestedAt)) {
    return `resolution "${record.resolutionId}" precedes the case request`;
  }
  if (routing.resolveBy !== null && decidedAtMs >= Date.parse(routing.resolveBy)) {
    return `resolution "${record.resolutionId}" is at or past the chain deadline`;
  }
  return null;
}

/**
 * Resolve the flow at instant `at` and produce a typed outcome. Records are
 * re-derived against the case and routing at `at` — capability, tenant,
 * independence, binding and deadline are re-checked from each record's own
 * evidence snapshot, so a forged or drifted record is surfaced as `invalid`,
 * never absorbed.
 *
 * Typed outcomes:
 * - approved — the mandated depth of independent human approvals is met;
 * - rejected — any human rejected; the case is closed as rejected;
 * - pending — closure not yet reached and the deadline has not passed;
 * - blocked_no_eligible_resolver — routing failed; no approver can resolve;
 * - blocked_unresolved — the deadline passed without human closure
 *   (fail-closed: never approved, never dropped);
 * - invalid — the record set is forged or drifted; defects surface.
 */
export function resolveFlow(
  kase: EscalationCase,
  routing: RoutingResult,
  records: readonly ResolutionRecord[],
  at: string,
): ResolutionOutcome {
  const atStamp = parseOrThrow(timestampSchema, at, "at");

  if (!routing.ok) {
    return deepFreeze({
      kind: "blocked_no_eligible_resolver",
      code: routing.code,
      detail: routing.detail,
    });
  }

  // Structural integrity of the append-only record set.
  const invalidReasons: string[] = [];
  const seenResolutionIds = new Set<string>();
  const seenResolverRefs = new Set<string>();
  for (const record of records) {
    if (seenResolutionIds.has(record.resolutionId)) {
      invalidReasons.push(
        `resolution "${record.resolutionId}" appears more than once — records are append-only`,
      );
    }
    seenResolutionIds.add(record.resolutionId);
    if (seenResolverRefs.has(record.resolverRef)) {
      invalidReasons.push(
        `resolver "${record.resolverRef}" occupies more than one resolution position — resolutions must be independent`,
      );
    }
    seenResolverRefs.add(record.resolverRef);
    const ineligible = describeIneligibleRecord(record, routing.routing, kase);
    if (ineligible !== null) {
      invalidReasons.push(ineligible);
    }
  }
  if (invalidReasons.length > 0) {
    return deepFreeze({ kind: "invalid", reasons: invalidReasons });
  }

  const rejection = records.find((record) => record.verdict === "reject");
  if (rejection !== undefined) {
    return deepFreeze({
      kind: "rejected",
      rejection,
      reason: rejection.evidence.trim().length > 0 ? rejection.evidence : "rejected without recorded evidence",
    });
  }

  const approvals = records.filter((record) => record.verdict === "approve");
  const required = kase.requiredResolvers;

  if (approvals.length >= required) {
    return deepFreeze({
      kind: "approved",
      approvals,
      requiredResolvers: required,
      depth: kase.mandatedDepth,
    });
  }

  if (routing.routing.resolveBy !== null && Date.parse(routing.routing.resolveBy) <= Date.parse(atStamp)) {
    return deepFreeze({
      kind: "blocked_unresolved",
      detail:
        `chain "${routing.routing.chainId}" deadline ${routing.routing.resolveBy} passed at ${atStamp} with ` +
        `${approvals.length}/${required} approval(s) — fail-closed: no approver resolved the case`,
    });
  }

  return deepFreeze({
    kind: "pending",
    approvals,
    requiredResolvers: required,
    resolveBy: routing.routing.resolveBy,
  });
}

/* ─────────────────────────────────────────────────────────────
 * The execution gate (human closure required before execution)
 * ────────────────────────────────────────────────────────────*/

export type ExecutionGateDecision = "ALLOWED" | "DENIED";

/**
 * The audit artifact the gate ALWAYS emits — allowed or denied. It binds
 * the case provenance, the outcome, and (for approvals) the full resolver
 * set. This is the audit trail the executor leaves behind, per §29.
 */
export interface ResolutionExecutionAudit {
  readonly auditId: string;
  readonly at: string;
  readonly caseId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly policyId: string;
  readonly decision: ResolvableDecision;
  readonly riskTier: ResolutionRiskTier;
  readonly mandatedDepth: ResolutionDepthClass;
  readonly requiredResolvers: number;
  readonly outcomeKind: ResolutionOutcomeKind;
  readonly gateDecision: ExecutionGateDecision;
  readonly reasons: readonly string[];
  readonly requesterRef: string;
  readonly requesterKind: ResolutionIdentityKind;
  readonly subjectDigest: string;
  readonly resolverRefs: readonly string[];
}

export interface ExecutionGateResult {
  readonly gateDecision: ExecutionGateDecision;
  readonly audit: ResolutionExecutionAudit;
}

/**
 * The executor gate: the LAST check before the subject of a deferred
 * decision proceeds. Human closure is required: ONLY the `approved`
 * outcome — the mandated depth of independent, eligible, evidence-bearing
 * human resolutions — allows execution. Every other outcome (pending,
 * rejected, blocked, invalid) DENIES with named reasons.
 *
 * The gate NEVER throws on an unmet flow: denial is a recorded decision
 * with an audit record, so a bypass path cannot exist.
 */
export function gateExecutionOnResolution(
  kase: EscalationCase,
  outcome: ResolutionOutcome,
  at: string,
): ExecutionGateResult {
  const atStamp = parseOrThrow(timestampSchema, at, "at");
  const gateDecision: ExecutionGateDecision = outcome.kind === "approved" ? "ALLOWED" : "DENIED";

  const reasons: string[] = [];
  let resolverRefs: readonly string[] = [];

  switch (outcome.kind) {
    case "approved":
      resolverRefs = outcome.approvals.map((record) => record.resolverRef);
      reasons.push(
        `human closure satisfied: ${outcome.approvals.length} independent approval(s) meet depth ` +
          `"${outcome.depth}" (${outcome.requiredResolvers} required)`,
      );
      break;
    case "rejected":
      resolverRefs = [outcome.rejection.resolverRef];
      reasons.push(`human closure denied: case rejected — ${outcome.reason}`);
      break;
    case "pending":
      resolverRefs = outcome.approvals.map((record) => record.resolverRef);
      reasons.push(
        `human closure unmet: ${outcome.approvals.length}/${outcome.requiredResolvers} approval(s) recorded`,
      );
      break;
    case "blocked_no_eligible_resolver":
      reasons.push(`human closure impossible: ${outcome.detail}`);
      break;
    case "blocked_unresolved":
      reasons.push(`human closure never reached: ${outcome.detail}`);
      break;
    case "invalid":
      resolverRefs = [];
      for (const reason of outcome.reasons) {
        reasons.push(`record set invalid: ${reason}`);
      }
      break;
  }

  const audit: ResolutionExecutionAudit = deepFreeze({
    auditId: digestContent({
      domain: "approval.chains.execution-gate",
      caseId: kase.caseId,
      subjectDigest: kase.subjectDigest,
      gateDecision,
      outcomeKind: outcome.kind,
      at: atStamp,
      resolverRefs,
    }),
    at: atStamp,
    caseId: kase.caseId,
    requestId: kase.requestId,
    tenantId: kase.tenantId,
    policyId: kase.policyId,
    decision: kase.decision,
    riskTier: kase.riskTier,
    mandatedDepth: kase.mandatedDepth,
    requiredResolvers: kase.requiredResolvers,
    outcomeKind: outcome.kind,
    gateDecision,
    reasons,
    requesterRef: kase.requesterRef,
    requesterKind: kase.requesterKind,
    subjectDigest: kase.subjectDigest,
    resolverRefs,
  });

  return deepFreeze({ gateDecision, audit });
}