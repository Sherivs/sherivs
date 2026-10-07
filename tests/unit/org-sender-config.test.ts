import { describe, expect, it } from "vitest";

import {
  resolveSenderForOrg,
  validateOrgCommunicationSender,
  type OrgCommunicationSender,
} from "../../frontend/src/lib/communications/org-sender-config";

const TENANT = "tenant-a";
const ORG = "org-1";
const NOW = "2026-10-07T12:00:00.000Z";

function makeSender(overrides: Partial<OrgCommunicationSender> = {}): OrgCommunicationSender {
  return {
    senderRef: "sender-1",
    tenantId: TENANT,
    orgRef: ORG,
    channel: "sms",
    provider: "twilio",
    fromNumber: "+15550001111",
    credentialRef: "env://TWILIO_ACCOUNT_SID",
    status: "active",
    provenance: {
      createdBy: "operator",
      createdAt: "2026-10-07T10:00:00.000Z",
      authorityRef: "DECISIONS.md#210",
      note: null,
    },
    ...overrides,
  };
}

describe("org communication sender contract (PLATFORM-019)", () => {
  it("validates a well-formed sender with no problems", () => {
    expect(validateOrgCommunicationSender(makeSender())).toEqual([]);
  });

  it("fails closed on a non-E.164 from number, a raw credential value, and an unknown status", () => {
    expect(validateOrgCommunicationSender(makeSender({ fromNumber: "15550001111" }))).toEqual([
      "fromNumber must be an E.164 phone number",
    ]);
    // A raw secret-shaped credentialRef is rejected: only env:// pointers are legal (§30).
    expect(validateOrgCommunicationSender(makeSender({ credentialRef: "sk_live_abcdefghijklmnopqrstu" }))).toEqual([
      "credentialRef must be an env:// pointer (never a secret value)",
    ]);
    expect(validateOrgCommunicationSender(makeSender({ status: "retired" as OrgCommunicationSender["status"] }))).toEqual([
      'status "retired" is not a sender lifecycle status',
    ]);
  });

  it("resolves the org's own active sender over the platform default", () => {
    const resolution = resolveSenderForOrg({
      tenantId: TENANT,
      orgRef: ORG,
      senders: [makeSender({ fromNumber: "+15550002222" })],
      platformFromNumber: "+15550000000",
    });
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      expect(resolution.source).toBe("org_sender");
      expect(resolution.fromNumber).toBe("+15550002222");
      expect(resolution.sender?.senderRef).toBe("sender-1");
    }
  });

  it("falls back to the platform default when the org has no active sender", () => {
    const resolution = resolveSenderForOrg({
      tenantId: TENANT,
      orgRef: ORG,
      senders: [makeSender({ status: "suspended" }), makeSender({ status: "pending_provision", senderRef: "sender-2" })],
      platformFromNumber: "+15550000000",
    });
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      expect(resolution.source).toBe("platform_default");
      expect(resolution.sender).toBeNull();
      expect(resolution.fromNumber).toBe("+15550000000");
    }
  });

  it("resolves nothing when neither an org sender nor a platform default exists (fail closed)", () => {
    const resolution = resolveSenderForOrg({
      tenantId: TENANT,
      orgRef: ORG,
      senders: [],
      platformFromNumber: null,
    });
    expect(resolution.resolved).toBe(false);
    if (!resolution.resolved) {
      expect(resolution.reason).toMatch(/fail closed/);
      expect(resolution.reason).toContain("TWILIO_FROM_NUMBER");
    }
  });

  it("refuses a malformed platform default instead of guessing", () => {
    const resolution = resolveSenderForOrg({
      tenantId: TENANT,
      orgRef: ORG,
      senders: [],
      platformFromNumber: "1555000",
    });
    expect(resolution.resolved).toBe(false);
    if (!resolution.resolved) {
      expect(resolution.reason).toMatch(/not a well-formed E\.164/);
    }
  });

  it("excludes and counts cross-tenant records without ever mixing them", () => {
    const resolution = resolveSenderForOrg({
      tenantId: TENANT,
      orgRef: ORG,
      senders: [makeSender(), makeSender({ tenantId: "tenant-b", senderRef: "sender-b" }), makeSender({ orgRef: "org-2", senderRef: "sender-3" })],
      platformFromNumber: null,
    });
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      expect(resolution.excludedCrossTenant).toBe(2);
      expect(resolution.excludedMalformed).toBe(0);
      expect(resolution.fromNumber).toBe("+15550001111");
    }
  });

  it("excludes and counts malformed records instead of repairing them", () => {
    const resolution = resolveSenderForOrg({
      tenantId: TENANT,
      orgRef: ORG,
      senders: [makeSender(), makeSender({ senderRef: "bad-1", fromNumber: "not-e164" }), makeSender({ senderRef: "bad-2", credentialRef: "raw-secret-material" })],
      platformFromNumber: null,
    });
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      expect(resolution.excludedMalformed).toBe(2);
      expect(resolution.fromNumber).toBe("+15550001111");
    }
  });

  it("breaks active-sender ties deterministically (createdAt desc, then senderRef asc)", () => {
    const resolution = resolveSenderForOrg({
      tenantId: TENANT,
      orgRef: ORG,
      senders: [
        makeSender({ senderRef: "sender-older", fromNumber: "+15550007777", provenance: { createdBy: "op", createdAt: "2026-10-06T00:00:00.000Z", authorityRef: null, note: null } }),
        makeSender({ senderRef: "sender-zzz", fromNumber: "+15550006666", provenance: { createdBy: "op", createdAt: "2026-10-07T00:00:00.000Z", authorityRef: null, note: null } }),
        makeSender({ senderRef: "sender-aaa", fromNumber: "+15550005555", provenance: { createdBy: "op", createdAt: "2026-10-07T00:00:00.000Z", authorityRef: null, note: null } }),
      ],
      platformFromNumber: null,
    });
    expect(resolution.resolved).toBe(true);
    if (resolution.resolved) {
      // Newest createdAt wins; on the tie the lexically smaller ref wins.
      expect(resolution.sender?.senderRef).toBe("sender-aaa");
      expect(resolution.fromNumber).toBe("+15550005555");
    }
  });

  it("throws on an empty orgRef or tenantRef (multi-tenancy law)", () => {
    expect(() => resolveSenderForOrg({ tenantId: "  ", orgRef: ORG, senders: [], platformFromNumber: null })).toThrow(/tenantId/);
    expect(() => resolveSenderForOrg({ tenantId: TENANT, orgRef: "", senders: [], platformFromNumber: null })).toThrow(/orgRef/);
  });
});