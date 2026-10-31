import { describe, expect, it } from "vitest";
import {
  candidateRpHosts,
  nativeCeremonyOrigin,
  resolveCeremonyRelyingParty,
  selectCustomDomainRelyingParty,
  selectSchoolDomainForHost,
} from "../../frontend/src/lib/auth/webauthn-relying-party";
import { parseWebAuthnConfig } from "../../frontend/src/lib/auth/webauthn-policy";

const platform = {
  rpName: "Sherivs",
  rpID: "sherivs.com",
  origin: "https://app.sherivs.com",
  allowedOrigins: ["https://app.sherivs.com", "https://console.sherivs.com"],
  challengeTtlMs: 300_000,
};

describe("custom-domain relying party selection", () => {
  it("walks hostname labels without stripping only the first label", () => {
    expect(candidateRpHosts("portal.school.edu.ng")).toEqual([
      "portal.school.edu.ng",
      "school.edu.ng",
      "edu.ng",
    ]);
  });

  it("accepts a verified custom domain and binds the RP ID to that hostname", () => {
    const config = selectCustomDomainRelyingParty({
      origin: "https://portal.school.edu.ng",
      domain: { hostname: "school.edu.ng", status: "verified", schoolId: "school-a" },
      rpName: "Sherivs",
      challengeTtlMs: 300_000,
    });
    expect(config?.rpID).toBe("school.edu.ng");
    expect(config?.origin).toBe("https://portal.school.edu.ng");
  });

  it("rejects unverified, revoked, http, and wrong-origin ceremonies", () => {
    expect(
      selectCustomDomainRelyingParty({
        origin: "https://portal.school.edu.ng",
        domain: { hostname: "school.edu.ng", status: "pending", schoolId: "school-a" },
        rpName: "Sherivs",
        challengeTtlMs: 300_000,
      }),
    ).toBeNull();
    expect(
      selectCustomDomainRelyingParty({
        origin: "https://portal.school.edu.ng",
        domain: { hostname: "school.edu.ng", status: "removed", schoolId: "school-a" },
        rpName: "Sherivs",
        challengeTtlMs: 300_000,
      }),
    ).toBeNull();
    expect(
      selectCustomDomainRelyingParty({
        origin: "http://portal.school.edu.ng",
        domain: { hostname: "school.edu.ng", status: "verified", schoolId: "school-a" },
        rpName: "Sherivs",
        challengeTtlMs: 300_000,
      }),
    ).toBeNull();
    expect(
      selectCustomDomainRelyingParty({
        origin: "https://other.school.edu.ng",
        domain: { hostname: "portal.school.edu.ng", status: "verified", schoolId: "school-a" },
        rpName: "Sherivs",
        challengeTtlMs: 300_000,
      }),
    ).toBeNull();
  });

  it("does not fall through an unverified exact host to a verified parent", () => {
    const selected = selectSchoolDomainForHost("portal.school.edu.ng", [
      { hostname: "portal.school.edu.ng", status: "pending", schoolId: "school-a" },
      { hostname: "school.edu.ng", status: "verified", schoolId: "school-a" },
    ]);
    expect(selected).toBeNull();
  });

  it("keeps sherivs.com credentials on the platform RP", () => {
    const resolved = resolveCeremonyRelyingParty({
      origin: "https://app.sherivs.com",
      platform,
      domain: { hostname: "school.edu.ng", status: "verified", schoolId: "school-a" },
    });
    expect(resolved?.rpID).toBe("sherivs.com");
  });

  it("binds native iOS/Android ceremonies to the platform RP origin, not a custom domain", () => {
    expect(nativeCeremonyOrigin({ rpID: "sherivs.com" })).toBe("https://sherivs.com");
    expect(nativeCeremonyOrigin({ rpID: "localhost" })).toBe("http://localhost");
  });

  it("does not treat a Host-like suffix trick as a platform origin", () => {
    const parsed = parseWebAuthnConfig({
      WEBAUTHN_RP_ID: "sherivs.com",
      WEBAUTHN_ORIGIN: "https://app.sherivs.com",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      resolveCeremonyRelyingParty({
        origin: "https://sherivs.com.evil.test",
        platform: parsed.config,
        domain: null,
      }),
    ).toBeNull();
  });
});
