/**
 * CoreGrid — Phase 46 Universal Digital Twin Civilization Layer substrate
 * contracts (H3 wave Squad G, mission G-066; Constitution §7, §9, §10, §11,
 * §12, §16, §21; architecture/phase-46-universal-digital-twin-civilization-layer.md).
 *
 * WHAT: the typed contract surface of the twin-civilization substrate — the
 * phase owns twin FEDERATION: discovery of twins across organizations and
 * jurisdictions, cross-twin relationship mapping, permitted shared-state
 * exchange, and federation governance (agreement, scope, revocation). It owns
 * NO twin identity or twin state (phase 16), NO authorization decisions
 * (phase 08), NO canonical record ownership (kernel and owning phases), NO
 * planetary topology (phase 44). A "twin" here is any living computational
 * representation of a reality; no domain vocabulary appears in this module.
 *
 * Laws of this module:
 * - Federation admits only governed twins (Constitution §10): a twin enters
 *   a federation only as a complete federated reference carrying identity,
 *   owner, tenant, current-state digest, history reference, capabilities and
 *   governing policies. An incomplete twin reference is unparsable — there
 *   is no schema path to an anonymous or policy-less federated twin.
 * - A twin is NOT a permission bypass (Constitution §10, kernel boundary
 *   statement): having information inside a twin grants nothing. This is
 *   encoded structurally in three ways:
 *     1. every federation agreement carries the literal `accessGrant: "none"`
 *        — an agreement that grants access cannot be expressed, let alone
 *        parsed;
 *     2. every shared-state envelope carries the literal
 *        `authority: "mirror"` — shared state is a mirror of reality, never
 *        an authority to act;
 *     3. the ONLY function that maps twin data to an access outcome
 *        (`evaluateTwinDataAccessRequest`) refuses every request with the
 *        typed verdict TWIN_PRESENCE_IS_NOT_A_GRANT. Presence of data in a
 *        twin can never be promoted to an authorization decision here.
 * - Federation by agreement, not by convenience: every federation is
 *   explicit, tenant-spanning (each side keeps its own isolation boundary —
 *   no merging), minimised (field-path allowlist, digest-carrying payloads,
 *   never inlined content), redacted where classification demands it,
 *   attributed to the agreement that permitted it, revocable, and expiring.
 * - Relationships carry provenance (Constitution §11): every cross-twin
 *   relationship records provenance, ownership on both sides, the agreement
 *   that authorized it, and explained confidence. No anonymous relationships.
 * - Governed federation (kernel `requiresApprovalFor`): recording an
 *   agreement, widening shared scope, cross-jurisdiction federation and
 *   revocation all route through the authorization engine's §16 vocabulary
 *   and fail closed. Scope widening is never an automatic decision.
 * - Revocation is terminal: a revoked federation cannot resurrect. Either
 *   side may sever without corrupting either twin.
 * - Fail-closed parsing: an untrusted input that violates any invariant
 *   yields a typed failure with structured issues. A failed parse never
 *   yields a partial artifact.
 *
 * Composition: the decision vocabulary is the authorization engine's §16
 * vocabulary, imported read-only as a type from the identity module. No
 * sibling wave modules, no vendor imports, no I/O, no persistence, no
 * wall-clock reads — every instant is a supplied parameter — no secrets.
 */

import { z } from "zod";
import type { AuthorizationDecision } from "../identity";

/* ─────────────────────────────────────────────────────────────
 * Version and bounds (no unbounded artifacts)
 * ────────────────────────────────────────────────────────────*/

export const TWIN_CIVILIZATION_CONTRACT_SCHEMA_VERSION = "1.0";

/** Hard ceiling on shared field paths declared by one federation agreement. */
export const MAX_SHARED_FIELD_PATHS = 128;

/** Hard ceiling on capabilities declared by one federated twin reference. */
export const MAX_TWIN_CAPABILITIES = 64;

/** Hard ceiling on governing policy references on one federated twin reference. */
export const MAX_TWIN_POLICY_REFS = 32;

/** Hard ceiling on relationships mapped under one federation agreement. */
export const MAX_RELATIONSHIPS_PER_AGREEMENT = 256;

