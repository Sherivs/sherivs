/**
 * CoreGrid — credential broker & emergency lockdown contract tests
 * (J-007 / J-010, V1CAP-017 / V1CAP-019, MISSION-R-82).
 *
 * Validates: authority-scoped lease grant/deny, TTL expiry, usage budget
 * exhaustion, rotation invalidation, non-observability (no raw secret ever
 * serializes through a handle or the audit log), emergency lockdown
 * semantics (revokes everything, audited, unauthorized callers rejected,
 * the locked-out agent cannot invoke it), and fail-closed behaviour on
 * missing vault entries.
 */

import { describe, expect, it } from "vitest";
import {
  CredentialBroker,
  InMemoryCredentialAuditSink,
  InMemoryCredentialVault,
  rawSecret,
  type BrokeredCredentialPolicy,
  type CredentialLeaseHandle,
  type CredentialSubjectAuthority,
} from "@/lib/security/credential-broker";

const BROKER_MAX_TTL = 60_000;

const POLICY: BrokeredCredentialPolicy = {
  credentialRef: "cred:tenant-a:delivery-api",
  tenantRef: "tenant-a",
  resourceScope: "resource:delivery-api",
  requiredCapabilities: ["delivery.invoke"],
  riskClass: "medium",
  maxLeaseTtlMs: 30_000,
};

const USABLE_SUBJECT: CredentialSubjectAuthority = {
  identityRef: "identity:worker-1",
  tenantScope: "tenant-a",
  declaredCapabilities: ["delivery.invoke", "report.read"],
  resourceScopes: ["resource:delivery-api"],
  maxRiskClass: "high",
  isUsable: true,
};

const SUSPENDED_SUBJECT: CredentialSubjectAuthority = {
  ...USABLE_SUBJECT,
  isUsable: false,
};

function brokerWith(
  overrides?: Partial<{
    revokers: readonly string[];
    audit: InMemoryCredentialAuditSink;
    withVaultEntry: boolean;
  }>,
): { broker: CredentialBroker; audit: InMemoryCredentialAuditSink } {
  const audit = overrides?.audit ?? new InMemoryCredentialAuditSink();
  const vault =
    overrides?.withVaultEntry === false
      ? new InMemoryCredentialVault()
      : new InMemoryCredentialVault({ [POLICY.credentialRef]: rawSecret("s3cr3t-material") });
  const broker = new CredentialBroker({
    maxLeaseTtlMs: BROKER_MAX_TTL,
    authorizedRevokers: overrides?.revokers ?? ["identity:security-guardian"],
    vault,
    auditSink: audit,
  });
  expect(broker.registerCredentialPolicy(POLICY).ok).toBe(true);
  return { broker, audit };
}

function grant(
  broker: CredentialBroker,
  subject: CredentialSubjectAuthority = USABLE_SUBJECT,
  request?: Partial<{ ttlMs: number; maxUses: number; nowMs: number; purpose: string }>,
) {
  return broker.grant({
    subject,
    credentialRef: POLICY.credentialRef,
    purpose: request?.purpose ?? "mission:deliver-report",
    ttlMs: request?.ttlMs ?? 10_000,
    maxUses: request?.maxUses ?? 3,
    nowMs: request?.nowMs ?? 1_000,
  });
}

