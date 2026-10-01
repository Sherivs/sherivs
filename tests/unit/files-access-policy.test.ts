/**
 * CoreGrid — file access-policy tests (deny by default, tenant isolation,
 * owner allowance, grant expiry — Constitution §31 security negatives).
 */
import { describe, expect, it } from "vitest";
import {
  decideFileAccess,
  type FileAccessDecision,
  type FilePrincipal,
} from "../../frontend/src/lib/files/access-policy";
import type { FileDescriptor } from "../../frontend/src/lib/files/file-contract";

function denyCodeOf(outcome: FileAccessDecision): string | null {
  return outcome.decision === "deny" ? outcome.code : null;
}

const descriptor: FileDescriptor = {
  tenantId: "tenant-a",
  ownerRef: "owner-1",
  fileId: "file-0001",
  purpose: "document",
  contentType: "application/pdf",
  sizeBytes: 1024,
  filename: "transcript.pdf",
  sharing: { visibility: "private" },
};

const now = new Date("2026-10-01T00:00:00Z");

function principal(overrides: Partial<FilePrincipal> = {}): FilePrincipal {
  return {
    userId: "user-9",
    tenantId: "tenant-a",
    role: "teacher",
    grants: [],
    ...overrides,
  };
}

describe("cross-tenant denial (always, with explicit reason)", () => {
  it("denies a principal from another tenant even when every other signal matches", () => {
    const outcome = decideFileAccess(
      principal({ tenantId: "tenant-b", userId: "owner-1" }),
      descriptor,
      now,
    );
    expect(outcome).toEqual({
      decision: "deny",
      code: "cross_tenant",
      reason: 'principal tenant "tenant-b" does not match file tenant "tenant-a"',
    });
  });

  it("denies cross-tenant even for explicit grant holders and platform supers", () => {
    const holder = principal({
      tenantId: "tenant-b",
      grants: [{ fileId: "file-0001", expiresAt: "2027-01-01T00:00:00Z" }],
      isPlatformSuper: true,
    });
    expect(denyCodeOf(decideFileAccess(holder, descriptor, now))).toBe("cross_tenant");
    expect(
      denyCodeOf(decideFileAccess(principal({ tenantId: "tenant-b" }), descriptor, now)),
    ).toBe("cross_tenant");
  });

  it("denies cross-tenant even when the principal claims ownership", () => {
    const outcome = decideFileAccess(
      principal({ tenantId: "tenant-b", userId: "owner-1" }),
      descriptor,
      now,
    );
    expect(denyCodeOf(outcome)).toBe("cross_tenant");
  });
});

describe("owner allowance", () => {
  it("allows the owner within the same tenant for every sharing model", () => {
    for (const sharing of [
      { visibility: "private" as const },
      { visibility: "org" as const },
      { visibility: "explicit" as const, grantRefs: ["grant-1"] },
    ]) {
      expect(
        decideFileAccess(principal({ userId: "owner-1" }), { ...descriptor, sharing }, now),
      ).toEqual({ decision: "allow", reason: "owner" });
    }
  });
});

describe("explicit grants (honored only while unexpired)", () => {
  const explicit: FileDescriptor = {
    ...descriptor,
    sharing: { visibility: "explicit", grantRefs: ["grant-1"] },
  };

  it("allows a same-tenant principal holding an unexpired grant", () => {
    const holder = principal({ grants: [{ fileId: "file-0001", expiresAt: "2026-10-02T00:00:00Z" }] });
    expect(decideFileAccess(holder, explicit, now)).toEqual({
      decision: "allow",
      reason: "explicit_grant",
    });
  });

  it("denies an expired grant (security-negative)", () => {
    const holder = principal({ grants: [{ fileId: "file-0001", expiresAt: "2026-09-30T23:59:59Z" }] });
    expect(decideFileAccess(holder, explicit, now)).toEqual({
      decision: "deny",
      code: "grant_expired",
      reason: 'grant for file "file-0001" expired at 2026-09-30T23:59:59Z',
    });
  });

  it("denies when the grant is missing or points at another file", () => {
    expect(denyCodeOf(decideFileAccess(principal(), explicit, now))).toBe("no_grant");
    const otherFile = principal({ grants: [{ fileId: "file-9999" }] });
    expect(denyCodeOf(decideFileAccess(otherFile, explicit, now))).toBe("no_grant");
  });

  it("fails closed on an unparseable expiry", () => {
    const holder = principal({ grants: [{ fileId: "file-0001", expiresAt: "not-a-date" }] });
    expect(denyCodeOf(decideFileAccess(holder, explicit, now))).toBe("grant_expired");
  });
});

describe("org sharing and deny-by-default", () => {
  it("allows any same-tenant principal for org-visible files", () => {
    const org: FileDescriptor = { ...descriptor, sharing: { visibility: "org" } };
    expect(decideFileAccess(principal(), org, now)).toEqual({
      decision: "allow",
      reason: "org_shared",
    });
  });

  it("denies non-owners on private files (deny by default)", () => {
    expect(decideFileAccess(principal(), descriptor, now)).toEqual({
      decision: "deny",
      code: "private_no_owner",
      reason: "private files are readable by their owner only",
    });
  });

  it("denies principals without a user id even for org files", () => {
    const org: FileDescriptor = { ...descriptor, sharing: { visibility: "org" } };
    expect(denyCodeOf(decideFileAccess(principal({ userId: "  " }), org, now))).toBe(
      "private_no_owner",
    );
  });
});