/* ─────────────────────────────────────────────────────────────
 * Primitives
 * ────────────────────────────────────────────────────────────*/

const nonEmptyString = (label: string) =>
  z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);

export const identifierSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,127}$/,
    "identifier must be 1-128 characters of letters, digits, underscore, colon, dot or hyphen, starting alphanumeric",
  );
export type Identifier = z.infer<typeof identifierSchema>;

/** Content digest binding a reference to the bytes it mirrors. */
export const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "digest must be a lowercase 64-character hex content digest");

export const tenantRefSchema = identifierSchema;

/** A dotted, bounded field path into a twin's mirrored state. */
export const fieldPathSchema = z
  .string()
  .regex(
    /^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*){0,7}$/,
    "field path must be 1-8 dot-separated segments of letters, digits and underscore, starting with a letter or underscore",
  );

/* ─────────────────────────────────────────────────────────────
 * Vocabulary (phase doc engineering-domain map, neutral classes)
 * ────────────────────────────────────────────────────────────*/

/**
 * Neutral twin classes (phase doc domains 04–33, collapsed to universal
 * classes — no domain vocabulary). Every specialized twin the phase doc
 * describes falls into exactly one of these universal classes.
 */
export const TWIN_KINDS = [
  "entity",
  "process",
  "environment",
  "infrastructure",
  "intelligence",
  "comprehensive",
] as const;
export type TwinKind = (typeof TWIN_KINDS)[number];

/** Federation lifecycle states (kernel principle: explicit, revocable). */
export const FEDERATION_STATES = [
  "PROPOSED",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
] as const;
export type FederationState = (typeof FEDERATION_STATES)[number];

/**
 * Allowed federation lifecycle transitions. Approval precedes activation;
 * revocation is terminal — a revoked federation never resurrects.
 */
export const FEDERATION_TRANSITIONS: Readonly<
  Record<FederationState, readonly FederationState[]>
> = {
  PROPOSED: ["APPROVED", "REVOKED"],
  APPROVED: ["ACTIVE", "SUSPENDED", "REVOKED"],
  ACTIVE: ["SUSPENDED", "REVOKED"],
  SUSPENDED: ["ACTIVE", "REVOKED"],
  REVOKED: [],
};

/** Neutral cross-twin relationship kinds (phase doc relationship mapping). */
export const TWIN_RELATIONSHIP_KINDS = [
  "contains",
  "depends_on",
  "observes",
  "mirrors",
  "succeeds",
  "federates_with",
] as const;
export type TwinRelationshipKind = (typeof TWIN_RELATIONSHIP_KINDS)[number];

/** Data classifications for exchanged shared state (minimization input). */
export const SHARED_STATE_CLASSIFICATIONS = [
  "public",
  "internal",
  "sensitive",
  "restricted",
] as const;
export type SharedStateClassification = (typeof SHARED_STATE_CLASSIFICATIONS)[number];

/**
 * Governed federation actions (kernel `requiresApprovalFor`). The gate
 * speaks only this vocabulary; anything else fails closed to DENY.
 */
export const FEDERATION_ACTIONS = [
  "record_agreement",
  "exchange_state",
  "widen_shared_scope",
  "revoke_federation",
] as const;
export type FederationAction = (typeof FEDERATION_ACTIONS)[number];

/* ─────────────────────────────────────────────────────────────
 * Provenance (Constitution §12; kernel tenancy section)
 * ────────────────────────────────────────────────────────────*/

/**
 * Federation provenance: every federation artifact answers who produced it,
 * under which policy, in which tenant, when, and with what trace. There are
 * no anonymous federation artifacts.
 */
export const federationProvenanceSchema = z.strictObject({
  actorId: identifierSchema,
  /** Human, agent or service — follows the identity module's kind split. */
  actorKind: z.enum(["human", "agent", "service"]),
  tenantId: tenantRefSchema,
  policyRef: nonEmptyString("provenance.policyRef"),
  traceId: identifierSchema,
  recordedAt: z.string().datetime(),
});
export type FederationProvenance = z.infer<typeof federationProvenanceSchema>;

