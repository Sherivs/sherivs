/**
 * CoreGrid — onboarding reality discovery tests (MISSION-R-43 / V1CAP-090/091).
 * Phase discipline, the human-bootstrap identity rule, the declaration ->
 * evidence -> verification flow, finalization gating and append-only law,
 * partial-state explicitness, cross-tenant isolation, and kernel
 * envelope/bi-temporal compatibility of every declaration.
 */
import { describe, expect, it } from "vitest";
import {
  DISCOVERY_ENTITY_OBJECT_TYPE,
  DISCOVERY_EVIDENCE_OBJECT_TYPES,
  DISCOVERY_PHASES,
  DISCOVERY_OBJECT_KINDS,
  acceptDeclarationAsUnverified,
  advanceDiscoveryPhase,
  beginRealityDiscovery,
  blockingDeclarationIds,
  bootstrapTenantOrg,
  declareDiscoveryObject,
  discoveryFinalizationGate,
  discoveryLifecycleStatus,
  establishAdminIdentity,
  finalizeDiscovery,
  recordDeclarationEvidence,
  type DeclareDiscoveryObjectInput,
  type DiscoveryActor,
  type DiscoveryDenyCode,
  type DiscoveryDecision,
  type OrgBootstrapOp,
  type RealityDiscovery,
} from "../../frontend/src/lib/onboarding/reality-discovery";
import type { KernelBiTemporalInput, KernelObjectEnvelopeInput } from "../../frontend/src/lib/kernel/reality";
import {
  DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
  EVIDENCE_OBJECT_TYPE,
  type EvidenceCaptureInput,
} from "../../frontend/src/lib/evidence/capture";
import { orgUnitRef, roleRef } from "../../frontend/src/lib/org-model";
import { tenantId, type TenantId } from "../../frontend/src/lib/tenant-core";

const NOW = "2026-10-02T09:00:00.000Z";
const LATER = "2026-10-02T10:00:00.000Z";
const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");

const ADMIN: DiscoveryActor = { identityRef: "human-admin-1", classification: "human" };
const AI_ACTOR: DiscoveryActor = { identityRef: "agent:onboarding-assistant", classification: "ai" };

const BOOTSTRAP_OPS: readonly OrgBootstrapOp[] = [
  { op: "declare_role", roleRef: "org_admin" },
  {
    op: "create_unit",
    id: "org-root-a",
    kind: "organization",
    parentRef: null,
    profile: { name: "Tenant A Organization" },
  },
  {
    op: "add_membership",
    id: "memb-admin-a",
    orgUnitRef: "org-root-a",
    principalRef: ADMIN.identityRef,
    roleRef: "org_admin",
  },
];

function expectOk<T>(result: DiscoveryDecision<T>): T {
  if (!result.ok) throw new Error(`expected ok, denied (${result.code}): ${result.reason}`);
  return result.value;
}

function expectDeny<T>(result: DiscoveryDecision<T>, code: DiscoveryDenyCode): void {
  if (result.ok) throw new Error(`expected deny ${code}, but the operation succeeded`);
  expect(result.code).toBe(code);
  return;
}

function envelopeFor(tenant: TenantId): KernelObjectEnvelopeInput {
  return {
    objectType: DISCOVERY_ENTITY_OBJECT_TYPE,
    schemaVersion: "1.0",
    status: "active",
    createdBy: ADMIN.identityRef,
    updatedBy: ADMIN.identityRef,
    provenance: {
      source: "onboarding-declaration",
      sourceRef: null,
      recordedBy: ADMIN.identityRef,
      originTenantId: tenant,
      generatedByAi: false,
      verified: false,
    },
    policyContext: {},
    traceId: "trace-discovery-1",
    correlationId: "corr-discovery-1",
    declaredOrigin: "discovery-1",
  };
}

function biTemporal(): KernelBiTemporalInput {
  return { validFrom: NOW };
}

function declareInput(
  overrides: Partial<DeclareDiscoveryObjectInput> = {},
): DeclareDiscoveryObjectInput {
  return {
    declarationId: "decl-building-1",
    tenantRef: TENANT_A,
    kind: "building",
    label: "Main campus building",
    biTemporal: biTemporal(),
    envelope: envelopeFor(TENANT_A),
    actor: ADMIN,
    declaredAt: NOW,
    ...overrides,
  };
}