describe("grant — authority-scoped issuance (J-007)", () => {
  it("grants a lease when capability, risk, scope and tenant all fit", () => {
    const { broker } = brokerWith();
    const result = grant(broker);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.handle.leaseId).toContain("cred:tenant-a:delivery-api");
      expect(result.handle.credentialRef).toBe(POLICY.credentialRef);
      expect(result.handle.expiresAtMs).toBe(11_000);
      expect(Object.keys(result.handle)).not.toContain("secret");
    }
  });

  it("denies capability escalation (fail closed, never clamped)", () => {
    const { broker } = brokerWith();
    const result = grant(broker, {
      ...USABLE_SUBJECT,
      declaredCapabilities: ["report.read"],
    });
    expect(result).toEqual({
      ok: false,
      reason: "capability_escalation_denied:delivery.invoke_not_declared",
    });
  });

  it("denies risk-class escalation above the subject's ceiling", () => {
    const { broker } = brokerWith();
    const result = broker.grant({
      subject: { ...USABLE_SUBJECT, maxRiskClass: "low" },
      credentialRef: POLICY.credentialRef,
      purpose: "mission:deliver-report",
      ttlMs: 10_000,
      maxUses: 3,
      nowMs: 1_000,
    });
    expect(result).toEqual({
      ok: false,
      reason: "risk_class_escalation_denied:medium_above_low",
    });
  });

  it("denies resource-scope escalation outside the authority bounds", () => {
    const { broker } = brokerWith();
    const result = grant(broker, { ...USABLE_SUBJECT, resourceScopes: ["resource:reports"] });
    expect(result).toEqual({
      ok: false,
      reason: "resource_scope_escalation_denied:resource:delivery-api_outside_bounds",
    });
  });

  it("denies cross-tenant credential leasing", () => {
    const { broker } = brokerWith();
    const result = grant(broker, { ...USABLE_SUBJECT, tenantScope: "tenant-b" });
    expect(result).toEqual({ ok: false, reason: "cross_tenant_credential_denied" });
  });

  it("denies subjects whose lifecycle is unusable (suspended/archived/deleted)", () => {
    const { broker } = brokerWith();
    expect(grant(broker, SUSPENDED_SUBJECT)).toEqual({
      ok: false,
      reason: "subject_lifecycle_unusable",
    });
  });

  it("denies TTLs above the broker bound and the per-credential bound", () => {
    const { broker } = brokerWith();
    expect(grant(broker, USABLE_SUBJECT, { ttlMs: BROKER_MAX_TTL + 1 })).toEqual({
      ok: false,
      reason: "ttl_exceeds_broker_bound",
    });
    expect(grant(broker, USABLE_SUBJECT, { ttlMs: 30_001 })).toEqual({
      ok: false,
      reason: "ttl_exceeds_credential_bound",
    });
  });

  it("audits grants and denials", () => {
    const { broker, audit } = brokerWith();
    grant(broker);
    grant(broker, SUSPENDED_SUBJECT);
    const kinds = audit.list().map((event) => event.kind);
    expect(kinds).toEqual(["LEASE_GRANTED", "LEASE_DENIED"]);
    const granted = audit.list()[0];
    expect(granted.kind === "LEASE_GRANTED" && granted.credentialVersion).toBe(1);
  });
});