/** Explained confidence: a value in [0,1] that names its deriving factors. */
export const confidenceSchema = z.strictObject({
  value: z.number().min(0).max(1),
  derivedFrom: z
    .array(z.enum(["evidence_quality", "agreement", "freshness", "model_reliability"]))
    .min(1),
  method: nonEmptyString("confidence.method"),
});
export type Confidence = z.infer<typeof confidenceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Federated twin reference (Constitution §10 admission contract)
 * ────────────────────────────────────────────────────────────*/

/**
 * The complete reference a twin must present to enter a federation
 * (Constitution §10: identity, owner, tenant, state, history, capabilities,
 * policies — structurally required; an incomplete twin is unparsable).
 * The twin's identity and state remain owned by phase 16; this surface
 * carries them by reference and digest, never by value.
 */
export const federatedTwinRefSchema = z.strictObject({
  twinId: identifierSchema,
  twinKind: z.enum(TWIN_KINDS),
  /** Owner of the twin — presence here is attribution, never authority. */
  ownerRef: identifierSchema,
  /** Home tenant — the twin never leaves its isolation boundary. */
  homeTenantId: tenantRefSchema,
  /** Digest of the twin's current mirrored state — never the state itself. */
  currentStateDigest: digestSchema,
  /** Reference into the twin's history (phase 16 twin memory). */
  historyRef: identifierSchema,
  capabilities: z.array(identifierSchema).min(1).max(MAX_TWIN_CAPABILITIES),
  /** Governing policies — a federation-eligible twin is always policy-bound. */
  policyRefs: z.array(identifierSchema).min(1).max(MAX_TWIN_POLICY_REFS),
  recordedAt: z.string().datetime(),
});
export type FederatedTwinRef = z.infer<typeof federatedTwinRefSchema>;

/* ─────────────────────────────────────────────────────────────
 * Federation agreement (kernel provides: federation:agree)
 * ────────────────────────────────────────────────────────────*/

/**
 * A federation agreement between two twins of different tenants. The literal
 * `accessGrant: "none"` is structural (Constitution §10): the agreement
 * authorizes a MINIMISED, REDACTED, ATTRIBUTED mirror of declared field
 * paths — it can never be expressed as, or mutated into, an access grant.
 */
export const federationAgreementSchema = z.strictObject({
  agreementId: identifierSchema,
  initiator: federatedTwinRefSchema,
  counterparty: federatedTwinRefSchema,
  state: z.enum(FEDERATION_STATES),
  /** THE no-grant boundary, encoded as a literal. See module header. */
  accessGrant: z.literal("none"),
  /**
   * The complete allowlist of field paths the agreement may mirror. Exchange
   * outside this set fails closed. An active agreement declares at least one.
   */
  sharedFieldPaths: z.array(fieldPathSchema).max(MAX_SHARED_FIELD_PATHS),
  classification: z.enum(SHARED_STATE_CLASSIFICATIONS),
  /** Authorization evidence: required from APPROVED onward. */
  approvalRef: identifierSchema.optional(),
  /** Jurisdiction of each side; differing jurisdictions are governed harder. */
  initiatorJurisdictionRef: identifierSchema.optional(),
  counterpartyJurisdictionRef: identifierSchema.optional(),
  /** Expiry is mandatory — every federation is revocable and expiring. */
  effectiveFrom: z.string().datetime(),
  expiresAt: z.string().datetime(),
  provenance: federationProvenanceSchema,
});
export type FederationAgreement = z.infer<typeof federationAgreementSchema>;

export type TwinParseFailureReason =
  | "invalid_shape"
  | "not_a_federation"
  | "missing_authorization"
  | "invalid_window"
  | "scope_violation"
  | "cross_tenant_violation"
  | "redaction_violation";

export interface TwinParseIssue {
  readonly path: string;
  readonly message: string;
}

export type TwinParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: TwinParseFailureReason;
      readonly issues: readonly TwinParseIssue[];
    };

