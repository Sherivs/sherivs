/**
 * CoreGrid — H3 B-009 / J-007 tests: per-agent scoping enforcement depth on
 * the credential broker.
 *
 * Mission acceptance, one case per contract:
 *  1. NO universal master credential — deeper than the empty-capability
 *     rejection: master-credential SHAPES (wildcard resource scope, wildcard
 *     capability requirement) are rejected at registration and never
 *     become leasable;
 *  2. LEAST-SCOPE issuance — the per-agent TTL bound clamps every lease DOWN
 *     to the narrowest bound (never widened), proven via the handle, the
 *     operator view, and fail-closed use past the clamp;
 *  3. per-agent concurrent-lease caps — per credential and across all
 *     credentials, with EXPIRY HONORED: expired leases release budget,
 *     revoked leases release budget, exhausted-but-unexpired leases hold it;
 *  4. the pure evaluator is exact: null policy is a pass-through, caps deny,
 *     TTL clamps down only;
 *  5. policy registration is fail closed (Zod contract): invalid policies
 *     are rejected and leave the agent unconstrained-but-authority-gated;
 *  6. every scoping denial is audited and the audit stays secret-free.
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CredentialBroker,
  InMemoryCredentialAuditSink,
  InMemoryCredentialVault,
  evaluateAgentScoping,
  rawSecret,
  UnscopedCredentialLease,
  type AgentScopingPolicy,
  type AgentScopingVerdict,
  type BrokeredCredentialPolicy,
  type CredentialSubjectAuthority,
} from "@/lib/security/credential-broker";

const BROKER_MAX_TTL = 60_000;
const CREDENTIAL_A = "cred:tenant-a:scope-api-a";
const CREDENTIAL_B = "cred:tenant-a:scope-api-b";

const POLICY_A: BrokeredCredentialPolicy = {
  credentialRef: CREDENTIAL_A,
  tenantRef: "tenant-a",
  resourceScope: "resource:scope-api-a",
  requiredCapabilities: ["scope.invoke.a"],
  riskClass: "low",
  maxLeaseTtlMs: 30_000,
};

const POLICY_B: BrokeredCredentialPolicy = {
  credentialRef: CREDENTIAL_B,
  tenantRef: "tenant-a",
  resourceScope: "resource:scope-api-b",
  requiredCapabilities: ["scope.invoke.b"],
  riskClass: "medium",
  maxLeaseTtlMs: 30_000,
};

const SUBJECT: CredentialSubjectAuthority = {
  identityRef: "identity:worker-b009",
  tenantScope: "tenant-a",
  declaredCapabilities: ["scope.invoke.a", "scope.invoke.b"],
  resourceScopes: ["resource:scope-api-a", "resource:scope-api-b"],
  maxRiskClass: "high",
  isUsable: true,
};

const B009_POLICY: AgentScopingPolicy = {
  identityRef: SUBJECT.identityRef,
  maxActiveLeasesPerCredential: 2,
  maxTotalActiveLeases: 3,
  maxLeaseTtlMs: null,
};

function brokerWith(
  overrides?: Partial<{
    vaultEntries: Record<string, string>;
    credentials: readonly BrokeredCredentialPolicy[];
    agentPolicy: AgentScopingPolicy | null;
  }>,
): { broker: CredentialBroker; audit: InMemoryCredentialAuditSink } {
  const audit = new InMemoryCredentialAuditSink();
  const secretEntries = overrides?.vaultEntries ?? { [CREDENTIAL_A]: "b009-secret-material-a" };
  const vault = new InMemoryCredentialVault(
    Object.fromEntries(
      Object.entries(secretEntries).map(([ref, value]) => [ref, rawSecret(value)]),
    ),
  );
  const broker = new CredentialBroker({
    maxLeaseTtlMs: BROKER_MAX_TTL,
    authorizedRevokers: ["identity:security-guardian"],
    vault,
    auditSink: audit,
  });
  for (const policy of overrides?.credentials ?? [POLICY_A]) {
    expect(broker.registerCredentialPolicy(policy).ok).toBe(true);
  }
  if (overrides?.agentPolicy !== null) {
    expect(broker.registerAgentScopingPolicy(overrides?.agentPolicy ?? B009_POLICY).ok).toBe(true);
  }
  return { broker, audit };
}

function grant(
  broker: CredentialBroker,
  credentialRef: string = CREDENTIAL_A,
  subject: CredentialSubjectAuthority = SUBJECT,
  request?: Partial<{ ttlMs: number; maxUses: number; nowMs: number; purpose: string }>,
) {
  return broker.grant({
    subject,
    credentialRef,
    purpose: request?.purpose ?? "mission:scoped-invocation",
    ttlMs: request?.ttlMs ?? 10_000,
    maxUses: request?.maxUses ?? 5,
    nowMs: request?.nowMs ?? 1_000,
  });
}

describe("no universal master credential — wildcard shapes rejected at registration", () => {
  it("rejects a wildcard resource scope as a master-credential shape", () => {
    const { broker } = brokerWith({ agentPolicy: null });
    const wildcard: BrokeredCredentialPolicy = {
      ...POLICY_A,
      credentialRef: "cred:tenant-a:everything",
      resourceScope: "*",
    };
    const result = broker.registerCredentialPolicy(wildcard);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes("master credential"))).toBe(true);
    // The rejected policy was never registered: nothing leases against it.
    expect(grant(broker, "cred:tenant-a:everything")).toEqual({
      ok: false,
      reason: "credential_not_brokered",
    });
  });

  it("rejects a wildcard capability requirement as a master-credential shape", () => {
    const { broker } = brokerWith({ agentPolicy: null });
    const wildcard: BrokeredCredentialPolicy = {
      ...POLICY_A,
      credentialRef: "cred:tenant-a:any-capability",
      requiredCapabilities: ["*"],
    };
    const result = broker.registerCredentialPolicy(wildcard);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes("master credential"))).toBe(true);
    expect(grant(broker, "cred:tenant-a:any-capability")).toEqual({
      ok: false,
      reason: "credential_not_brokered",
    });
  });

  it("the unscoped-lease type still resolves to never (no-master invariant unchanged)", () => {
    expectTypeOf<UnscopedCredentialLease>().toEqualTypeOf<never>();
  });
});

describe("least-scope issuance — the per-agent TTL bound clamps, never widens", () => {
  it("clamps the lease TTL down to the agent bound at issuance", () => {
    const { broker } = brokerWith({
      agentPolicy: { ...B009_POLICY, maxLeaseTtlMs: 4_000 },
    });
    const result = grant(broker, CREDENTIAL_A, SUBJECT, { ttlMs: 10_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handle.expiresAtMs).toBe(1_000 + 4_000);
    const view = broker.inspectLease(result.handle, 1_100);
    expect(view?.expiresAtMs).toBe(5_000);
    expect(view?.status).toBe("active");
  });

  it("honours the clamp at use time: past the clamped expiry the lease denies", () => {
    const { broker } = brokerWith({
      agentPolicy: { ...B009_POLICY, maxLeaseTtlMs: 2_000 },
    });
    const result = grant(broker, CREDENTIAL_A, SUBJECT, { ttlMs: 10_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      broker.resolveLease({
        handle: result.handle,
        identityRef: SUBJECT.identityRef,
        purpose: "mission:scoped-invocation",
        nowMs: 3_000,
      }),
    ).toEqual({ ok: false, reason: "lease_expired" });
    expect(broker.inspectLease(result.handle, 3_000)?.status).toBe("expired");
  });

  it("does not widen a request already narrower than the agent bound", () => {
    const { broker } = brokerWith({
      agentPolicy: { ...B009_POLICY, maxLeaseTtlMs: 8_000 },
    });
    const result = grant(broker, CREDENTIAL_A, SUBJECT, { ttlMs: 3_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handle.expiresAtMs).toBe(4_000);
  });

  it("the pure evaluator clamps down, passes through, and never widens", () => {
    const policy: AgentScopingPolicy = {
      identityRef: "identity:worker-b009",
      maxActiveLeasesPerCredential: 1,
      maxTotalActiveLeases: 1,
      maxLeaseTtlMs: 5_000,
    };
    const clamped = evaluateAgentScoping({
      policy,
      requestedTtlMs: 10_000,
      activeLeasesPerCredential: 0,
      activeLeasesTotal: 0,
    });
    expect(clamped.ok).toBe(true);
    if (clamped.ok) expect(clamped.effectiveTtlMs).toBe(5_000);

    const untouched = evaluateAgentScoping({
      policy,
      requestedTtlMs: 3_000,
      activeLeasesPerCredential: 0,
      activeLeasesTotal: 0,
    });
    expect(untouched.ok).toBe(true);
    if (untouched.ok) expect(untouched.effectiveTtlMs).toBe(3_000);

    const passThrough = evaluateAgentScoping({
      policy: null,
      requestedTtlMs: 10_000,
      activeLeasesPerCredential: 0,
      activeLeasesTotal: 0,
    });
    expect(passThrough.ok).toBe(true);
    if (passThrough.ok) expect(passThrough.effectiveTtlMs).toBe(10_000);
    expectTypeOf<AgentScopingVerdict>().toEqualTypeOf<
      { ok: true; effectiveTtlMs: number } | { ok: false; reason: string }
    >();
  });
});

describe("per-credential concurrent-lease cap (expiry and revocation honoured)", () => {
  it("denies a lease beyond the per-credential cap", () => {
    const { broker } = brokerWith();
    expect(grant(broker).ok).toBe(true);
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_100 }).ok).toBe(true);
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_200 })).toEqual({
      ok: false,
      reason: "agent_scope_concurrency_denied:2_per_credential",
    });
  });

  it("releases budget when a lease EXPIRES (expiry honoured in accounting)", () => {
    const { broker } = brokerWith({
      agentPolicy: { ...B009_POLICY, maxActiveLeasesPerCredential: 1, maxTotalActiveLeases: 5 },
    });
    const first = grant(broker, CREDENTIAL_A, SUBJECT, { ttlMs: 1_000, nowMs: 1_000 });
    expect(first.ok).toBe(true);
    // While the first lease is live, the cap denies.
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_500 }).ok).toBe(false);
    // After it expires, budget is released and a fresh lease grants.
    const afterExpiry = grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 3_000 });
    expect(afterExpiry.ok).toBe(true);
    expect(broker.activeLeaseCount(SUBJECT.identityRef, CREDENTIAL_A, 3_000)).toBe(1);
    expect(broker.activeLeaseCount(SUBJECT.identityRef, CREDENTIAL_A, 2_000)).toBe(0);
  });

  it("releases budget when a lease is REVOKED (revocation honoured in accounting)", () => {
    const { broker } = brokerWith({
      agentPolicy: { ...B009_POLICY, maxActiveLeasesPerCredential: 1, maxTotalActiveLeases: 5 },
    });
    const first = grant(broker, CREDENTIAL_A, SUBJECT, { ttlMs: 30_000 });
    expect(first.ok).toBe(true);
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_100 }).ok).toBe(false);
    if (!first.ok) return;
    expect(
      broker.revokeLease({
        handle: first.handle,
        reason: "operator: scoped rotation",
        nowMs: 1_200,
      }).ok,
    ).toBe(true);
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_300 }).ok).toBe(true);
  });

  it("an exhausted-but-unexpired lease still holds the budget (conservative, fail closed)", () => {
    const { broker } = brokerWith({
      agentPolicy: { ...B009_POLICY, maxActiveLeasesPerCredential: 1, maxTotalActiveLeases: 5 },
    });
    const first = grant(broker, CREDENTIAL_A, SUBJECT, { maxUses: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(
      broker.resolveLease({
        handle: first.handle,
        identityRef: SUBJECT.identityRef,
        purpose: "mission:scoped-invocation",
        nowMs: 1_100,
      }).ok,
    ).toBe(true);
    // Budget exhausted, but the lease is still live: the cap still binds.
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_200 }).ok).toBe(false);
  });

  it("caps are per credential, not global, when only the per-credential cap is tight", () => {
    const { broker } = brokerWith({
      credentials: [POLICY_A, POLICY_B],
      vaultEntries: {
        [CREDENTIAL_A]: "b009-secret-material-a",
        [CREDENTIAL_B]: "b009-secret-material-b",
      },
      agentPolicy: { ...B009_POLICY, maxActiveLeasesPerCredential: 1, maxTotalActiveLeases: 5 },
    });
    expect(grant(broker, CREDENTIAL_A).ok).toBe(true);
    expect(grant(broker, CREDENTIAL_B, SUBJECT, { nowMs: 1_100 }).ok).toBe(true);
  });
});

describe("total concurrent-lease cap across credentials", () => {
  it("denies a lease beyond the total cap even across different credentials", () => {
    const { broker } = brokerWith({
      credentials: [POLICY_A, POLICY_B],
      vaultEntries: {
        [CREDENTIAL_A]: "b009-secret-material-a",
        [CREDENTIAL_B]: "b009-secret-material-b",
      },
      agentPolicy: { ...B009_POLICY, maxActiveLeasesPerCredential: 5, maxTotalActiveLeases: 2 },
    });
    expect(grant(broker, CREDENTIAL_A).ok).toBe(true);
    expect(grant(broker, CREDENTIAL_B, SUBJECT, { nowMs: 1_100 }).ok).toBe(true);
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_200 })).toEqual({
      ok: false,
      reason: "agent_scope_total_leases_denied:2",
    });
    expect(grant(broker, CREDENTIAL_B, SUBJECT, { nowMs: 1_300 }).ok).toBe(false);
  });

  it("releases total budget on expiry and permits a different credential's lease", () => {
    const { broker } = brokerWith({
      credentials: [POLICY_A, POLICY_B],
      vaultEntries: {
        [CREDENTIAL_A]: "b009-secret-material-a",
        [CREDENTIAL_B]: "b009-secret-material-b",
      },
      agentPolicy: { ...B009_POLICY, maxActiveLeasesPerCredential: 5, maxTotalActiveLeases: 2 },
    });
    const a = grant(broker, CREDENTIAL_A, SUBJECT, { ttlMs: 1_000 });
    expect(a.ok).toBe(true);
    expect(grant(broker, CREDENTIAL_B, SUBJECT, { nowMs: 1_100 }).ok).toBe(true);
    // CREDENTIAL_A lease expires at 2_000: total budget frees up.
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 2_100 }).ok).toBe(true);
    expect(broker.activeLeaseCount(SUBJECT.identityRef, null, 2_100)).toBe(2);
  });
});

describe("scoping policy registration is fail closed (Zod contract)", () => {
  it("rejects non-positive caps and an inconsistent total bound", () => {
    const { broker } = brokerWith({ agentPolicy: null });
    const invalid: AgentScopingPolicy = {
      identityRef: SUBJECT.identityRef,
      maxActiveLeasesPerCredential: 0,
      maxTotalActiveLeases: 0,
      maxLeaseTtlMs: null,
    };
    const result = broker.registerAgentScopingPolicy(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    // Rejected: the agent stays unconstrained at this layer (authority
    // intersection still applies), the invalid policy never takes effect.
    expect(broker.agentScopingPolicy(SUBJECT.identityRef)).toBeNull();
  });

  it("accepts a total bound tighter than the per-credential bound (caps are a conjunction)", () => {
    const { broker } = brokerWith({ agentPolicy: null });
    const result = broker.registerAgentScopingPolicy({
      identityRef: SUBJECT.identityRef,
      maxActiveLeasesPerCredential: 5,
      maxTotalActiveLeases: 2,
      maxLeaseTtlMs: null,
    });
    expect(result.ok).toBe(true);
    expect(broker.agentScopingPolicy(SUBJECT.identityRef)?.maxTotalActiveLeases).toBe(2);
  });

  it("rejects an invalid identity ref and a non-positive TTL bound", () => {
    const { broker } = brokerWith({ agentPolicy: null });
    expect(
      broker.registerAgentScopingPolicy({
        identityRef: "   ",
        maxActiveLeasesPerCredential: 1,
        maxTotalActiveLeases: 1,
        maxLeaseTtlMs: null,
      }).ok,
    ).toBe(false);
    expect(
      broker.registerAgentScopingPolicy({
        identityRef: SUBJECT.identityRef,
        maxActiveLeasesPerCredential: 1,
        maxTotalActiveLeases: 1,
        maxLeaseTtlMs: 0,
      }).ok,
    ).toBe(false);
  });

  it("agents without a registered policy are unconstrained at this layer", () => {
    const { broker } = brokerWith({ agentPolicy: null });
    for (let i = 0; i < 4; i += 1) {
      expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_000 + i }).ok).toBe(true);
    }
    expect(broker.agentScopingPolicy(SUBJECT.identityRef)).toBeNull();
  });

  it("re-registering replaces the previous policy (latest wins)", () => {
    const { broker } = brokerWith();
    expect(
      broker.registerAgentScopingPolicy({
        identityRef: SUBJECT.identityRef,
        maxActiveLeasesPerCredential: 1,
        maxTotalActiveLeases: 1,
        maxLeaseTtlMs: null,
      }).ok,
    ).toBe(true);
    expect(broker.agentScopingPolicy(SUBJECT.identityRef)?.maxActiveLeasesPerCredential).toBe(1);
    expect(grant(broker, CREDENTIAL_A).ok).toBe(true);
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_100 }).ok).toBe(false);
  });
});

describe("scoping denials are audited and stay secret-free", () => {
  it("every scoping denial appends a LEASE_DENIED event with the reason", () => {
    const { broker, audit } = brokerWith();
    expect(grant(broker).ok).toBe(true);
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_100 }).ok).toBe(true);
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_200 }).ok).toBe(false);

    const denials = audit
      .list()
      .filter((event) => event.kind === "LEASE_DENIED" && event.reason.startsWith("agent_scope_"));
    expect(denials).toHaveLength(1);
    expect(denials[0]?.kind === "LEASE_DENIED" && denials[0]?.reason).toBe(
      "agent_scope_concurrency_denied:2_per_credential",
    );
  });

  it("the audit log never carries secret material, through scoping denials included", () => {
    const { broker, audit } = brokerWith({
      agentPolicy: { ...B009_POLICY, maxActiveLeasesPerCredential: 1 },
    });
    const first = grant(broker);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(
      broker.resolveLease({
        handle: first.handle,
        identityRef: SUBJECT.identityRef,
        purpose: "mission:scoped-invocation",
        nowMs: 1_100,
      }).ok,
    ).toBe(true);
    expect(grant(broker, CREDENTIAL_A, SUBJECT, { nowMs: 1_200 }).ok).toBe(false);
    expect(JSON.stringify(audit.list())).not.toContain("b009-secret-material-a");
    expect(JSON.stringify(broker.auditLog())).not.toContain("b009-secret-material-a");
  });

  it("issued handles serialize without secret material (guard holds for clamped leases)", () => {
    const { broker } = brokerWith({
      agentPolicy: { ...B009_POLICY, maxLeaseTtlMs: 4_000 },
    });
    const result = grant(broker, CREDENTIAL_A, SUBJECT, { ttlMs: 10_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(broker.guardLeaseHandleSerialization(result.handle)).toEqual({ ok: true });
    expect(JSON.stringify(result.handle)).not.toContain("b009-secret-material-a");
  });
});