/**
 * CoreGrid — H2-25 / J-007 contract tests: the per-agent credential broker.
 *
 * Mission acceptance, one case per contract:
 *  1. issuance bounded by declared capabilities (no self-widening, the
 *     handle is only a registry key — memory-session pattern);
 *  2. TTL expiry denies (fail closed, caller-supplied time);
 *  3. revocation is immediate and fail closed;
 *  4. rotation re-issues and invalidates every old lease;
 *  5. minting an unscoped/universal lease is a TYPE error and a runtime
 *     contract error (the no-master invariant cannot be expressed);
 *  6. every issuance and every denial is audited (append-only).
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CredentialBroker,
  InMemoryCredentialAuditSink,
  InMemoryCredentialVault,
  rawSecret,
  UnscopedCredentialLease,
  type BrokeredCredentialPolicy,
  type CredentialSubjectAuthority,
} from "@/lib/security/credential-broker";

const BROKER_MAX_TTL = 60_000;
const CREDENTIAL_REF = "cred:tenant-a:worker-vault";

const POLICY: BrokeredCredentialPolicy = {
  credentialRef: CREDENTIAL_REF,
  tenantRef: "tenant-a",
  resourceScope: "resource:worker-vault",
  requiredCapabilities: ["vault.read"],
  riskClass: "medium",
  maxLeaseTtlMs: 30_000,
};

const SUBJECT: CredentialSubjectAuthority = {
  identityRef: "identity:worker-mh25",
  tenantScope: "tenant-a",
  declaredCapabilities: ["vault.read"],
  resourceScopes: ["resource:worker-vault"],
  maxRiskClass: "high",
  isUsable: true,
};

function brokerWith(): { broker: CredentialBroker; audit: InMemoryCredentialAuditSink } {
  const audit = new InMemoryCredentialAuditSink();
  const vault = new InMemoryCredentialVault({ [CREDENTIAL_REF]: rawSecret("mh25-secret-material") });
  const broker = new CredentialBroker({
    maxLeaseTtlMs: BROKER_MAX_TTL,
    authorizedRevokers: ["identity:security-guardian"],
    vault,
    auditSink: audit,
  });
  expect(broker.registerCredentialPolicy(POLICY).ok).toBe(true);
  return { broker, audit };
}

function grant(
  broker: CredentialBroker,
  subject: CredentialSubjectAuthority = SUBJECT,
  request?: Partial<{ ttlMs: number; maxUses: number; nowMs: number }>,
) {
  return broker.grant({
    subject,
    credentialRef: CREDENTIAL_REF,
    purpose: "mission:read-worker-vault",
    ttlMs: request?.ttlMs ?? 10_000,
    maxUses: request?.maxUses ?? 5,
    nowMs: request?.nowMs ?? 1_000,
  });
}

describe("issuance is bounded by the worker's declared capabilities", () => {
  it("grants a scoped lease when the capability set covers the credential's requirement", () => {
    const { broker } = brokerWith();
    const result = grant(broker);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handle.credentialRef).toBe(CREDENTIAL_REF);
    expect(result.handle.expiresAtMs).toBe(11_000);
    expect(JSON.stringify(result.handle)).not.toContain("mh25-secret-material");
  });

  it("denies a lease whose required capability is not declared (no self-widening, never clamped)", () => {
    const { broker } = brokerWith();
    const escalated: CredentialSubjectAuthority = {
      ...SUBJECT,
      declaredCapabilities: [],
    };
    expect(grant(broker, escalated)).toEqual({
      ok: false,
      reason: "capability_escalation_denied:vault.read_not_declared",
    });
  });

  it("denies a zero-capability worker any lease at all", () => {
    const { broker } = brokerWith();
    const zeroAuthority: CredentialSubjectAuthority = {
      identityRef: "identity:worker-mh25",
      tenantScope: "tenant-a",
      declaredCapabilities: [],
      resourceScopes: ["resource:worker-vault"],
      maxRiskClass: "high",
      isUsable: true,
    };
    expect(grant(broker, zeroAuthority).ok).toBe(false);
  });

  it("the handle is only a registry key: a widened handle carries no authority", () => {
    const { broker } = brokerWith();
    const result = grant(broker);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const forged = { ...result.handle, leaseId: "lease:cred:tenant-a:worker-vault:9999" };
    expect(
      broker.resolveLease({
        handle: forged,
        identityRef: SUBJECT.identityRef,
        purpose: "mission:read-worker-vault",
        nowMs: 1_100,
      }),
    ).toEqual({ ok: false, reason: "unknown_lease" });
  });
});

describe("TTL expiry denies (fail closed)", () => {
  it("denies use the instant the lease TTL has passed", () => {
    const { broker } = brokerWith();
    const result = grant(broker, SUBJECT, { ttlMs: 1_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = broker.resolveLease({
      handle: result.handle,
      identityRef: SUBJECT.identityRef,
      purpose: "mission:read-worker-vault",
      nowMs: 1_999,
    });
    expect(before.ok).toBe(true);
    expect(
      broker.resolveLease({
        handle: result.handle,
        identityRef: SUBJECT.identityRef,
        purpose: "mission:read-worker-vault",
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: "lease_expired" });
  });

  it("refuses to issue a lease whose TTL exceeds the broker or credential bound", () => {
    const { broker } = brokerWith();
    expect(grant(broker, SUBJECT, { ttlMs: BROKER_MAX_TTL + 1 })).toEqual({
      ok: false,
      reason: "ttl_exceeds_broker_bound",
    });
    expect(grant(broker, SUBJECT, { ttlMs: 30_001 })).toEqual({
      ok: false,
      reason: "ttl_exceeds_credential_bound",
    });
  });
});

describe("revocation is immediate and fail closed", () => {
  it("a revoked lease denies use instantly, well before TTL expiry", () => {
    const { broker, audit } = brokerWith();
    const result = grant(broker, SUBJECT, { ttlMs: 10_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const revoked = broker.revokeLease({
      handle: result.handle,
      reason: "operator: suspected compromise",
      nowMs: 1_200,
    });
    expect(revoked).toEqual({ ok: true });

    expect(
      broker.resolveLease({
        handle: result.handle,
        identityRef: SUBJECT.identityRef,
        purpose: "mission:read-worker-vault",
        nowMs: 1_300,
      }),
    ).toEqual({ ok: false, reason: "lease_revoked:operator: suspected compromise" });

    const revocationEvents = audit.list().filter((event) => event.kind === "LEASE_REVOKED");
    expect(revocationEvents).toHaveLength(1);
  });

  it("an unknown lease handle fails closed, never open", () => {
    const { broker } = brokerWith();
    const other = brokerWith();
    const foreign = grant(other.broker);
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    expect(
      broker.revokeLease({
        handle: foreign.handle,
        reason: "cross-broker handle",
        nowMs: 1_000,
      }).ok,
    ).toBe(false);
  });
});

describe("rotation re-issues and invalidates", () => {
  it("invalidates every outstanding old lease immediately; new leases bind to the new version", () => {
    const { broker, audit } = brokerWith();
    const oldLease = grant(broker, SUBJECT, { maxUses: 10 });
    expect(oldLease.ok).toBe(true);

    const rotated = broker.rotateCredential({
      credentialRef: CREDENTIAL_REF,
      nextSecret: rawSecret("mh25-rotated-material"),
      nowMs: 1_500,
    });
    expect(rotated).toEqual({ ok: true, version: 2, leasesInvalidated: 1 });

    if (!oldLease.ok) return;
    expect(
      broker.resolveLease({
        handle: oldLease.handle,
        identityRef: SUBJECT.identityRef,
        purpose: "mission:read-worker-vault",
        nowMs: 1_600,
      }),
    ).toEqual({ ok: false, reason: "lease_revoked:invalidated_by_rotation" });

    const newLease = grant(broker, SUBJECT, { nowMs: 2_000 });
    expect(newLease.ok).toBe(true);
    if (!newLease.ok) return;
    const resolved = broker.resolveLease({
      handle: newLease.handle,
      identityRef: SUBJECT.identityRef,
      purpose: "mission:read-worker-vault",
      nowMs: 2_100,
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.secret).toBe("mh25-rotated-material");

    const rotation = audit.list().find((event) => event.kind === "CREDENTIAL_ROTATED");
    expect(rotation?.kind === "CREDENTIAL_ROTATED" && rotation.leasesInvalidated).toBe(1);
  });
});

describe("no-master invariant — an unscoped lease cannot be expressed", () => {
  it("the unscoped-lease type resolves to never", () => {
    expectTypeOf<UnscopedCredentialLease>().toEqualTypeOf<never>();
  });

  it("a policy without required capabilities is a TYPE error", () => {
    const unscoped: BrokeredCredentialPolicy = {
      ...POLICY,
      // @ts-expect-error — requiredCapabilities is a non-empty tuple: a
      // capability-free (master) credential cannot be expressed.
      requiredCapabilities: [],
    };

    const { broker } = brokerWith();
    const result = broker.registerCredentialPolicy(unscoped);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes("master credential"))).toBe(true);
  });

  it("a capability-free policy is a runtime CONTRACT error (fail closed for untyped callers)", () => {
    const masterRef = "cred:tenant-a:master";
    const untyped = JSON.parse(JSON.stringify(POLICY)) as unknown as BrokeredCredentialPolicy;
    (untyped as unknown as Record<string, unknown>).credentialRef = masterRef;
    (untyped as unknown as { requiredCapabilities: string[] }).requiredCapabilities = [];

    const { broker } = brokerWith();
    const result = broker.registerCredentialPolicy(untyped);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.includes("master credential"))).toBe(true);

    // The rejected policy was never registered: nothing can be leased
    // against the capability-free credential it attempted to describe.
    expect(
      broker.grant({
        subject: SUBJECT,
        credentialRef: masterRef,
        purpose: "mission:read-worker-vault",
        ttlMs: 10_000,
        maxUses: 1,
        nowMs: 1_000,
      }),
    ).toEqual({ ok: false, reason: "credential_not_brokered" });
  });

  it("grant has no overload that omits the subject — an unscoped mint attempt cannot compile", () => {
    const { broker } = brokerWith();
    expect(() => {
      // @ts-expect-error — grant REQUIRES a scoped subject; a subject-free
      // (universal) grant is a type error, not an API.
      broker.grant({
        credentialRef: CREDENTIAL_REF,
        purpose: "mission:read-worker-vault",
        ttlMs: 10_000,
        maxUses: 1,
        nowMs: 1_000,
      });
    }).toThrow();
  });
});

describe("every issuance and every denial is audited", () => {
  it("grants append LEASE_GRANTED; denials append LEASE_DENIED with the reason", () => {
    const { broker, audit } = brokerWith();

    const granted = grant(broker);
    expect(granted.ok).toBe(true);

    const deniedEscalation = grant(broker, { ...SUBJECT, declaredCapabilities: [] });
    expect(deniedEscalation.ok).toBe(false);
    const deniedCrossTenant = grant(broker, { ...SUBJECT, tenantScope: "tenant-b" });
    expect(deniedCrossTenant.ok).toBe(false);

    const issueEvents = audit.list().filter((event) => event.kind === "LEASE_GRANTED");
    const denialEvents = audit.list().filter((event) => event.kind === "LEASE_DENIED");
    expect(issueEvents).toHaveLength(1);
    expect(denialEvents).toHaveLength(2);
    expect(denialEvents.every((event) => event.kind === "LEASE_DENIED" && event.reason.length > 0))
      .toBe(true);
  });

  it("denied USES are audited too, and the audit never carries secret material", () => {
    const { broker, audit } = brokerWith();
    const result = grant(broker, SUBJECT, { ttlMs: 1_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      broker.resolveLease({
        handle: result.handle,
        identityRef: SUBJECT.identityRef,
        purpose: "mission:read-worker-vault",
        nowMs: 5_000,
      }).ok,
    ).toBe(false);

    expect(audit.list().some((event) => event.kind === "USE_DENIED")).toBe(true);
    expect(JSON.stringify(audit.list())).not.toContain("mh25-secret-material");
  });
});