function evidenceInput(
  overrides: Partial<EvidenceCaptureInput> = {},
): EvidenceCaptureInput {
  return {
    evidenceId: "ev-building-1",
    evidenceType: "site_survey",
    tenantId: TENANT_A,
    evidenceClass: "direct_observation",
    claim: { observed: "decl-building-1 exists on site" },
    retentionPolicyId: DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
    capturedBy: ADMIN.identityRef,
    capturedAt: LATER,
    envelope: {
      objectType: EVIDENCE_OBJECT_TYPE,
      schemaVersion: "1.0",
      status: "active",
      createdBy: ADMIN.identityRef,
      updatedBy: ADMIN.identityRef,
      provenance: {
        source: "site-survey",
        sourceRef: null,
        recordedBy: ADMIN.identityRef,
        originTenantId: TENANT_A,
        generatedByAi: false,
        verified: true,
      },
      policyContext: {},
      traceId: "trace-discovery-1",
      correlationId: "corr-discovery-1",
      causationId: "discovery-1",
    },
    ...overrides,
  };
}

/** Flow helpers — each stage asserts the transitions actually happened. */

function begun(): RealityDiscovery {
  return expectOk(
    beginRealityDiscovery({
      discoveryId: "discovery-1",
      tenantRef: TENANT_A,
      actor: ADMIN,
      startedAt: NOW,
    }),
  );
}

function bootstrapped(): RealityDiscovery {
  const state = expectOk(bootstrapTenantOrg(begun(), BOOTSTRAP_OPS, ADMIN));
  return expectOk(advanceDiscoveryPhase(state));
}

function withAdmin(): RealityDiscovery {
  const state = expectOk(
    establishAdminIdentity(bootstrapped(), {
      identityRef: ADMIN.identityRef,
      classification: "human",
      establishedAt: NOW,
    }),
  );
  // Advancing out of identity_establishment lands in discovery_declaration.
  return expectOk(advanceDiscoveryPhase(state));
}

function declarationPhase(): RealityDiscovery {
  return withAdmin();
}

function declared(): RealityDiscovery {
  return expectOk(declareDiscoveryObject(declarationPhase(), declareInput()));
}

function verificationPhase(): RealityDiscovery {
  return expectOk(advanceDiscoveryPhase(declared()));
}

function verifiedDeclaration(): RealityDiscovery {
  return expectOk(
    recordDeclarationEvidence(verificationPhase(), {
      declarationId: "decl-building-1",
      evidence: evidenceInput(),
    }),
  );
}

function finalizedDiscovery(): RealityDiscovery {
  return expectOk(
    finalizeDiscovery(verifiedDeclaration(), {
      finalizationId: "final-1",
      finalizedBy: ADMIN.identityRef,
      classification: "human",
      finalizedAt: LATER,
      note: "site reality confirmed",
    }),
  );
}

/* ─────────────────────────────────────────────────────────────
 * Phase discipline
 * ────────────────────────────────────────────────────────────*/

