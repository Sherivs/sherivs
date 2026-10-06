import { describe, expect, it } from "vitest";
import {
  classifyEnvironment,
  environmentIssues,
  exposedServerOnlyVars,
  isEnvironmentValid,
  missingRequiredVars,
} from "../../frontend/src/lib/env";

describe("classifyEnvironment", () => {
  it("classifies known environments", () => {
    expect(classifyEnvironment("local")).toBe("local");
    expect(classifyEnvironment("development")).toBe("development");
    expect(classifyEnvironment("test")).toBe("test");
    expect(classifyEnvironment("staging")).toBe("staging");
    expect(classifyEnvironment("production")).toBe("production");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(classifyEnvironment("  PRODUCTION  ")).toBe("production");
    expect(classifyEnvironment("Local")).toBe("local");
  });

  it("defaults to development for unknown or missing values", () => {
    expect(classifyEnvironment(undefined)).toBe("development");
    expect(classifyEnvironment("")).toBe("development");
    expect(classifyEnvironment("weird")).toBe("development");
  });
});

describe("missingRequiredVars", () => {
  const base = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "pk_test",
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "pk_test",
  };

  it("returns empty when all required vars are present", () => {
    expect(missingRequiredVars(base, "local")).toEqual([]);
  });

  it("detects missing vars", () => {
    expect(missingRequiredVars({}, "local")).toContain("SUPABASE_URL");
  });

  it("treats empty-string values as missing", () => {
    const env = { ...base, SUPABASE_URL: "" };
    expect(missingRequiredVars(env, "local")).toContain("SUPABASE_URL");
  });

  it("requires service-role key for staging and production", () => {
    expect(missingRequiredVars(base, "staging")).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(missingRequiredVars(base, "production")).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("exposedServerOnlyVars", () => {
  it("returns empty when no secrets are exposed", () => {
    expect(exposedServerOnlyVars({})).toEqual([]);
  });

  it("detects server-only secrets exposed via VITE_ prefix", () => {
    const env = { VITE_SUPABASE_SERVICE_ROLE_KEY: "secret" };
    expect(exposedServerOnlyVars(env)).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("detects server-only secrets exposed via NEXT_PUBLIC_ and PUBLIC_ prefixes", () => {
    expect(
      exposedServerOnlyVars({ NEXT_PUBLIC_RESEND_API_KEY: "secret" }),
    ).toContain("RESEND_API_KEY");
    expect(exposedServerOnlyVars({ PUBLIC_PAYSTACK_SECRET_KEY: "secret" })).toContain(
      "PAYSTACK_SECRET_KEY",
    );
  });

  it("covers registry-managed credentials (Twilio auth token, Vapi key)", () => {
    expect(exposedServerOnlyVars({ VITE_TWILIO_AUTH_TOKEN: "secret" })).toContain(
      "TWILIO_AUTH_TOKEN",
    );
    expect(exposedServerOnlyVars({ VITE_VAPI_API_KEY: "secret" })).toContain("VAPI_API_KEY");
  });

  it("ignores empty exposed values", () => {
    const env = { VITE_SUPABASE_SERVICE_ROLE_KEY: "" };
    expect(exposedServerOnlyVars(env)).toEqual([]);
  });
});

describe("isEnvironmentValid", () => {
  const valid = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "pk_test",
    VITE_SUPABASE_URL: "https://example.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "pk_test",
  };

  it("returns true for a valid local environment", () => {
    expect(isEnvironmentValid(valid, "local")).toBe(true);
  });

  it("returns false when required vars are missing", () => {
    expect(isEnvironmentValid({}, "local")).toBe(false);
  });

  it("returns false when secrets are exposed", () => {
    const env = { ...valid, VITE_SUPABASE_SERVICE_ROLE_KEY: "secret" };
    expect(isEnvironmentValid(env, "local")).toBe(false);
  });
});

describe("environmentIssues", () => {
  it("returns empty for a valid environment", () => {
    const valid = {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "pk_test",
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "pk_test",
    };
    expect(environmentIssues(valid, "local")).toEqual([]);
  });

  it("reports missing vars and exposed secrets", () => {
    const env = { VITE_SUPABASE_SERVICE_ROLE_KEY: "secret" };
    const issues = environmentIssues(env, "production");
    expect(issues.some((i) => i.includes("Missing required variables"))).toBe(true);
    expect(issues.some((i) => i.includes("Server-only secrets exposed"))).toBe(true);
  });
});
