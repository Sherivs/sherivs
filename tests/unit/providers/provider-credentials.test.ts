/**
 * CoreGrid — provider credential registry tests (mission §4/§26).
 *
 * Proves:
 * 1. The registry parses fail-closed (schema, uniqueness, hygiene).
 * 2. Every server-only classification is covered by the exposure checks
 *    (no credential classified server-side can leak through a client prefix
 *    undetected).
 * 3. The exposure audit flags VITE_/NEXT_PUBLIC_/PUBLIC_ leaks of any
 *    server-only credential and ignores client-safe configuration.
 * 4. Secret-shaped material in any field is rejected (defense in depth).
 * 5. Un-frozen observability/infra vendors (DECISIONS #204, 2026-10-06) carry
 *    verification probes WITHOUT app-runtime adapters, and the optional Redis
 *    plane stays NOT_CONFIGURED until credentials exist.
 */
import { describe, expect, it } from "vitest";
import {
  CLIENT_UNSAFE_CLASSIFICATIONS,
  PROVIDER_CREDENTIAL_REGISTRY,
  containsSecretShape,
  credentialEntryForEnvVar,
  registryClientPrefixExposures,
  registryServerOnlyEnvVars,
  validateProviderCredentialRegistry,
} from "../../../frontend/src/lib/providers/provider-credentials";

describe("provider credential registry", () => {
  it("parses fail-closed with zero issues", () => {
    const result = validateProviderCredentialRegistry();
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("carries unique env var names and no raw secret shapes", () => {
    const names = PROVIDER_CREDENTIAL_REGISTRY.map((entry) => entry.envVar);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of PROVIDER_CREDENTIAL_REGISTRY) {
      expect(containsSecretShape(`${entry.envVar}${entry.note}${entry.adapterRef ?? ""}`)).toBe(
        false,
      );
    }
  });

  it("never assigns a client runtime scope to a server-only classification", () => {
    for (const entry of PROVIDER_CREDENTIAL_REGISTRY) {
      if (CLIENT_UNSAFE_CLASSIFICATIONS.includes(entry.classification)) {
        expect(entry.runtimeScope).not.toBe("client");
      }
    }
  });

  it("derives server-only env vars from the registry", () => {
    const serverOnly = registryServerOnlyEnvVars();
    expect(serverOnly).toContain("RESEND_API_KEY");
    expect(serverOnly).toContain("PAYSTACK_SECRET_KEY");
    expect(serverOnly).toContain("TWILIO_AUTH_TOKEN");
    expect(serverOnly).toContain("VAPI_API_KEY");
    expect(serverOnly).toContain("POSTHOG_PERSONAL_API_KEY");
    expect(serverOnly).not.toContain("SUPABASE_URL");
    expect(serverOnly).not.toContain("SUPABASE_ANON_KEY");
  });

  it("flags server-only credentials under every client-visible prefix", () => {
    const env = {
      VITE_RESEND_API_KEY: "leak",
      NEXT_PUBLIC_PAYSTACK_SECRET_KEY: "leak",
      PUBLIC_TWILIO_AUTH_TOKEN: "leak",
      VITE_SUPABASE_URL: "https://example.supabase.co",
    };
    const exposures = registryClientPrefixExposures(env);
    expect(exposures).toContain("RESEND_API_KEY");
    expect(exposures).toContain("PAYSTACK_SECRET_KEY");
    expect(exposures).toContain("TWILIO_AUTH_TOKEN");
    expect(exposures).not.toContain("SUPABASE_URL");
  });

  it("ignores empty-string exposures (not a leak)", () => {
    const exposures = registryClientPrefixExposures({ VITE_RESEND_API_KEY: "" });
    expect(exposures).toEqual([]);
  });

  it("classifies un-frozen vendors with probes and no app-runtime adapter (DECISIONS #204)", () => {
    for (const [provider, envVar] of [
      ["posthog", "POSTHOG_PERSONAL_API_KEY"],
      ["sentry", "SENTRY_AUTH_TOKEN"],
      ["new-relic", "NEW_RELIC_USER_KEY"],
      ["cloudflare", "CLOUDFLARE_API_TOKEN"],
      ["vercel", "VERCEL_API_TOKEN"],
      ["expo-eas", "EXPO_TOKEN"],
    ] as const) {
      const entry = credentialEntryForEnvVar(envVar);
      expect(entry).not.toBeNull();
      expect(entry?.provider).toBe(provider);
      expect(entry?.adapterRef).toBeNull();
      expect(entry?.hasHealthCheck).toBe(true);
      expect(entry?.status).not.toBe("NOT_REQUIRED");
      expect(entry?.verificationLevel).toBe("provider_reachable");
    }
  });

  it("keeps the optional Redis plane NOT_CONFIGURED until credentials exist", () => {
    for (const envVar of ["REDIS_REST_URL", "REDIS_REST_TOKEN"]) {
      const entry = credentialEntryForEnvVar(envVar);
      expect(entry).not.toBeNull();
      expect(entry?.provider).toBe("redis");
      expect(entry?.status).toBe("NOT_CONFIGURED");
      expect(entry?.verificationLevel).toBe("none");
    }
    const token = credentialEntryForEnvVar("REDIS_REST_TOKEN");
    expect(token?.classification).toBe("server_runtime_secret");
    expect(registryServerOnlyEnvVars()).toContain("REDIS_REST_TOKEN");
    expect(registryServerOnlyEnvVars()).toContain("POSTHOG_PERSONAL_API_KEY");
    // The region-host config entries are evidence-backed, never NOT_REQUIRED.
    const posthogUrl = credentialEntryForEnvVar("POSTHOG_API_URL");
    expect(posthogUrl?.classification).toBe("server_runtime_configuration");
    const newRelicUrl = credentialEntryForEnvVar("NEW_RELIC_API_URL");
    expect(newRelicUrl?.classification).toBe("server_runtime_configuration");
  });

  it("refuses a registry entry carrying secret-shaped material", () => {
    const corrupted = [
      ...PROVIDER_CREDENTIAL_REGISTRY.map((entry) => ({ ...entry })),
    ];
    corrupted[0] = { ...corrupted[0], note: "leaked re_0123456789abcdef1234 value" };
    const result = validateProviderCredentialRegistry(corrupted);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes("secret-shaped"))).toBe(true);
  });

  it("refuses duplicate env vars", () => {
    const corrupted = [
      ...PROVIDER_CREDENTIAL_REGISTRY.map((entry) => ({ ...entry })),
      { ...PROVIDER_CREDENTIAL_REGISTRY[0] },
    ];
    const result = validateProviderCredentialRegistry(corrupted);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes("duplicate env var"))).toBe(true);
  });
});