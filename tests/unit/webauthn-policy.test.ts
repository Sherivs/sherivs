import { describe, expect, it } from "vitest";
import {
  WEBAUTHN_PUBLIC_ERROR,
  challengeExpired,
  credentialIdPrefix,
  decideSignatureCounter,
  defaultPasskeyLabel,
  hostnameIsRpSuffix,
  originAllowedForRp,
  parseWebAuthnConfig,
  sanitizePasskeyLabel,
  shouldOfferPasskeyEnrollment,
  shouldPrioritizePasskeyLogin,
  shouldShowCompactPasskeyAction,
  userIdFromUtf8Handle,
} from "../../frontend/src/lib/auth/webauthn-policy";

const production = {
  rpName: "Sherivs",
  rpID: "sherivs.com",
  origin: "https://app.sherivs.com",
  allowedOrigins: ["https://app.sherivs.com", "https://console.sherivs.com"],
  challengeTtlMs: 300_000,
};

describe("WebAuthn RP policy", () => {
  it("accepts app, console, and tenant hosts under sherivs.com", () => {
    expect(originAllowedForRp("https://app.sherivs.com", production)).toBe(true);
    expect(originAllowedForRp("https://console.sherivs.com", production)).toBe(true);
    expect(originAllowedForRp("https://lincoln.sherivs.com", production)).toBe(true);
    expect(originAllowedForRp("https://sherivs.com", production)).toBe(true);
  });

  it("rejects the wrong origin, RP suffix tricks, and http in production", () => {
    expect(originAllowedForRp("https://evil.example", production)).toBe(false);
    expect(originAllowedForRp("https://sherivs.com.evil.com", production)).toBe(false);
    expect(originAllowedForRp("https://notsherivs.com", production)).toBe(false);
    expect(originAllowedForRp("http://app.sherivs.com", production)).toBe(false);
    expect(hostnameIsRpSuffix("app.sherivs.com", "sherivs.com")).toBe(true);
    expect(hostnameIsRpSuffix("sherivs.com.attacker.test", "sherivs.com")).toBe(false);
  });

  it("allows localhost http on any port when RP ID is localhost", () => {
    const local = parseWebAuthnConfig({}, { fallbackLocal: true });
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    expect(originAllowedForRp("http://localhost:8080", local.config)).toBe(true);
    expect(originAllowedForRp("http://localhost:5173", local.config)).toBe(true);
    expect(originAllowedForRp("https://app.sherivs.com", local.config)).toBe(false);
  });

  it("requires https origin for production RP IDs", () => {
    const parsed = parseWebAuthnConfig({
      WEBAUTHN_RP_ID: "sherivs.com",
      WEBAUTHN_ORIGIN: "http://app.sherivs.com",
    });
    expect(parsed.ok).toBe(false);
  });

  it("rejects an origin whose hostname is not the RP ID or a subdomain", () => {
    const parsed = parseWebAuthnConfig({
      WEBAUTHN_RP_ID: "sherivs.com",
      WEBAUTHN_ORIGIN: "https://example.com",
    });
    expect(parsed.ok).toBe(false);
  });
});

describe("signature counters", () => {
  it("allows authenticators that never increment (counter 0)", () => {
    expect(decideSignatureCounter(0, 0)).toEqual({ ok: true, next: 0 });
  });

  it("advances when the authenticator increments", () => {
    expect(decideSignatureCounter(1, 4)).toEqual({ ok: true, next: 4 });
  });

  it("rejects a cloned authenticator whose counter does not advance", () => {
    expect(decideSignatureCounter(5, 5)).toEqual({ ok: false, code: "cloned_authenticator" });
    expect(decideSignatureCounter(5, 3)).toEqual({ ok: false, code: "cloned_authenticator" });
  });
});

describe("labels and helpers", () => {
  it("sanitizes labels and rejects empty or oversized names", () => {
    expect(sanitizePasskeyLabel("  Office laptop  ")).toBe("Office laptop");
    expect(sanitizePasskeyLabel("")).toBeNull();
    expect(sanitizePasskeyLabel("x".repeat(81))).toBeNull();
  });

  it("does not claim every device uses a fingerprint", () => {
    expect(defaultPasskeyLabel("2026-10-28T08:00:00.000Z", "singleDevice")).toContain(
      "This device",
    );
    expect(WEBAUTHN_PUBLIC_ERROR.auth_failed.toLowerCase()).not.toContain("fingerprint");
  });

  it("treats expired challenges as unusable and never logs a full credential id", () => {
    expect(challengeExpired(1000, 1000)).toBe(true);
    expect(challengeExpired(1001, 1000)).toBe(false);
    expect(credentialIdPrefix("abcdefghijklmnop")).toBe("abcdefgh");
  });

  it("only accepts UUID user handles", () => {
    expect(userIdFromUtf8Handle("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(userIdFromUtf8Handle("not-a-user")).toBeNull();
  });
});

describe("passkey onboarding eligibility", () => {
  const eligible = {
    credentialCount: 0,
    onboardingStatus: "pending" as const,
    webauthnSupported: true,
    preferencesAvailable: true,
  };

  it("offers enrollment only for a capable browser with no passkey and no skip", () => {
    expect(shouldOfferPasskeyEnrollment(eligible)).toBe(true);
  });

  it("does not prompt after skip, enrollment, existing credentials, or unsupported browsers", () => {
    expect(shouldOfferPasskeyEnrollment({ ...eligible, onboardingStatus: "dismissed" })).toBe(
      false,
    );
    expect(shouldOfferPasskeyEnrollment({ ...eligible, onboardingStatus: "enrolled" })).toBe(false);
    expect(shouldOfferPasskeyEnrollment({ ...eligible, credentialCount: 1 })).toBe(false);
    expect(shouldOfferPasskeyEnrollment({ ...eligible, webauthnSupported: false })).toBe(false);
    expect(shouldOfferPasskeyEnrollment({ ...eligible, preferencesAvailable: false })).toBe(false);
  });

  it("treats passkey-first as a UX preference, not as proof of a credential", () => {
    expect(
      shouldPrioritizePasskeyLogin({ webauthnSupported: true, passkeyFirstPreference: true }),
    ).toBe(true);
    expect(
      shouldPrioritizePasskeyLogin({ webauthnSupported: true, passkeyFirstPreference: false }),
    ).toBe(false);
    expect(
      shouldPrioritizePasskeyLogin({ webauthnSupported: false, passkeyFirstPreference: true }),
    ).toBe(false);
    expect(
      shouldShowCompactPasskeyAction({ webauthnSupported: true, devicePasskeyHint: false }),
    ).toBe(false);
  });
});