describe("resolveLease — bounded use", () => {
  it("resolves only for the lease's own identity and exact purpose", () => {
    const { broker } = brokerWith();
    const result = grant(broker);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      broker.resolveLease({
        handle: result.handle,
        identityRef: "identity:worker-2",
        purpose: "mission:deliver-report",
        nowMs: 1_100,
      }),
    ).toEqual({ ok: false, reason: "identity_mismatch" });
    expect(
      broker.resolveLease({
        handle: result.handle,
        identityRef: USABLE_SUBJECT.identityRef,
        purpose: "mission:something-else",
        nowMs: 1_100,
      }),
    ).toEqual({ ok: false, reason: "purpose_mismatch" });
    expect(
      broker.resolveLease({
        handle: { ...result.handle, leaseId: "lease:cred:tenant-a:delivery-api:999" },
        identityRef: USABLE_SUBJECT.identityRef,
        purpose: "mission:deliver-report",
        nowMs: 1_100,
      }),
    ).toEqual({ ok: false, reason: "unknown_lease" });
  });

  it("fails closed after TTL expiry (lazy expiry via caller-supplied time)", () => {
    const { broker } = brokerWith();
    const result = grant(broker, USABLE_SUBJECT, { ttlMs: 1_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      broker.resolveLease({
        handle: result.handle,
        identityRef: USABLE_SUBJECT.identityRef,
        purpose: "mission:deliver-report",
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: "lease_expired" });
  });

  it("exhausts the usage budget and then denies every further use", () => {
    const { broker, audit } = brokerWith();
    const result = grant(broker, USABLE_SUBJECT, { maxUses: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resolve = (nowMs: number) =>
      broker.resolveLease({
        handle: result.handle,
        identityRef: USABLE_SUBJECT.identityRef,
        purpose: "mission:deliver-report",
        nowMs,
      });
    expect(resolve(1_100).ok).toBe(true);
    expect(resolve(1_200).ok).toBe(true);
    expect(resolve(1_300)).toEqual({ ok: false, reason: "usage_budget_exhausted" });
    expect(resolve(1_400)).toEqual({ ok: false, reason: "usage_budget_exhausted" });
    const used = audit.list().filter((event) => event.kind === "LEASE_USED");
    expect(used).toHaveLength(2);
  });

  it("returns the branded secret only through the broker path", () => {
    const { broker } = brokerWith();
    const result = grant(broker);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const resolved = broker.resolveLease({
      handle: result.handle,
      identityRef: USABLE_SUBJECT.identityRef,
      purpose: "mission:deliver-report",
      nowMs: 1_100,
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.secret).toBe("s3cr3t-material");
    }
  });
});

describe("rotation (J-007)", () => {
  it("invalidates every outstanding lease on the old version", () => {
    const { broker } = brokerWith();
    const first = grant(broker, USABLE_SUBJECT, { maxUses: 10 });
    const second = grant(broker, USABLE_SUBJECT, { maxUses: 10 });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const rotated = broker.rotateCredential({
      credentialRef: POLICY.credentialRef,
      nextSecret: rawSecret("r0tated-material"),
      nowMs: 1_500,
    });
    expect(rotated).toEqual({ ok: true, version: 2, leasesInvalidated: 2 });

    for (const handle of [first.handle, second.handle]) {
      expect(
        broker.resolveLease({
          handle,
          identityRef: USABLE_SUBJECT.identityRef,
          purpose: "mission:deliver-report",
          nowMs: 1_600,
        }),
      ).toEqual({ ok: false, reason: "lease_revoked:invalidated_by_rotation" });
    }
  });

  it("allows fresh leases on the new version only", () => {
    const { broker } = brokerWith();
    expect(
      broker.rotateCredential({
        credentialRef: POLICY.credentialRef,
        nextSecret: rawSecret("r0tated-material"),
        nowMs: 1_500,
      }).ok,
    ).toBe(true);
    const fresh = grant(broker, USABLE_SUBJECT, { nowMs: 2_000 });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const resolved = broker.resolveLease({
      handle: fresh.handle,
      identityRef: USABLE_SUBJECT.identityRef,
      purpose: "mission:deliver-report",
      nowMs: 2_100,
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.secret).toBe("r0tated-material");
  });

  it("audits rotation with the invalidated-lease count", () => {
    const { broker, audit } = brokerWith();
    grant(broker);
    broker.rotateCredential({
      credentialRef: POLICY.credentialRef,
      nextSecret: rawSecret("r0tated-material"),
      nowMs: 1_500,
    });
    const rotation = audit.list().find((event) => event.kind === "CREDENTIAL_ROTATED");
    expect(rotation?.kind === "CREDENTIAL_ROTATED" && rotation.leasesInvalidated).toBe(1);
  });

  it("fails closed when rotating a credential with no vault entry", () => {
    const { broker } = brokerWith({ withVaultEntry: false });
    const result = broker.rotateCredential({
      credentialRef: POLICY.credentialRef,
      nextSecret: rawSecret("r0tated-material"),
      nowMs: 1_500,
    });
    expect(result).toEqual({ ok: false, reason: "vault_entry_missing" });
  });
});

describe("non-observability — no raw secret serialization", () => {
  it("lease handles serialize without any secret material (runtime guard)", () => {
    const { broker } = brokerWith();
    const result = grant(broker);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const guard = broker.guardLeaseHandleSerialization(result.handle);
    expect(guard).toEqual({ ok: true });
    expect(JSON.stringify(result.handle)).not.toContain("s3cr3t-material");
  });

  it("the runtime guard catches a poisoned handle carrying secret material", () => {
    const { broker } = brokerWith();
    const forged = {
      leaseId: "lease:cred:tenant-a:delivery-api:1",
      credentialRef: POLICY.credentialRef,
      issuedAtMs: 1_000,
      expiresAtMs: 11_000,
      secret: "s3cr3t-material",
    } as unknown as CredentialLeaseHandle;
    expect(broker.guardLeaseHandleSerialization(forged)).toEqual({
      ok: false,
      reason: "handle_serialization_contains_secret_material",
    });
  });

  it("the audit log never contains secret material", () => {
    const { broker, audit } = brokerWith();
    const result = grant(broker);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    broker.resolveLease({
      handle: result.handle,
      identityRef: USABLE_SUBJECT.identityRef,
      purpose: "mission:deliver-report",
      nowMs: 1_100,
    });
    expect(JSON.stringify(audit.list())).not.toContain("s3cr3t-material");
    expect(JSON.stringify(broker.auditLog())).not.toContain("s3cr3t-material");
  });

  it("the operator view of a lease is fully redacted", () => {
    const { broker } = brokerWith();
    const result = grant(broker, USABLE_SUBJECT, { maxUses: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    broker.resolveLease({
      handle: result.handle,
      identityRef: USABLE_SUBJECT.identityRef,
      purpose: "mission:deliver-report",
      nowMs: 1_100,
    });
    const view = broker.inspectLease(result.handle, 1_200);
    expect(view?.status).toBe("exhausted");
    expect(JSON.stringify(view)).not.toContain("s3cr3t-material");
    expect(JSON.stringify(view)).not.toContain("secret");
  });
});

describe("fail-closed on missing vault entries (J-007)", () => {
  it("denies grants for a brokered credential with no vault entry", () => {
    const { broker } = brokerWith({ withVaultEntry: false });
    expect(grant(broker)).toEqual({ ok: false, reason: "vault_entry_missing" });
  });

  it("denies grants for a credential that is not brokered at all", () => {
    const { broker } = brokerWith();
    expect(
      broker.grant({
        subject: USABLE_SUBJECT,
        credentialRef: "cred:tenant-a:unknown",
        purpose: "mission:deliver-report",
        ttlMs: 10_000,
        maxUses: 1,
        nowMs: 1_000,
      }),
    ).toEqual({ ok: false, reason: "credential_not_brokered" });
  });
});

describe("emergency lockdown (J-010 / G-034)", () => {
  it("revokes ALL outstanding leases for the locked-out agent", () => {
    const { broker } = brokerWith();
    const lease = grant(broker);
    const otherAgent = grant(broker, { ...USABLE_SUBJECT, identityRef: "identity:worker-2" });
    expect(lease.ok && otherAgent.ok).toBe(true);
    if (!lease.ok || !otherAgent.ok) return;

    const lockdown = broker.emergencyLockdown({
      revokerIdentityRef: "identity:security-guardian",
      target: { identityRef: USABLE_SUBJECT.identityRef },
      reason: "suspected compromised worker credential",
      nowMs: 2_000,
    });
    expect(lockdown.ok).toBe(true);
    if (!lockdown.ok) return;
    expect(lockdown.leasesRevoked).toBe(1);
    expect(lockdown.evidenceRef).toContain("evidence:lockdown:");

    expect(
      broker.resolveLease({
        handle: lease.handle,
        identityRef: USABLE_SUBJECT.identityRef,
        purpose: "mission:deliver-report",
        nowMs: 2_100,
      }),
    ).toEqual({ ok: false, reason: "lease_revoked:emergency_lockdown" });
    // The other agent's lease is untouched.
    expect(
      broker.resolveLease({
        handle: otherAgent.handle,
        identityRef: "identity:worker-2",
        purpose: "mission:deliver-report",
        nowMs: 2_100,
      }).ok,
    ).toBe(true);
  });

  it("revokes leases for every agent in a locked-down tenant", () => {
    const { broker } = brokerWith();
    const lease = grant(broker);
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    const lockdown = broker.emergencyLockdown({
      revokerIdentityRef: "identity:security-guardian",
      target: { tenantRef: "tenant-a" },
      reason: "tenant-wide incident",
      nowMs: 2_000,
    });
    expect(lockdown.ok).toBe(true);
    if (!lockdown.ok) return;
    expect(lockdown.leasesRevoked).toBe(1);
    expect(
      broker.resolveLease({
        handle: lease.handle,
        identityRef: USABLE_SUBJECT.identityRef,
        purpose: "mission:deliver-report",
        nowMs: 2_100,
      }),
    ).toEqual({ ok: false, reason: "lease_revoked:emergency_lockdown" });
  });

  it("blocks further grants while the lockdown is active, and lifting restores grants", () => {
    const { broker } = brokerWith();
    expect(
      broker.emergencyLockdown({
        revokerIdentityRef: "identity:security-guardian",
        target: { identityRef: USABLE_SUBJECT.identityRef },
        reason: "incident",
        nowMs: 2_000,
      }).ok,
    ).toBe(true);
    expect(grant(broker, USABLE_SUBJECT, { nowMs: 2_100 })).toEqual({
      ok: false,
      reason: "identity_locked_down",
    });
    expect(broker.isLockedDown(USABLE_SUBJECT.identityRef, "tenant-a")).toBe(true);

    expect(
      broker.liftLockdown({
        revokerIdentityRef: "identity:security-guardian",
        target: { identityRef: USABLE_SUBJECT.identityRef },
        reason: "incident cleared after rotation",
        nowMs: 3_000,
      }).ok,
    ).toBe(true);
    expect(broker.isLockedDown(USABLE_SUBJECT.identityRef, "tenant-a")).toBe(false);
    expect(grant(broker, USABLE_SUBJECT, { nowMs: 3_100 }).ok).toBe(true);
  });

  it("records every invocation: granted lockdowns are evidence-bearing, denied ones are audited", () => {
    const { broker, audit } = brokerWith();
    const executed = broker.emergencyLockdown({
      revokerIdentityRef: "identity:security-guardian",
      target: { identityRef: USABLE_SUBJECT.identityRef },
      reason: "suspected compromise",
      nowMs: 2_000,
    });
    expect(executed.ok).toBe(true);

    const executedEvent = audit.list().find((event) => event.kind === "LOCKDOWN_EXECUTED");
    expect(executedEvent?.kind === "LOCKDOWN_EXECUTED" && executedEvent.evidenceRef).toContain(
      "evidence:lockdown:",
    );
    expect(executedEvent?.kind === "LOCKDOWN_EXECUTED" && executedEvent.reason).toBe(
      "suspected compromise",
    );

    broker.emergencyLockdown({
      revokerIdentityRef: "identity:random-bystander",
      target: { identityRef: "identity:worker-2" },
      reason: "attempted abuse",
      nowMs: 2_500,
    });
    const deniedEvent = audit.list().find((event) => event.kind === "LOCKDOWN_DENIED");
    expect(deniedEvent?.kind === "LOCKDOWN_DENIED" && deniedEvent.denyReason).toBe(
      "revoker_not_authorized",
    );
    expect(JSON.stringify(audit.list())).not.toContain("s3cr3t-material");
  });

  it("rejects unauthorized callers and never locks out without authorization", () => {
    const { broker } = brokerWith();
    const result = broker.emergencyLockdown({
      revokerIdentityRef: "identity:random-bystander",
      target: { identityRef: USABLE_SUBJECT.identityRef },
      reason: "attempted abuse",
      nowMs: 2_000,
    });
    expect(result).toEqual({ ok: false, reason: "revoker_not_authorized" });
    expect(broker.isLockedDown(USABLE_SUBJECT.identityRef, "tenant-a")).toBe(false);
  });

  it("the locked-out agent cannot invoke lockdown on itself", () => {
    const { broker, audit } = brokerWith({
      revokers: ["identity:security-guardian", "identity:worker-1"],
    });
    // Even if the worker somehow appears on the revoker list, self-lockdown
    // is denied: the kill-switch can never be invoked on the invoker.
    const result = broker.emergencyLockdown({
      revokerIdentityRef: USABLE_SUBJECT.identityRef,
      target: { identityRef: USABLE_SUBJECT.identityRef },
      reason: "self-initiated lockdown attempt",
      nowMs: 2_000,
    });
    expect(result).toEqual({ ok: false, reason: "self_lockdown_denied" });
    expect(broker.isLockedDown(USABLE_SUBJECT.identityRef, "tenant-a")).toBe(false);
    const denied = audit.list().find((event) => event.kind === "LOCKDOWN_DENIED");
    expect(denied?.kind === "LOCKDOWN_DENIED" && denied.denyReason).toBe("self_lockdown_denied");
  });

  it("requires a reason and a concrete target", () => {
    const { broker } = brokerWith();
    expect(
      broker.emergencyLockdown({
        revokerIdentityRef: "identity:security-guardian",
        target: {},
        reason: "no target",
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: "lockdown_target_required" });
    expect(
      broker.emergencyLockdown({
        revokerIdentityRef: "identity:security-guardian",
        target: { identityRef: USABLE_SUBJECT.identityRef },
        reason: "  ",
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: "lockdown_reason_required" });
  });

  it("lifting requires an authorized revoker and an active lockdown", () => {
    const { broker } = brokerWith();
    expect(
      broker.liftLockdown({
        revokerIdentityRef: "identity:random-bystander",
        target: { identityRef: USABLE_SUBJECT.identityRef },
        reason: "unauthorized lift",
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: "revoker_not_authorized" });
    expect(
      broker.liftLockdown({
        revokerIdentityRef: "identity:security-guardian",
        target: { identityRef: USABLE_SUBJECT.identityRef },
        reason: "nothing active",
        nowMs: 2_000,
      }),
    ).toEqual({ ok: false, reason: "lockdown_not_active" });
  });
});