function issuePath(path: readonly (string | number | symbol)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

function shapeFailure(error: z.ZodError): TwinParseResult<never> {
  return {
    ok: false,
    reason: "invalid_shape",
    issues: error.issues.map((issue) => ({
      path: issuePath(issue.path),
      message: issue.message,
    })),
  };
}

function singleFailure(
  reason: TwinParseFailureReason,
  path: string,
  message: string,
): TwinParseResult<never> {
  return { ok: false, reason, issues: [{ path, message }] };
}

const AUTHORIZATION_REQUIRED_STATES: readonly FederationState[] = [
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
];

/**
 * Parse an untrusted federation agreement. Fail-closed cross-record
 * invariants (each refusal is typed, never absorbed):
 * - the parties come from DIFFERENT tenants — a same-tenant pairing is not
 *   a federation, it is an intra-tenant link owned elsewhere;
 * - states from APPROVED onward carry authorization evidence — an
 *   unapproved agreement never presents itself as approved;
 * - an ACTIVE agreement declares at least one shared field path — an
 *   active federation mirrors nothing by default and everything by design;
 * - the validity window is well-formed and bounded — expiry is mandatory.
 */
export function parseFederationAgreement(input: unknown): TwinParseResult<FederationAgreement> {
  const parsed = federationAgreementSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);

  const agreement = parsed.data;

  if (agreement.initiator.homeTenantId === agreement.counterparty.homeTenantId) {
    return singleFailure(
      "not_a_federation",
      "counterparty.homeTenantId",
      "both parties share one tenant — federation spans tenants without merging them; intra-tenant twin links are owned by the twin-identity phase, not by federation",
    );
  }

  if (
    AUTHORIZATION_REQUIRED_STATES.includes(agreement.state) &&
    agreement.approvalRef === undefined
  ) {
    return singleFailure(
      "missing_authorization",
      "approvalRef",
      `agreement in state ${agreement.state} must carry authorization evidence — unapproved federation never presents itself as approved`,
    );
  }

  if (agreement.state === "ACTIVE" && agreement.sharedFieldPaths.length < 1) {
    return singleFailure(
      "scope_violation",
      "sharedFieldPaths",
      "an ACTIVE agreement must declare at least one shared field path — shared scope is always explicit",
    );
  }

  if (agreement.expiresAt <= agreement.effectiveFrom) {
    return singleFailure(
      "invalid_window",
      "expiresAt",
      "expiry must be strictly after the effective instant — an agreement without a bounded lifetime is not expressible",
    );
  }

  return { ok: true, value: agreement };
}

/**
 * Check one federation lifecycle transition against the declared graph.
 * A transition outside the graph is refused — approval precedes activation,
 * and revocation is terminal (a revoked federation never resurrects).
 */
export function isFederationTransitionAllowed(
  from: FederationState,
  to: FederationState,
): boolean {
  return FEDERATION_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Shared-state envelope (kernel provides: federation:share-state)
 * ────────────────────────────────────────────────────────────*/

/**
 * One minimised unit of shared state exchanged under an agreement. The
 * payload travels by digest, never by value (minimization); the envelope is
 * attributed to the agreement that permitted it; and the literal
 * `authority: "mirror"` is structural (Constitution §10): this is a mirror
 * of reality, never an authority to act — no schema path exists from an
 * envelope to an authorization grant.
 */
export const sharedStateEnvelopeSchema = z.strictObject({
  envelopeId: identifierSchema,
  agreementId: identifierSchema,
  fieldPath: fieldPathSchema,
  classification: z.enum(SHARED_STATE_CLASSIFICATIONS),
  /** True when the payload was redacted before exchange. */
  redacted: z.boolean(),
  /** Digest of the exchanged payload — the payload itself never travels here. */
  payloadDigest: digestSchema,
  sourceTenantId: tenantRefSchema,
  destinationTenantId: tenantRefSchema,
  /** THE no-grant boundary, encoded as a literal. See module header. */
  authority: z.literal("mirror"),
  provenance: federationProvenanceSchema,
  exchangedAt: z.string().datetime(),
});
export type SharedStateEnvelope = z.infer<typeof sharedStateEnvelopeSchema>;

/**
 * Parse an untrusted shared-state envelope. Fail-closed invariants:
 * - the exchange spans tenants (source ≠ destination) — a same-tenant
 *   transfer is not a federated exchange;
 * - `restricted` classification is always redacted before exchange — an
 *   unredacted restricted envelope is unparsable, never silently accepted.
 */
export function parseSharedStateEnvelope(input: unknown): TwinParseResult<SharedStateEnvelope> {
  const parsed = sharedStateEnvelopeSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);

  const envelope = parsed.data;

  if (envelope.sourceTenantId === envelope.destinationTenantId) {
    return singleFailure(
      "cross_tenant_violation",
      "destinationTenantId",
      "source and destination share one tenant — a federated exchange spans tenants; intra-tenant state transfer is owned by the twin-identity phase",
    );
  }

  if (envelope.classification === "restricted" && !envelope.redacted) {
    return singleFailure(
      "redaction_violation",
      "redacted",
      "restricted shared state must be redacted before exchange — an unredacted restricted envelope fails closed",
    );
  }

  return { ok: true, value: envelope };
}

