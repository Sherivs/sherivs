/**
 * CoreGrid — H3-066 phase-46 twin-civilization contract tests
 * (mission G-066). Zod validation of the federation substrate surface:
 * §10 twin admission (identity/owner/tenant/state/history/capabilities/
 * policies structurally required), the twin-is-not-a-permission-bypass
 * boundary encoded structurally (accessGrant "none", authority "mirror",
 * the typed TWIN_PRESENCE_IS_NOT_A_GRANT refusal), tenant-spanning
 * federation, minimized/redacted/attributed shared-state exchange,
 * provenance-bearing relationships, the governed federation gate and the
 * terminal revocation lifecycle.
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  FEDERATION_ACTIONS,
  FEDERATION_STATES,
  MAX_SHARED_FIELD_PATHS,
  TWIN_PRESENCE_GRANTS,
  TWIN_KINDS,
  evaluateTwinDataAccessRequest,
  federationGate,
  federatedTwinRefSchema,
  federationAgreementSchema,
  isFieldPathInScope,
  isFederationTransitionAllowed,
  parseFederationAgreement,
  parseSharedStateEnvelope,
  parseTwinRelationship,
  sharedStateEnvelopeSchema,
  type FederationAgreement,
  type FederatedTwinRef,
} from "../../frontend/src/lib/twin-civilization/contracts";

const NOW = "2026-10-03T00:00:00.000Z";
const LATER = "2027-10-03T00:00:00.000Z";
const DIGEST = "a".repeat(64);

const PROVENANCE = {
  actorId: "agent:federation-worker-1",
  actorKind: "agent" as const,
  tenantId: "tenant_a",
  policyRef: "policy:federation-v1",
  traceId: "trace:fed-1",
  recordedAt: NOW,
};

function twinRef(overrides: Record<string, unknown> = {}, tenantId = "tenant_a"): Record<string, unknown> {
  return {
    twinId: `twin:${tenantId}-1`,
    twinKind: "entity",
    ownerRef: "owner:org-1",
    homeTenantId: tenantId,
    currentStateDigest: DIGEST,
    historyRef: "history:twin-1",
    capabilities: ["capability:mirror-state"],
    policyRefs: ["policy:twin-governance-v1"],
    recordedAt: NOW,
    ...overrides,
  };
}

function agreement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agreementId: "fed:agreement-1",
    initiator: twinRef({}, "tenant_a"),
    counterparty: twinRef({ twinId: "twin:tenant_b-1" }, "tenant_b"),
    state: "PROPOSED",
    accessGrant: "none",
    sharedFieldPaths: ["state.metrics.load"],
    classification: "internal",
    effectiveFrom: NOW,
    expiresAt: LATER,
    provenance: PROVENANCE,
    ...overrides,
  };
}

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    envelopeId: "env:1",
    agreementId: "fed:agreement-1",
    fieldPath: "state.metrics.load",
    classification: "internal",
    redacted: false,
    payloadDigest: DIGEST,
    sourceTenantId: "tenant_a",
    destinationTenantId: "tenant_b",
    authority: "mirror",
    provenance: PROVENANCE,
    exchangedAt: NOW,
    ...overrides,
  };
}

function parsedAgreement(overrides: Record<string, unknown> = {}): FederationAgreement {
  const parsed = parseFederationAgreement(agreement(overrides));
  if (!parsed.ok) throw new Error(`fixture refused: ${parsed.reason}`);
  return parsed.value;
}

describe("federated twin admission (Constitution §10)", () => {
  it("admits a twin presenting identity, owner, tenant, state, history, capabilities and policies", () => {
    const parsed = federatedTwinRefSchema.safeParse(twinRef());
    expect(parsed.success).toBe(true);
  });

  it("refuses an anonymous twin — identity is structurally required", () => {
    const anonymous = twinRef();
    delete anonymous.twinId;
    expect(federatedTwinRefSchema.safeParse(anonymous).success).toBe(false);
  });

  it("refuses an ownerless twin — ownership is structurally required", () => {
    const ownerless = twinRef();
    delete ownerless.ownerRef;
    expect(federatedTwinRefSchema.safeParse(ownerless).success).toBe(false);
  });

  it("refuses a tenant-less twin — tenancy is structurally required", () => {
    const detached = twinRef();
    delete detached.homeTenantId;
    expect(federatedTwinRefSchema.safeParse(detached).success).toBe(false);
  });

  it("refuses a stateless or history-less twin reference", () => {
    const stateless = twinRef();
    delete stateless.currentStateDigest;
    expect(federatedTwinRefSchema.safeParse(stateless).success).toBe(false);
    const historyless = twinRef();
    delete historyless.historyRef;
    expect(federatedTwinRefSchema.safeParse(historyless).success).toBe(false);
  });

  it("refuses a twin with no capabilities or no governing policies", () => {
    expect(federatedTwinRefSchema.safeParse(twinRef({ capabilities: [] })).success).toBe(false);
    expect(federatedTwinRefSchema.safeParse(twinRef({ policyRefs: [] })).success).toBe(false);
  });

  it("carries state by digest, never by value", () => {
    const inlined = twinRef({ currentStateDigest: { payload: "the actual mirrored state" } });
    expect(federatedTwinRefSchema.safeParse(inlined).success).toBe(false);
  });
});

describe("federation agreement (kernel federation:agree)", () => {
  it("accepts a complete, proposed, tenant-spanning agreement", () => {
    const parsed = parseFederationAgreement(agreement());
    expect(parsed.ok).toBe(true);
  });

  it("refuses unknown keys — strict surface", () => {
    expect(federationAgreementSchema.safeParse(agreement({ sneak_field: 1 })).success).toBe(false);
  });

  it("refuses a same-tenant pairing — federation spans tenants without merging them", () => {
    const parsed = parseFederationAgreement(
      agreement({ counterparty: twinRef({ twinId: "twin:tenant_a-2" }, "tenant_a") }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("not_a_federation");
      expect(parsed.issues[0].message).toMatch(/spans tenants without merging/i);
    }
  });

  it("refuses approved, active or suspended states without authorization evidence", () => {
    for (const state of ["APPROVED", "ACTIVE", "SUSPENDED"]) {
      const parsed = parseFederationAgreement(agreement({ state }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("missing_authorization");
    }
    const proposed = parseFederationAgreement(agreement({ state: "PROPOSED" }));
    expect(proposed.ok).toBe(true);
  });

  it("accepts an approved state when authorization evidence is present", () => {
    const parsed = parseFederationAgreement(agreement({ state: "APPROVED", approvalRef: "approval:fed-1" }));
    expect(parsed.ok).toBe(true);
  });

  it("refuses an ACTIVE agreement with an empty shared scope — mirroring is always explicit", () => {
    const parsed = parseFederationAgreement(
      agreement({ state: "ACTIVE", approvalRef: "approval:fed-1", sharedFieldPaths: [] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("scope_violation");
  });

  it("refuses an unbounded or inverted validity window — expiry is mandatory", () => {
    const inverted = parseFederationAgreement(agreement({ expiresAt: NOW }));
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.reason).toBe("invalid_window");
    const unparseable = parseFederationAgreement(agreement({ expiresAt: "never" }));
    expect(unparseable.ok).toBe(false);
    if (!unparseable.ok) expect(unparseable.reason).toBe("invalid_shape");
  });

  it("structurally cannot express an access grant — the literal is fixed to none", () => {
    const granting = agreement({ accessGrant: "full" });
    expect(federationAgreementSchema.safeParse(granting).success).toBe(false);
    const withoutGrant = agreement();
    delete withoutGrant.accessGrant;
    expect(federationAgreementSchema.safeParse(withoutGrant).success).toBe(false);
  });

  it("bounds the shared scope to the declared ceiling", () => {
    const paths = Array.from({ length: MAX_SHARED_FIELD_PATHS + 1 }, (_, i) => `state.field${i}`);
    expect(federationAgreementSchema.safeParse(agreement({ sharedFieldPaths: paths })).success).toBe(false);
  });
});

describe("federation lifecycle (revocation is terminal)", () => {
  it("permits only the declared forward transitions", () => {
    expect(isFederationTransitionAllowed("PROPOSED", "APPROVED")).toBe(true);
    expect(isFederationTransitionAllowed("APPROVED", "ACTIVE")).toBe(true);
    expect(isFederationTransitionAllowed("ACTIVE", "SUSPENDED")).toBe(true);
    expect(isFederationTransitionAllowed("SUSPENDED", "ACTIVE")).toBe(true);
    for (const from of FEDERATION_STATES.filter((state) => state !== "REVOKED")) {
      expect(isFederationTransitionAllowed(from, "REVOKED")).toBe(true);
    }
  });

  it("refuses lifecycle skips — approval precedes activation", () => {
    expect(isFederationTransitionAllowed("PROPOSED", "ACTIVE")).toBe(false);
    expect(isFederationTransitionAllowed("PROPOSED", "SUSPENDED")).toBe(false);
  });

  it("refuses resurrection — a revoked federation never reactivates", () => {
    expect(isFederationTransitionAllowed("REVOKED", "ACTIVE")).toBe(false);
    expect(isFederationTransitionAllowed("REVOKED", "PROPOSED")).toBe(false);
    expect(isFederationTransitionAllowed("REVOKED", "REVOKED")).toBe(false);
  });

  it("declares the full lifecycle state set", () => {
    expect(FEDERATION_STATES).toEqual(["PROPOSED", "APPROVED", "ACTIVE", "SUSPENDED", "REVOKED"]);
  });
});

describe("shared-state envelope (kernel federation:share-state)", () => {
  it("accepts a minimized, attributed, digest-carrying envelope", () => {
    const parsed = parseSharedStateEnvelope(envelope());
    expect(parsed.ok).toBe(true);
  });

  it("carries the payload by digest only — the payload itself never travels", () => {
    const inlined = envelope({ payload: "the exchanged content itself" });
    expect(sharedStateEnvelopeSchema.safeParse(inlined).success).toBe(false);
  });

  it("refuses a same-tenant transfer — federated exchange spans tenants", () => {
    const parsed = parseSharedStateEnvelope(envelope({ destinationTenantId: "tenant_a" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("cross_tenant_violation");
  });

  it("refuses an unredacted restricted envelope — redaction fails closed", () => {
    const parsed = parseSharedStateEnvelope(envelope({ classification: "restricted", redacted: false }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("redaction_violation");
      expect(parsed.issues[0].path).toBe("redacted");
    }
    const redacted = parseSharedStateEnvelope(envelope({ classification: "restricted", redacted: true }));
    expect(redacted.ok).toBe(true);
  });

  it("structurally cannot express authority — the mirror literal is fixed", () => {
    const empowered = envelope({ authority: "grant" });
    expect(sharedStateEnvelopeSchema.safeParse(empowered).success).toBe(false);
    const withoutAuthority = envelope();
    delete withoutAuthority.authority;
    expect(sharedStateEnvelopeSchema.safeParse(withoutAuthority).success).toBe(false);
  });

  it("is attributed to the agreement that permitted it — attribution is mandatory", () => {
    const unattributed = envelope();
    delete unattributed.agreementId;
    expect(sharedStateEnvelopeSchema.safeParse(unattributed).success).toBe(false);
  });
});

describe("shared scope is an exact allowlist", () => {
  const active = parsedAgreement({
    state: "ACTIVE",
    approvalRef: "approval:fed-1",
    sharedFieldPaths: ["state.metrics.load", "state.health.summary"],
  });

  it("admits exactly declared paths", () => {
    expect(isFieldPathInScope(active, "state.metrics.load")).toBe(true);
    expect(isFieldPathInScope(active, "state.health.summary")).toBe(true);
  });

  it("refuses undeclared paths — including prefixes of declared ones", () => {
    expect(isFieldPathInScope(active, "state.metrics")).toBe(false);
    expect(isFieldPathInScope(active, "state.metrics.load.average")).toBe(false);
    expect(isFieldPathInScope(active, "state.secrets.raw")).toBe(false);
    expect(isFieldPathInScope(active, "")).toBe(false);
  });
});

describe("cross-twin relationships (Constitution §11)", () => {
  const relationship = (): Record<string, unknown> => ({
    relationshipId: "rel:1",
    agreementId: "fed:agreement-1",
    fromTwinId: "twin:tenant_a-1",
    toTwinId: "twin:tenant_b-1",
    kind: "federates_with",
    fromTenantId: "tenant_a",
    toTenantId: "tenant_b",
    confidence: { value: 0.8, derivedFrom: ["evidence_quality"], method: "policy-weighted aggregation" },
    provenance: PROVENANCE,
    mappedAt: NOW,
  });

  it("accepts a relationship with provenance, ownership, agreement and explained confidence", () => {
    expect(parseTwinRelationship(relationship()).ok).toBe(true);
  });

  it("refuses anonymous relationships — provenance is mandatory", () => {
    const anonymous = relationship();
    delete anonymous.provenance;
    expect(parseTwinRelationship(anonymous).ok).toBe(false);
  });

  it("refuses relationships outside an agreement — no anonymous cross-twin linkage", () => {
    const detached = relationship();
    delete detached.agreementId;
    expect(parseTwinRelationship(detached).ok).toBe(false);
  });

  it("refuses unexplained confidence — a bare number is not confidence", () => {
    expect(
      parseTwinRelationship({ ...relationship(), confidence: { value: 0.9 } }).ok,
    ).toBe(false);
  });

  it("refuses kinds outside the neutral vocabulary", () => {
    expect(parseTwinRelationship({ ...relationship(), kind: "owns" }).ok).toBe(false);
  });
});

describe("federation gate (§16 vocabulary; kernel requiresApprovalFor)", () => {
  const proposed = parsedAgreement();
  const active = parsedAgreement({ state: "ACTIVE", approvalRef: "approval:fed-1" });
  const crossJurisdiction = parsedAgreement({
    initiatorJurisdictionRef: "jurisdiction:j1",
    counterpartyJurisdictionRef: "jurisdiction:j2",
  });

  it("denies unknown actions — the gate speaks only its declared vocabulary", () => {
    const denied = federationGate({ action: "grant_access", agreement: active, now: NOW });
    expect(denied.decision).toBe("DENY");
    if (denied.decision === "DENY") expect(denied.reason).toMatch(/unknown federation action/i);
    expect(FEDERATION_ACTIONS).not.toContain("grant_access");
  });

  it("requires authorization to record an agreement — fail closed", () => {
    const unapproved = federationGate({ action: "record_agreement", agreement: proposed, now: NOW });
    expect(unapproved.decision).toBe("REQUIRE_APPROVAL");
    const approved = federationGate({
      action: "record_agreement",
      agreement: proposed,
      approvalRef: "approval:fed-1",
      now: NOW,
    });
    expect(approved.decision).toBe("ALLOW");
  });

  it("names cross-jurisdiction federation in the refusal", () => {
    const refused = federationGate({ action: "record_agreement", agreement: crossJurisdiction, now: NOW });
    expect(refused.decision).toBe("REQUIRE_APPROVAL");
    if (refused.decision === "REQUIRE_APPROVAL") expect(refused.reason).toMatch(/cross-jurisdiction/i);
  });

  it("denies state exchange outside an ACTIVE agreement", () => {
    const denied = federationGate({
      action: "exchange_state",
      agreement: proposed,
      fieldPath: "state.metrics.load",
      now: NOW,
    });
    expect(denied.decision).toBe("DENY");
  });

  it("denies state exchange on an expired agreement — expiry is never silently extended", () => {
    const denied = federationGate({
      action: "exchange_state",
      agreement: active,
      fieldPath: "state.metrics.load",
      now: LATER,
    });
    expect(denied.decision).toBe("DENY");
    if (denied.decision === "DENY") expect(denied.reason).toMatch(/expired/i);
  });

  it("denies state exchange outside the declared shared scope", () => {
    const denied = federationGate({
      action: "exchange_state",
      agreement: active,
      fieldPath: "state.secrets.raw",
      now: NOW,
    });
    expect(denied.decision).toBe("DENY");
    if (denied.decision === "DENY") expect(denied.reason).toMatch(/scope/i);
    const missingPath = federationGate({ action: "exchange_state", agreement: active, now: NOW });
    expect(missingPath.decision).toBe("DENY");
  });

  it("allows in-scope exchange on an active, unexpired agreement", () => {
    const allowed = federationGate({
      action: "exchange_state",
      agreement: active,
      fieldPath: "state.metrics.load",
      now: NOW,
    });
    expect(allowed.decision).toBe("ALLOW");
  });

  it("always escalates scope widening — even for the agreement's own initiator with evidence", () => {
    const escalated = federationGate({
      action: "widen_shared_scope",
      agreement: active,
      approvalRef: "approval:fed-1",
      now: NOW,
    });
    expect(escalated.decision).toBe("ESCALATE");
  });

  it("governs revocation but keeps severing available — fail closed, then allowed", () => {
    const ungoverned = federationGate({ action: "revoke_federation", agreement: active, now: NOW });
    expect(ungoverned.decision).toBe("REQUIRE_APPROVAL");
    const severed = federationGate({
      action: "revoke_federation",
      agreement: active,
      approvalRef: "approval:revoke-1",
      now: NOW,
    });
    expect(severed.decision).toBe("ALLOW");
  });
});

describe("the twin is not a permission bypass (Constitution §10, typed)", () => {
  it("refuses every access request derived from twin presence — for every kind of attempt", () => {
    const attempts = [
      { twinId: "twin:tenant_a-1", requestedAction: "read" },
      { twinId: "twin:tenant_a-1", requestedAction: "write" },
      { twinId: "twin:tenant_b-1", requestedAction: "delete", claimedTenantId: "tenant_b" },
      { twinId: "twin:tenant_a-1", requestedAction: "admin:escalate", claimedTenantId: "tenant_a" },
      { twinId: "twin:any", requestedAction: "" },
    ];
    for (const attempt of attempts) {
      const verdict = evaluateTwinDataAccessRequest(attempt);
      expect(verdict.granted).toBe(false);
      expect(verdict.reason).toBe("TWIN_PRESENCE_IS_NOT_A_GRANT");
      expect(verdict.detail).toMatch(/not an authorization decision/i);
    }
  });

  it("offers no granted:true branch — the verdict type carries refusal only", () => {
    const verdict = evaluateTwinDataAccessRequest({ twinId: "twin:x", requestedAction: "read" });
    const keys = Object.keys(verdict);
    expect(keys).toContain("granted");
    expect(keys).toContain("reason");
    expect((verdict as { granted: unknown }).granted).toBe(false);
  });

  it("derives an empty set of grants from twin presence", () => {
    expect(TWIN_PRESENCE_GRANTS).toHaveLength(0);
  });

  it("never issues a decision from mirrored data — envelopes carry mirror authority only", () => {
    const parsed = parseSharedStateEnvelope(envelope());
    if (!parsed.ok) throw new Error("fixture refused");
    expect(parsed.value.authority).toBe("mirror");
    const active = parseFederationAgreement(agreement({ state: "ACTIVE", approvalRef: "approval:fed-1" }));
    if (!active.ok) throw new Error("fixture refused");
    expect(active.value.accessGrant).toBe("none");
  });

  it("keeps the neutral twin vocabulary free of domain terms", () => {
    expect(TWIN_KINDS).toEqual([
      "entity",
      "process",
      "environment",
      "infrastructure",
      "intelligence",
      "comprehensive",
    ]);
  });
});

describe("fail-closed parsing produces no partial artifacts", () => {
  it("reports structured issues and never a partial agreement", () => {
    const bad = agreement();
    bad.agreementId = "";
    const parsed = parseFederationAgreement(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.length).toBeGreaterThan(0);
  });

  it("reports structured issues and never a partial envelope", () => {
    const bad = envelope();
    bad.fieldPath = "";
    const parsed = parseSharedStateEnvelope(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.length).toBeGreaterThan(0);
  });
});
