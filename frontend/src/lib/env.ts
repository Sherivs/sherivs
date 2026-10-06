/**
 * CoreGrid environment validation.
 * Pure helpers - no process.env reads, so unit-testable.
 */

import { registryServerOnlyEnvVars } from "./providers/provider-credentials";

export type AppEnvironment = "local" | "development" | "test" | "staging" | "production";

export const APP_ENVIRONMENTS: readonly AppEnvironment[] = [
  "local",
  "development",
  "test",
  "staging",
  "production",
] as const;

/**
 * Legacy server-only secret names that predate the provider credential
 * registry (provider-credentials.ts is the canonical source for the newer
 * names). Both sources are enforced.
 */
const LEGACY_SERVER_ONLY_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_API_KEY",
  "NVIDIA_API_KEY",
  "VAPID_PRIVATE_KEY",
  "PAYSTACK_SECRET_KEY",
  "TWILIO_API_KEY",
  "TWILIO_AUTH_TOKEN",
] as const;

/**
 * Server-only secrets that must NEVER be exposed via VITE_/NEXT_PUBLIC_/
 * PUBLIC_ prefixes: the union of legacy names and every registry credential
 * classified server_runtime_secret / deployment_infrastructure_secret.
 */
export const SERVER_ONLY_VARS: readonly string[] = Array.from(
  new Set([...LEGACY_SERVER_ONLY_VARS, ...registryServerOnlyEnvVars()]),
);

/** Required vars per environment. */
export const REQUIRED_VARS: Record<AppEnvironment, readonly string[]> = {
  local: [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ],
  development: [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ],
  test: [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ],
  staging: [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ],
  production: [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ],
};

/** Classify raw env value. Unknown -> "development" (fail-safe). */
export function classifyEnvironment(raw: string | undefined): AppEnvironment {
  if (!raw) return "development";
  const n = raw.trim().toLowerCase();
  return APP_ENVIRONMENTS.includes(n as AppEnvironment) ? (n as AppEnvironment) : "development";
}

/** Missing required var names for the given environment. */
export function missingRequiredVars(
  env: Record<string, string | undefined>,
  environment: AppEnvironment,
): string[] {
  return REQUIRED_VARS[environment].filter((name) => !env[name] || env[name]!.trim() === "");
}

/** Client-visible prefixes that would bundle a variable into browser code. */
const CLIENT_PREFIXES = ["VITE_", "NEXT_PUBLIC_", "PUBLIC_"] as const;

/**
 * Server-only vars exposed through ANY client-visible prefix. Covers the
 * classic Vite `VITE_` leak plus `NEXT_PUBLIC_` and `PUBLIC_` so a port or
 * refactor cannot silently move a secret into the browser bundle.
 */
export function exposedServerOnlyVars(env: Record<string, string | undefined>): string[] {
  return SERVER_ONLY_VARS.filter((name) =>
    CLIENT_PREFIXES.some((prefix) => {
      const value = env[`${prefix}${name}`];
      return typeof value === "string" && value.trim() !== "";
    }),
  );
}

/** True when all required vars present and no secrets exposed. */
export function isEnvironmentValid(
  env: Record<string, string | undefined>,
  environment: AppEnvironment,
): boolean {
  return (
    missingRequiredVars(env, environment).length === 0 && exposedServerOnlyVars(env).length === 0
  );
}

/** Human-readable issues; empty means valid. */
export function environmentIssues(
  env: Record<string, string | undefined>,
  environment: AppEnvironment,
): string[] {
  const issues: string[] = [];
  const missing = missingRequiredVars(env, environment);
  if (missing.length > 0)
    issues.push(`Missing required variables for ${environment}: ${missing.join(", ")}`);
  const exposed = exposedServerOnlyVars(env);
  if (exposed.length > 0)
    issues.push(`Server-only secrets exposed to client via VITE_ prefix: ${exposed.join(", ")}`);
  return issues;
}