/**
 * Check one field path against an agreement's shared scope. The allowlist is
 * exact: a path is in scope only when it is declared verbatim. Prefix
 * matching is deliberately refused — declaring `a.b` never silently
 * authorizes `a.b.c`.
 */
export function isFieldPathInScope(agreement: FederationAgreement, fieldPath: string): boolean {
  return agreement.sharedFieldPaths.includes(fieldPath);
}

/* ─────────────────────────────────────────────────────────────
 * Cross-twin relationships (Constitution §11; kernel relationships)
 * ────────────────────────────────────────────────────────────*/

/**
 * A mapped cross-twin relationship. Every relationship preserves provenance,
 * ownership on both sides, the agreement that authorized it, and explained
 * confidence (Constitution §11). Relationships exist only under an
 * agreement — there is no anonymous cross-twin relationship.
 */
export const twinRelationshipSchema = z.strictObject({
  relationshipId: identifierSchema,
  agreementId: identifierSchema,
  fromTwinId: identifierSchema,
  toTwinId: identifierSchema,
  kind: z.enum(TWIN_RELATIONSHIP_KINDS),
  /** Ownership attribution on both sides (tenant refs, not access). */
  fromTenantId: tenantRefSchema,
  toTenantId: tenantRefSchema,
  confidence: confidenceSchema,
  provenance: federationProvenanceSchema,
  mappedAt: z.string().datetime(),
});
export type TwinRelationship = z.infer<typeof twinRelationshipSchema>;

export function parseTwinRelationship(input: unknown): TwinParseResult<TwinRelationship> {
  const parsed = twinRelationshipSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  return { ok: true, value: parsed.data };
}

/* ─────────────────────────────────────────────────────────────
 * Federation gate (kernel `requiresApprovalFor`; §16 vocabulary)
 * ────────────────────────────────────────────────────────────*/

export interface FederationGateRequest {
  /** Untrusted action name — unknown actions fail closed to DENY. */
  readonly action: string;
  readonly agreement: FederationAgreement;
  readonly approvalRef?: Identifier;
  /** Required for exchange_state; validated against the shared allowlist. */
  readonly fieldPath?: string;
  /** Supplied instant — this module never reads a wall clock. */
  readonly now: string;
}

export type FederationGateResult =
  | { readonly decision: Extract<AuthorizationDecision, "ALLOW">; readonly action: string }
  | {
      readonly decision: Exclude<AuthorizationDecision, "ALLOW">;
      readonly action: string;
      readonly reason: string;
    };

/**
 * Governed federation gate (kernel `requiresApprovalFor`: agreement,
 * state-exchange widening, cross-jurisdiction federation, revocation),
 * emitting the authorization engine's §16 decision vocabulary.
 * Fail-closed by construction:
 * - unknown actions are DENY;
 * - recording an agreement requires authorization evidence — cross-
 *   jurisdiction federations are named in the refusal;
 * - state exchange requires an ACTIVE, unexpired agreement and an exact
 *   in-scope field path — everything else is DENY, never absorbed;
 * - scope widening ALWAYS escalates — it is never an automatic decision,
 *   not even for the agreement's own initiator;
 * - revocation requires authorization evidence but is otherwise always
 *   available — severing is safety-positive and stays easy.
 */
