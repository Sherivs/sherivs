/**
 * CoreGrid Mobile V1-010 — environment contract tests.
 *
 * Validates the fail-closed environment contract: valid configurations
 * parse, invalid ones are rejected with the full violation list, secrets
 * never appear as accepted variable shapes, and the server-function id
 * format is enforced.
 */
import { describe, expect, it } from "vitest";
import { MobileEnvError, parseMobileEnv } from "../../mobile/src/api/contracts/env";

const VALID_ENV: Record<string, string> = {
  EXPO_PUBLIC_APP_ENV: "development",
  EXPO_PUBLIC_SUPABASE_URL: "https://probe.supabase.co",
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
  EXPO_PUBLIC_COREGRID_WEB_BASE_URL: "https://app.coregrid.example/",
  EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP: "",
  EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES: "",
};

describe("mobile environment contract", () => {
  it("parses a valid environment and normalizes the web base URL", () => {
    const env = parseMobileEnv(VALID_ENV);
    expect(env.appEnv).toBe("development");
    expect(env.supabaseUrl).toBe("https://probe.supabase.co");
    expect(env.supabasePublishableKey).toBe("sb_publishable_abc123");
    expect(env.coregridWebBaseUrl).toBe("https://app.coregrid.example");
    expect(env.serverFnIds.recordFoundationLoop).toBeNull();
    expect(env.serverFnIds.listIdentities).toBeNull();
  });

  it("accepts set server-function ids only in the 64-hex format", () => {
    const id = "e".repeat(64);
    const env = parseMobileEnv({
      ...VALID_ENV,
      EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP: id,
    });
    expect(env.serverFnIds.recordFoundationLoop).toBe(id);
    expect(() =>
      parseMobileEnv({
        ...VALID_ENV,
        EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES: "not-an-id",
      }),
    ).toThrow(MobileEnvError);
  });

  it("rejects every missing required variable in one fail-closed report", () => {
    try {
      parseMobileEnv({});
      expect.unreachable("missing environment must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(MobileEnvError);
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain("EXPO_PUBLIC_APP_ENV");
      expect(message).toContain("EXPO_PUBLIC_SUPABASE_URL");
      expect(message).toContain("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
      expect(message).toContain("EXPO_PUBLIC_COREGRID_WEB_BASE_URL");
    }
  });

  it("rejects an unknown environment channel", () => {
    expect(() =>
      parseMobileEnv({ ...VALID_ENV, EXPO_PUBLIC_APP_ENV: "staging" }),
    ).toThrow(MobileEnvError);
  });

  it("rejects a service-role style key (secret shapes never accepted client-side)", () => {
    expect(() =>
      parseMobileEnv({
        ...VALID_ENV,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_should_never_be_client_side",
      }),
    ).toThrow(MobileEnvError);
  });

  it("rejects a non-http URL", () => {
    expect(() =>
      parseMobileEnv({ ...VALID_ENV, EXPO_PUBLIC_SUPABASE_URL: "ftp://probe.supabase.co" }),
    ).toThrow(MobileEnvError);
  });
});