describe("phase discipline (out-of-order rejection)", () => {
  it("orders the phase vocabulary and never allows skipping", () => {
    expect(DISCOVERY_PHASES).toEqual([
      "tenant_bootstrap",
      "identity_establishment",
      "discovery_declaration",
      "discovery_verification",
      "finalized",
    ]);
  });

  it("rejects declarations outside the declaration phase", () => {
    expectDeny(
      declareDiscoveryObject(bootstrapped(), declareInput()),
      "phase_order_violation",
    );
  });

  it("rejects admin establishment outside the identity phase", () => {
    expectDeny(
      establishAdminIdentity(begun(), {
        identityRef: ADMIN.identityRef,
        classification: "human",
        establishedAt: NOW,
      }),
      "phase_order_violation",
    );
  });

  it("rejects evidence recording outside the verification phase", () => {
    expectDeny(
      recordDeclarationEvidence(declared(), {
        declarationId: "decl-building-1",
        evidence: evidenceInput(),
      }),
      "phase_order_violation",
    );
  });

  it("refuses to close tenant_bootstrap without an org-model root unit", () => {
    expectDeny(advanceDiscoveryPhase(begun()), "phase_exit_requirements_unmet");
  });

  it("refuses to close identity_establishment without the admin identity", () => {
    expectDeny(advanceDiscoveryPhase(bootstrapped()), "phase_exit_requirements_unmet");
  });

  it("refuses re-running a completed phase operation", () => {
    expectDeny(
      establishAdminIdentity(withAdmin(), {
        identityRef: ADMIN.identityRef,
        classification: "human",
        establishedAt: NOW,
      }),
      "phase_order_violation",
    );
  });

  it("routes the verification-phase exit exclusively through finalization", () => {
    expectDeny(advanceDiscoveryPhase(verificationPhase()), "finalization_act_required");
  });

  it("never advances a finalized discovery again", () => {
    expectDeny(advanceDiscoveryPhase(finalizedDiscovery()), "phase_order_violation");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Human bootstrap identity rule (AI agents cannot bootstrap a tenant)
 * ────────────────────────────────────────────────────────────*/

describe("AI agents cannot bootstrap a tenant", () => {
  it("rejects an AI actor at discovery start", () => {
    expectDeny(
      beginRealityDiscovery({
        discoveryId: "discovery-1",
        tenantRef: TENANT_A,
        actor: AI_ACTOR,
        startedAt: NOW,
      }),
      "ai_bootstrap_rejected",
    );
  });

  it("rejects an AI actor applying tenant bootstrap operations", () => {
    expectDeny(bootstrapTenantOrg(begun(), BOOTSTRAP_OPS, AI_ACTOR), "ai_bootstrap_rejected");
  });

  it("rejects an AI identity as the initial admin", () => {
    expectDeny(
      establishAdminIdentity(bootstrapped(), {
        identityRef: "agent:principal-admin",
        classification: "ai",
        establishedAt: NOW,
      }),
      "ai_bootstrap_rejected",
    );
  });

  it("rejects an AI actor accepting a declaration as unverified", () => {
    expectDeny(
      acceptDeclarationAsUnverified(verificationPhase(), {
        declarationId: "decl-building-1",
        acceptedBy: AI_ACTOR.identityRef,
        classification: "ai",
        reason: "assistant believes the site exists",
        acceptedAt: LATER,
      }),
      "ai_governance_act_rejected",
    );
  });

  it("rejects an AI finalizer", () => {
    expectDeny(
      finalizeDiscovery(verificationPhase(), {
        finalizationId: "final-ai",
        finalizedBy: AI_ACTOR.identityRef,
        classification: "ai",
        finalizedAt: LATER,
      }),
      "ai_governance_act_rejected",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Declaration -> evidence -> verification flow
 * ────────────────────────────────────────────────────────────*/

describe("declaration -> evidence -> verification flow", () => {
  it("drives the full governed path from an empty tenant to a finalized discovery", () => {
    const state = finalizedDiscovery();
    expect(state.phase).toBe("finalized");
    expect(state.adminIdentityRef).toBe(ADMIN.identityRef);
    expect(state.orgState.units.get(orgUnitRef("org-root-a"))?.parentRef).toBeNull();
    expect(state.orgState.declaredRoles.get(TENANT_A)?.has(roleRef("org_admin"))).toBe(true);

    const declaration = state.declarations.get("decl-building-1");
    expect(declaration?.verification).toBe("verified");
    expect(declaration?.evidenceRefs).toEqual(["ev-building-1"]);

    const gate = discoveryFinalizationGate(state);
    if (gate.gate !== "open") throw new Error("gate must be open after finalization");
    expect(gate.finalization.finalizationId).toBe("final-1");
    expect(gate.finalization.verifiedDeclarationIds).toEqual(["decl-building-1"]);
    expect(gate.finalization.actEvidenceId).toBe("final-1:act");

    const act = state.evidence.get("final-1:act");
    expect(act?.evidence_type).toBe("discovery_finalization");
    expect(act?.evidence_class).toBe("attested");
    expect(act?.claim.finalization).toMatchObject({
      discovery_id: "discovery-1",
      verified_declaration_ids: ["decl-building-1"],
    });
  });

  it("requires bootstrap tenant structure to come from org-model primitives only", () => {
    // Still inside tenant_bootstrap: one root created through the primitives.
    const state = expectOk(bootstrapTenantOrg(begun(), BOOTSTRAP_OPS, ADMIN));
    expect(state.orgState.units.size).toBe(1);
    expect(state.orgState.units.get(orgUnitRef("org-root-a"))?.tenantRef).toBe(TENANT_A);
    expect(state.orgState.units.get(orgUnitRef("org-root-a"))?.parentRef).toBeNull();
    expect(state.orgState.declaredRoles.get(TENANT_A)?.has(roleRef("org_admin"))).toBe(true);
    // org-model deny propagates: a second root is refused by the org model itself.
    expectDeny(
      bootstrapTenantOrg(
        state,
        [
          {
            op: "create_unit",
            id: "org-root-a-2",
            kind: "organization",
            parentRef: null,
            profile: { name: "Second root" },
          },
        ],
        ADMIN,
      ),
      "org_primitive_denied",
    );
  });

  it("rejects unknown declarations and duplicate evidence", () => {
    expectDeny(
      recordDeclarationEvidence(verificationPhase(), {
        declarationId: "decl-ghost",
        evidence: evidenceInput(),
      }),
      "unknown_declaration",
    );
    const state = verifiedDeclaration();
    expectDeny(
      recordDeclarationEvidence(state, {
        declarationId: "decl-building-1",
        evidence: evidenceInput(),
      }),
      "duplicate_evidence",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Unverified never claims verified
 * ────────────────────────────────────────────────────────────*/

describe("unverified never claims verified", () => {
  it("keeps a declaration explicitly unverified when only quarantine evidence exists", () => {
    const state = expectOk(
      recordDeclarationEvidence(verificationPhase(), {
        declarationId: "decl-building-1",
        evidence: evidenceInput({
          evidenceId: "ev-ai-derived-1",
          evidenceClass: "derived",
          capturedBy: "assistant-ai",
          envelope: {
            ...evidenceInput().envelope,
            createdBy: "assistant-ai",
            updatedBy: "assistant-ai",
            provenance: {
              source: "assistant-ai:inference",
              sourceRef: null,
              recordedBy: "assistant-ai",
              originTenantId: TENANT_A,
              generatedByAi: true,
              verified: false,
            },
          },
        }),
      }),
    );
    const declaration = state.declarations.get("decl-building-1");
    expect(declaration?.verification).toBe("unverified");
    expect(declaration?.evidenceRefs).toEqual(["ev-ai-derived-1"]);
    expect(state.evidence.has("ev-ai-derived-1")).toBe(true);
    expect(blockingDeclarationIds(state)).toEqual(["decl-building-1"]);
    expectDeny(
      finalizeDiscovery(state, {
        finalizationId: "final-x",
        finalizedBy: ADMIN.identityRef,
        classification: "human",
        finalizedAt: LATER,
      }),
      "blocking_declarations_outstanding",
    );
  });

  it("leaves a declaration with no evidence explicitly unverified and blocking", () => {
    expect(blockingDeclarationIds(verificationPhase())).toEqual(["decl-building-1"]);
    expectDeny(
      finalizeDiscovery(verificationPhase(), {
        finalizationId: "final-x",
        finalizedBy: ADMIN.identityRef,
        classification: "human",
        finalizedAt: LATER,
      }),
      "blocking_declarations_outstanding",
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Finalization gating
 * ────────────────────────────────────────────────────────────*/

describe("finalization gating", () => {
  it("blocks finalization while any declaration is unverified, naming it", () => {
    const state = expectOk(
      declareDiscoveryObject(
        declared(),
        declareInput({
          declarationId: "decl-device-1",
          kind: "device",
          label: "Hallway access reader",
        }),
      ),
    );
    const gated = expectOk(advanceDiscoveryPhase(state));
    const result = finalizeDiscovery(gated, {
      finalizationId: "final-1",
      finalizedBy: ADMIN.identityRef,
      classification: "human",
      finalizedAt: LATER,
    });
    expectDeny(result, "blocking_declarations_outstanding");
    if (result.ok) throw new Error("must not finalize");
    expect(result.reason).toContain("decl-building-1");
    expect(result.reason).toContain("decl-device-1");
  });

  it("finalizes once every blocking declaration is verified or accepted-unverified", () => {
    const twoDeclarations = expectOk(
      declareDiscoveryObject(
        declared(),
        declareInput({
          declarationId: "decl-device-1",
          kind: "device",
          label: "Hallway access reader",
        }),
      ),
    );
    const verified = expectOk(
      recordDeclarationEvidence(expectOk(advanceDiscoveryPhase(twoDeclarations)), {
        declarationId: "decl-building-1",
        evidence: evidenceInput(),
      }),
    );
    const accepted = expectOk(
      acceptDeclarationAsUnverified(verified, {
        declarationId: "decl-device-1",
        acceptedBy: ADMIN.identityRef,
        classification: "human",
        reason: "vendor telemetry pending; proceeding knowingly",
        acceptedAt: LATER,
      }),
    );
    const declaration = accepted.declarations.get("decl-device-1");
    expect(declaration?.verification).toBe("accepted_unverified");
    expect(declaration?.acceptance?.reason).toContain("knowingly");
    expect(accepted.declarations.get("decl-building-1")?.verification).toBe("verified");

    const state = expectOk(
      finalizeDiscovery(accepted, {
        finalizationId: "final-1",
        finalizedBy: ADMIN.identityRef,
        classification: "human",
        finalizedAt: LATER,
      }),
    );
    expect(state.finalization?.acceptedUnverified).toEqual([
      {
        declarationId: "decl-device-1",
        acceptedBy: ADMIN.identityRef,
        reason: "vendor telemetry pending; proceeding knowingly",
        acceptedAt: LATER,
      },
    ]);
    expect(state.finalization?.verifiedDeclarationIds).toEqual(["decl-building-1"]);
    expect(blockingDeclarationIds(state)).toEqual([]);
  });

  it("allows finalizing a tenant that declared nothing (empty discovered reality)", () => {
    const verification = expectOk(advanceDiscoveryPhase(withAdmin()));
    const finalized = expectOk(
      finalizeDiscovery(verification, {
        finalizationId: "final-empty",
        finalizedBy: ADMIN.identityRef,
        classification: "human",
        finalizedAt: LATER,
      }),
    );
    expect(finalized.finalization?.verifiedDeclarationIds).toEqual([]);
    expect(finalized.finalization?.acceptedUnverified).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Append-only finalization
 * ────────────────────────────────────────────────────────────*/

describe("append-only finalization", () => {
  it("rejects re-finalization and preserves the original record verbatim", () => {
    const state = finalizedDiscovery();
    const before = state.finalization;
    expectDeny(
      finalizeDiscovery(state, {
        finalizationId: "final-2",
        finalizedBy: ADMIN.identityRef,
        classification: "human",
        finalizedAt: LATER,
      }),
      "already_finalized",
    );
    expect(state.finalization).toBe(before);
    expect(Object.isFrozen(state.finalization)).toBe(true);
  });

  it("retains the discovery record set after finalization (nothing removed)", () => {
    const state = finalizedDiscovery();
    expect(state.declarations.size).toBe(1);
    expect(state.evidence.size).toBe(2);
    expect(state.evidence.has("ev-building-1")).toBe(true);
    expect(state.evidence.has("final-1:act")).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Partial onboarding is explicit, never silently complete
 * ────────────────────────────────────────────────────────────*/

describe("partial onboarding is a first-class explicit state", () => {
  it("reports mid_onboarding at every pre-finalization stage with a closed gate", () => {
    const stages: readonly RealityDiscovery[] = [
      begun(),
      expectOk(bootstrapTenantOrg(begun(), BOOTSTRAP_OPS, ADMIN)),
      bootstrapped(),
      withAdmin(),
      declarationPhase(),
      declared(),
      verificationPhase(),
      verifiedDeclaration(),
    ];
    for (const stage of stages) {
      expect(stage.status).toBe("mid_onboarding");
      expect(discoveryLifecycleStatus(stage)).toBe("mid_onboarding");
      const gate = discoveryFinalizationGate(stage);
      expect(gate.gate).toBe("closed");
      if (gate.gate === "closed") {
        expect(gate.reason).toContain("mid_onboarding");
        expect(gate.reason).toContain(stage.phase);
      }
    }
  });

  it("reports finalized only after the finalization act exists", () => {
    const state = finalizedDiscovery();
    expect(state.status).toBe("finalized");
    expect(discoveryLifecycleStatus(state)).toBe("finalized");
    expect(discoveryFinalizationGate(state).gate).toBe("open");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Cross-tenant isolation
 * ────────────────────────────────────────────────────────────*/

describe("cross-tenant isolation", () => {
  it("rejects declarations declared for another tenant", () => {
    expectDeny(
      declareDiscoveryObject(declarationPhase(), declareInput({ tenantRef: TENANT_B })),
      "cross_tenant",
    );
  });

  it("rejects declaration envelopes whose provenance originates in another tenant", () => {
    const baseEnvelope = envelopeFor(TENANT_A);
    expectDeny(
      declareDiscoveryObject(
        declarationPhase(),
        declareInput({
          envelope: {
            ...baseEnvelope,
            provenance: { ...baseEnvelope.provenance, originTenantId: TENANT_B },
          },
        }),
      ),
      "cross_tenant",
    );
  });

  it("rejects evidence captured under another tenant", () => {
    expectDeny(
      recordDeclarationEvidence(verificationPhase(), {
        declarationId: "decl-building-1",
        evidence: evidenceInput({ tenantId: TENANT_B }),
      }),
      "cross_tenant",
    );
  });

  it("keeps discovery record sets tenant-pure", () => {
    const tenantB = expectOk(
      beginRealityDiscovery({
        discoveryId: "discovery-b",
        tenantRef: TENANT_B,
        actor: { identityRef: "human-admin-b", classification: "human" },
        startedAt: NOW,
      }),
    );
    expect(tenantB.declarations.size).toBe(0);
    expect(tenantB.evidence.size).toBe(0);
    expect(tenantB.orgState.units.size).toBe(0);
    for (const declaration of finalizedDiscovery().declarations.values()) {
      expect(declaration.tenantRef).toBe(TENANT_A);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Envelope & bi-temporal compatibility
 * ────────────────────────────────────────────────────────────*/

describe("envelope & bi-temporal compatibility of declarations", () => {
  it("stamps declarations as canonical envelope-bearing kernel entities", () => {
    const declaration = declared().declarations.get("decl-building-1");
    expect(declaration === undefined).toBe(false);
    if (declaration === undefined) throw new Error("declaration must exist");
    const row = declaration.kernelRow;
    expect(row.object_type).toBe("core.entity");
    expect(row.entity_type).toBe("building");
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.schema_version).toBe("1.0");
    expect(row.provenance.source).toBe("onboarding-declaration");
    expect(row.provenance.originTenantId).toBe(TENANT_A);
    expect(row.trace_id).toBe("trace-discovery-1");
    expect(row.correlation_id).toBe("corr-discovery-1");
    expect(row.declared_origin).toBe("discovery-1");
    expect(row.attributes).toMatchObject({ label: "Main campus building" });
  });

  it("carries explicit bi-temporal validity on the stamped row", () => {
    const row = declared().declarations.get("decl-building-1")?.kernelRow;
    expect(row?.valid_from).toBe(NOW);
    expect(row?.valid_to).toBeNull();
    expect(row?.valid_time_known).toBe(true);
    expect(row?.supersedes).toBeNull();

    const unknownValidity = expectOk(
      declareDiscoveryObject(
        declarationPhase(),
        declareInput({
          declarationId: "decl-unknown-validity",
          kind: "environment",
          label: "Outdoor yard",
          biTemporal: { validTimeKnown: false },
        }),
      ),
    ).declarations.get("decl-unknown-validity")?.kernelRow;
    expect(unknownValidity?.valid_time_known).toBe(false);
    expect(unknownValidity?.valid_from).toBeNull();
  });

  it("rejects envelope violations through the kernel write path", () => {
    expectDeny(
      declareDiscoveryObject(
        declarationPhase(),
        declareInput({
          envelope: { ...envelopeFor(TENANT_A), objectType: "core.event" },
        }),
      ),
      "kernel_object_rejected",
    );
    expectDeny(
      declareDiscoveryObject(
        declarationPhase(),
        declareInput({
          envelope: { ...envelopeFor(TENANT_A), causationId: null, declaredOrigin: null },
        }),
      ),
      "kernel_object_rejected",
    );
  });

  it("rejects bi-temporal violations through the kernel write path", () => {
    expectDeny(
      declareDiscoveryObject(
        declarationPhase(),
        declareInput({ biTemporal: {} }),
      ),
      "kernel_object_rejected",
    );
    expectDeny(
      declareDiscoveryObject(
        declarationPhase(),
        declareInput({ biTemporal: { validTimeKnown: false, validFrom: NOW } }),
      ),
      "kernel_object_rejected",
    );
    expectDeny(
      declareDiscoveryObject(
        declarationPhase(),
        declareInput({ biTemporal: { validFrom: LATER, validUntil: NOW } }),
      ),
      "kernel_object_rejected",
    );
  });

  it("rejects duplicate declaration ids", () => {
    expectDeny(declareDiscoveryObject(declared(), declareInput()), "duplicate_declaration");
  });

  it("exposes the composed evidence object-type allowlist for the registry gate", () => {
    expect(DISCOVERY_EVIDENCE_OBJECT_TYPES).toEqual([EVIDENCE_OBJECT_TYPE]);
    expect(DISCOVERY_OBJECT_KINDS).toEqual(["building", "environment", "device", "person"]);
  });
});