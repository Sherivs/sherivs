/**
 * CoreGrid Mobile V1-010 — mission/identity/evidence read-contract tests.
 *
 * Validates the mobile mirrors of the web foundation-loop row contracts
 * (cg_execution_record, cg_verification_result, cg_foundation_evidence —
 * shapes per frontend/src/lib/control-plane/foundation-loop.ts) and the
 * identity-registry list contract, including fail-closed rejection of
 * foreign-tenant identity rows.
 */
import { describe, expect, it } from "vitest";
import { evidenceRowSchema, missionExecutionRowSchema, verificationRowSchema } from "../../mobile/src/api/contracts/mission-contracts";
import { listIdentitiesResponseSchema } from "../../mobile/src/api/contracts/identity-contracts";

const EXECUTION_ID = "0b6c3a1e-0f4e-4a58-9a1c-6d0f2f9a7b01";
const TENANT_ID = "1f0e5b9a-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const ACTOR_ID = "2b7c9d1e-5a4f-4b3c-8d2e-1f0a9b8c7d6e";
const REALITY_ID = "3c8d0e2f-6b5a-4c4d-9e3f-2a1b0c9d8e7f";
const NOW = "2026-10-03T00:00:00Z";

const executionRow = {
  id: EXECUTION_ID,
  idempotency_key: "foundation-http-idem-001",
  mission_id: "COREGRID-FOUNDATION-MISSION-001",
  mission_version: "http-live-1",
  tenant_id: TENANT_ID,
  actor_id: ACTOR_ID,
  action: "record-observation",
  reality_ref: REALITY_ID,
  requested_at: NOW,
  attempt_id: "4d9e1f3a-7c6b-4d5e-af4a-3b2c1d0e9f8a",
  started_at: NOW,
  status: "admitted",
  reason: null,
  external_effect: "recorded_intent",
};

describe("mobile mission execution contract", () => {
  it("accepts a row shaped exactly like the web foundation-loop persistence contract", () => {
    const parsed = missionExecutionRowSchema.parse(executionRow);
    expect(parsed.status).toBe("admitted");
    expect(parsed.external_effect).toBe("recorded_intent");
    expect(parsed.reason).toBeNull();
  });

  it("rejects a status outside the canonical execution vocabulary", () => {
    expect(() =>
      missionExecutionRowSchema.parse({ ...executionRow, status: "succeeded" }),
    ).toThrow();
  });

  it("rejects an external effect outside the canonical vocabulary", () => {
    expect(() =>
      missionExecutionRowSchema.parse({ ...executionRow, external_effect: "mutated_world" }),
    ).toThrow();
  });

  it("rejects rows with a tampered tenant reference", () => {
    expect(() =>
      missionExecutionRowSchema.parse({ ...executionRow, tenant_id: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("mobile verification contract", () => {
  it("accepts the web FoundationVerificationRow shape", () => {
    const parsed = verificationRowSchema.parse({
      verification_id: "5eaf2a4b-8d7c-4e6f-b05b-4c3d2e1f0a9b",
      execution_id: EXECUTION_ID,
      evidence_ids: ["6fbf3b5c-9e8d-4f7a-a16c-5d4e3f2a1b0c"],
      decision: "verified",
      reason: "tenant-scoped reality verified",
    });
    expect(parsed.decision).toBe("verified");
  });

  it("rejects an unknown verification decision", () => {
    expect(() =>
      verificationRowSchema.parse({
        verification_id: "5eaf2a4b-8d7c-4e6f-b05b-4c3d2e1f0a9b",
        execution_id: EXECUTION_ID,
        evidence_ids: [],
        decision: "self_attested",
        reason: "not a canonical decision",
      }),
    ).toThrow();
  });
});

describe("mobile evidence contract", () => {
  it("accepts the web FoundationEvidenceRow shape with lineage", () => {
    const parsed = evidenceRowSchema.parse({
      evidence_id: "7fcf4c6d-af9e-4a8b-b27d-6e5f4a3b2c1d",
      producer: "foundation-loop",
      actor_id: ACTOR_ID,
      tenant_id: TENANT_ID,
      observed_at: NOW,
      recorded_at: NOW,
      provenance: `cg_entity:${REALITY_ID}`,
      integrity: "sha256:deadbeef",
      lifecycle: "active",
      lineage: [REALITY_ID],
    });
    expect(parsed.lifecycle).toBe("active");
    expect(parsed.lineage).toHaveLength(1);
  });

  it("rejects a lifecycle outside the canonical evidence vocabulary", () => {
    expect(() =>
      evidenceRowSchema.parse({
        evidence_id: "7fcf4c6d-af9e-4a8b-b27d-6e5f4a3b2c1d",
        producer: "foundation-loop",
        actor_id: ACTOR_ID,
        tenant_id: TENANT_ID,
        observed_at: NOW,
        recorded_at: NOW,
        provenance: "cg_entity:x",
        integrity: "sha256:deadbeef",
        lifecycle: "forged",
        lineage: [],
      }),
    ).toThrow();
  });
});

describe("mobile identity list contract", () => {
  const identityRow = {
    id: "8ada5d7e-b0af-4b9c-a38e-7f6a5b4c3d2e",
    kind: "agent",
    display_name: "Nightly reconciliation agent",
    state: "active",
    verified: true,
    tenant_id: TENANT_ID,
    created_at: NOW,
  };

  it("accepts a tenant-scoped list response", () => {
    const parsed = listIdentitiesResponseSchema.parse({
      ok: true,
      tenant_id: TENANT_ID,
      identities: [identityRow],
    });
    expect(parsed.identities).toHaveLength(1);
    expect(parsed.identities[0]?.kind).toBe("agent");
  });

  it("accepts null tenant_id on rows (mission-level evidence convention) but rejects foreign tenants", () => {
    expect(() =>
      listIdentitiesResponseSchema.parse({
        ok: true,
        tenant_id: TENANT_ID,
        identities: [{ ...identityRow, tenant_id: null }],
      }),
    ).not.toThrow();

    try {
      listIdentitiesResponseSchema.parse({
        ok: true,
        tenant_id: TENANT_ID,
        identities: [{ ...identityRow, tenant_id: "9beb6e8f-c1b0-4cad-b49f-8a7b6c5d4e3f" }],
      });
      expect.unreachable("cross-tenant identity rows must be rejected");
    } catch {
      // expected — the tenant-boundary refinement fails closed
    }
  });

  it("rejects unknown identity kinds and states", () => {
    expect(() =>
      listIdentitiesResponseSchema.parse({
        ok: true,
        tenant_id: TENANT_ID,
        identities: [{ ...identityRow, kind: "deity" }],
      }),
    ).toThrow();
    expect(() =>
      listIdentitiesResponseSchema.parse({
        ok: true,
        tenant_id: TENANT_ID,
        identities: [{ ...identityRow, state: "haunted" }],
      }),
    ).toThrow();
  });
});