export function federationGate(request: FederationGateRequest): FederationGateResult {
  const isKnownAction = (FEDERATION_ACTIONS as readonly string[]).includes(request.action);
  if (!isKnownAction) {
    return {
      decision: "DENY",
      action: request.action,
      reason: `unknown federation action — the gate speaks only: ${FEDERATION_ACTIONS.join(", ")}`,
    };
  }
  const action = request.action as FederationAction;

  const crossJurisdiction =
    request.agreement.initiatorJurisdictionRef !== undefined &&
    request.agreement.counterpartyJurisdictionRef !== undefined &&
    request.agreement.initiatorJurisdictionRef !== request.agreement.counterpartyJurisdictionRef;

  switch (action) {
    case "record_agreement": {
      if (request.approvalRef === undefined) {
        return {
          decision: "REQUIRE_APPROVAL",
          action,
          reason: crossJurisdiction
            ? "recording a cross-jurisdiction federation requires explicit authorization evidence (kernel requiresApprovalFor: cross-jurisdiction-federation)"
            : "recording a federation agreement requires explicit authorization evidence (kernel requiresApprovalFor: federation-agreement)",
        };
      }
      return { decision: "ALLOW", action };
    }
    case "exchange_state": {
      if (request.agreement.state !== "ACTIVE") {
        return {
          decision: "DENY",
          action,
          reason: `agreement is ${request.agreement.state}, not ACTIVE — state exchange fails closed outside an active agreement`,
        };
      }
      if (request.now >= request.agreement.expiresAt) {
        return {
          decision: "DENY",
          action,
          reason: "agreement has expired — expired federation fails closed and must be re-ratified, never silently extended",
        };
      }
      if (request.fieldPath === undefined) {
        return {
          decision: "DENY",
          action,
          reason: "no field path presented — shared state is exchanged per explicit field path only",
        };
      }
      if (!isFieldPathInScope(request.agreement, request.fieldPath)) {
        return {
          decision: "DENY",
          action,
          reason: "field path is outside the agreement's shared scope — undeclared mirroring fails closed",
        };
      }
      return { decision: "ALLOW", action };
    }
    case "widen_shared_scope": {
      return {
        decision: "ESCALATE",
        action,
        reason:
          "scope widening is never an automatic decision — it escalates to governance regardless of who asks (kernel requiresApprovalFor: state-exchange-widening)",
      };
    }
    case "revoke_federation": {
      if (request.approvalRef === undefined) {
        return {
          decision: "REQUIRE_APPROVAL",
          action,
          reason:
            "revocation is governed and recorded — present authorization evidence to sever (kernel requiresApprovalFor: federation-revocation)",
        };
      }
      return { decision: "ALLOW", action };
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * The twin-is-not-a-grant boundary (Constitution §10), typed
 * ────────────────────────────────────────────────────────────*/

/** The single typed refusal this surface can ever produce for twin data. */
export type TwinPresenceRefusalReason = "TWIN_PRESENCE_IS_NOT_A_GRANT";

export interface TwinDataAccessAttempt {
  readonly twinId: Identifier;
  /** Untrusted requested action — refused regardless of its value. */
  readonly requestedAction: string;
  /** Optional claimed tenancy — irrelevant to the verdict; recorded only. */
  readonly claimedTenantId?: string;
}

export type TwinDataGrantVerdict = {
  readonly granted: false;
  readonly reason: TwinPresenceRefusalReason;
  readonly twinId: Identifier;
  readonly detail: string;
};

/**
 * The ONLY function on this surface that maps twin data to an access
 * outcome (Constitution §10: a twin is not a permission bypass — having
 * information inside a twin grants nothing). It refuses every attempt,
 * structurally: the return type has no `granted: true` branch, so no caller
 * can derive an access grant from twin presence through this contract.
 * Legitimate access is decided by the authorization engine (phase 08) from
 * identity, tenant, role, relationship, policy and context — never from
 * what a twin happens to mirror.
 */
export function evaluateTwinDataAccessRequest(attempt: TwinDataAccessAttempt): TwinDataGrantVerdict {
  return {
    granted: false,
    reason: "TWIN_PRESENCE_IS_NOT_A_GRANT",
    twinId: attempt.twinId,
    detail:
      "twin data presence is not an authorization decision — access to the mirrored reality is granted by the authorization engine from identity, tenant, role, relationship, policy and context, never from twin contents",
  };
}

/** The set of access grants derivable from twin presence alone. */
export const TWIN_PRESENCE_GRANTS: readonly [] = [];
