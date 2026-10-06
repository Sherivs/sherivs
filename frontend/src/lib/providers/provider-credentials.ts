/**
 * CoreGrid — provider credential registry (machine-readable, secret-free).
 *
 * The single DATA contract that maps every platform-relevant provider
 * credential to its classification, owning adapter surface, required
 * capability, and verification level. This module is the registry plane:
 * it carries environment variable NAMES and `env://` REFERENCES only —
 * never a secret VALUE (Constitution §30). A raw-looking key material in
 * any field is a construction-time failure (same hygiene law as
 * `communication-providers.assertCredentialReference`).
 *
 * Layers (Constitution §24, provider-abstraction law):
 *
 *   credential (this registry, classified)
 *        → secure runtime configuration (lib/env + per-adapter configFromEnv)
 *        → provider adapter (communications/, payments/, ai-gateway)
 *        → CoreGrid capability service
 *        → observability + verification (observability/provider-health.server)
 *
 * Classification vocabulary (mission §4):
 * - public_configuration            may appear client-side where appropriate
 * - client_safe_identifier          client-side only if the provider requires it
 * - server_runtime_configuration    non-secret server config, never bundled client-side
 * - server_runtime_secret           server-side only, never VITE_/NEXT_PUBLIC_/PUBLIC_
 * - deployment_infrastructure_secret  CI/CD/infra scope only, never app runtime
 *
 * The `posthog` and `sentry` vendor integrations are V2-DEFERRED by the V1
 * capability matrix (V1CAP-29); this registry classifies their credentials
 * without implementing any vendor surface (Constitution §45).
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Vocabularies
 * ────────────────────────────────────────────────────────────*/

export const CREDENTIAL_CLASSIFICATIONS = [
  "public_configuration",
  "client_safe_identifier",
  "server_runtime_configuration",
  "server_runtime_secret",
  "deployment_infrastructure_secret",
] as const;
export type CredentialClassification = (typeof CREDENTIAL_CLASSIFICATIONS)[number];

/** Server-only secrets that must NEVER be exposed via a client prefix. */
export const CLIENT_UNSAFE_CLASSIFICATIONS: readonly CredentialClassification[] = [
  "server_runtime_secret",
  "deployment_infrastructure_secret",
] as const;

/** Mission §26 provider status vocabulary (evidence-backed only). */
export const PROVIDER_STATUSES = [
  "OPERATIONAL",
  "CONFIGURED_BUT_UNVERIFIED",
  "NOT_CONFIGURED",
  "NOT_REQUIRED",
  "BLOCKED",
] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/** Mission §32 evidence ladder — each level implies all below it. */
export const VERIFICATION_LEVELS = [
  "none",
  "credential_present",
  "configuration_valid",
  "sdk_initialized",
  "provider_reachable",
  "capability_tested",
  "application_path_verified",
  "production_deployment_verified",
] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

/** Runtime scope a credential is authorized for. */
export const RUNTIME_SCOPES = ["client", "server", "infrastructure"] as const;
export type RuntimeScope = (typeof RUNTIME_SCOPES)[number];

/* ─────────────────────────────────────────────────────────────
 * Entry schema
 * ────────────────────────────────────────────────────────────*/

const REF_PATTERN = /^[a-z][a-z0-9_.:/#-]{0,127}$/;

export const providerCredentialEntrySchema = z
  .strictObject({
    /** Environment variable NAME — the registry never carries the value. */
    envVar: z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/, "env var name must be UPPER_SNAKE"),
    /** Owning provider id (lowercase identifier). */
    provider: z.string().regex(REF_PATTERN, "provider id must be a lowercase identifier"),
    classification: z.enum(CREDENTIAL_CLASSIFICATIONS),
    runtimeScope: z.enum(RUNTIME_SCOPES),
    /** What CoreGrid capability the credential unlocks (human-safe phrase). */
    requiredCapability: z.string().min(1).max(200),
    /**
     * Adapter surface that consumes the credential — a repo-relative module
     * reference, or `null` when no runtime adapter exists (infra/V2-deferred).
     */
    adapterRef: z.string().regex(REF_PATTERN).nullable(),
    /** Whether a health/auth check exists under observability/provider-health. */
    hasHealthCheck: z.boolean(),
    /** Mission status vocabulary. Evidence-backed; never claims without proof. */
    status: z.enum(PROVIDER_STATUSES),
    /** Highest PROVEN verification level (mission §32 ladder). */
    verificationLevel: z.enum(VERIFICATION_LEVELS),
    /** Human-safe note (no secret material, no values). */
    note: z.string().max(400),
  })
  .superRefine((entry, ctx) => {
    if (
      CLIENT_UNSAFE_CLASSIFICATIONS.includes(entry.classification) &&
      entry.runtimeScope === "client"
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${entry.envVar}: classification ${entry.classification} must never carry runtimeScope client`,
      });
    }
    if (entry.classification === "deployment_infrastructure_secret" && entry.adapterRef !== null) {
      ctx.addIssue({
        code: "custom",
        message: `${entry.envVar}: infrastructure secrets must not have an app-runtime adapterRef`,
      });
    }
  });
export type ProviderCredentialEntry = z.infer<typeof providerCredentialEntrySchema>;

/* ─────────────────────────────────────────────────────────────
 * Secret-shape hygiene (defense in depth)
 * ────────────────────────────────────────────────────────────*/

/** Shapes that would indicate real key material leaked into a field. */
const SECRET_VALUE_SHAPES: readonly RegExp[] = [
  /sk_live_[0-9A-Za-z]{10,}/,
  /sk_test_[0-9A-Za-z]{10,}/,
  /sb_secret_[0-9A-Za-z_-]{10,}/,
  /sb_publishable_[0-9A-Za-z_-]{10,}/,
  /re_[0-9A-Za-z]{16,}/,
  /AC[0-9a-f]{16,}/,
  /phx_[0-9A-Za-z_-]{10,}/,
  /ghp_[0-9A-Za-z]{20,}/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
];

export function containsSecretShape(value: string): boolean {
  return SECRET_VALUE_SHAPES.some((shape) => shape.test(value));
}

/* ─────────────────────────────────────────────────────────────
 * The registry — 24 supplied credentials, names only
 * ────────────────────────────────────────────────────────────*/

export const PROVIDER_CREDENTIAL_REGISTRY: readonly ProviderCredentialEntry[] = [
  // ── Supabase (reference implementation, reality data layer) ──
  {
    envVar: "SUPABASE_URL",
    provider: "supabase",
    classification: "public_configuration",
    runtimeScope: "client",
    requiredCapability: "Supabase project endpoint for database/auth/storage access",
    adapterRef: "frontend/src/integrations/supabase/client.ts",
    hasHealthCheck: true,
    status: "OPERATIONAL",
    verificationLevel: "application_path_verified",
    note: "Reference integration: RLS-enforced, publishable key client-side, service role server-only.",
  },
  {
    envVar: "SUPABASE_PUBLISHABLE_KEY",
    provider: "supabase",
    classification: "public_configuration",
    runtimeScope: "client",
    requiredCapability: "Publishable API key for anon-authenticated client access (RLS-governed)",
    adapterRef: "frontend/src/integrations/supabase/client.ts",
    hasHealthCheck: false,
    status: "OPERATIONAL",
    verificationLevel: "application_path_verified",
    note: "RLS is the security boundary; this key grants no elevated access.",
  },
  {
    envVar: "SUPABASE_ANON_KEY",
    provider: "supabase",
    classification: "client_safe_identifier",
    runtimeScope: "client",
    requiredCapability: "Legacy anon-key alias for client access (RLS-governed)",
    adapterRef: null,
    hasHealthCheck: false,
    status: "OPERATIONAL",
    verificationLevel: "application_path_verified",
    note: "Alias of the publishable key; only valid where RLS is enforced.",
  },
  {
    envVar: "SUPABASE_SERVICE_ROLE_KEY",
    provider: "supabase",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "Server-side administrative access (webhook processing, admin flows)",
    adapterRef: "frontend/src/integrations/supabase/client.server.ts",
    hasHealthCheck: false,
    status: "OPERATIONAL",
    verificationLevel: "application_path_verified",
    note: "SERVER-ONLY. Never VITE_-prefixed; guarded by env exposure checks.",
  },
  {
    envVar: "SUPABASE_ACCESS_TOKEN",
    provider: "supabase",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Management-API migrations, database drills, type generation (scripts/)",
    adapterRef: null,
    hasHealthCheck: false,
    status: "OPERATIONAL",
    verificationLevel: "capability_tested",
    note: "Consumed by scripts/ migration + RLS-battery drills; never app runtime.",
  },
  {
    envVar: "SUPABASE_CA_CERT",
    provider: "supabase",
    classification: "server_runtime_configuration",
    runtimeScope: "infrastructure",
    requiredCapability: "TLS trust anchor for direct Postgres verification channels",
    adapterRef: null,
    hasHealthCheck: false,
    status: "OPERATIONAL",
    verificationLevel: "capability_tested",
    note: "Non-secret certificate; consumed by scripts/lib/pg-ssl.mjs.",
  },

  // ── CoreGrid Postgres (direct channel) ──
  {
    envVar: "DATABASE_URL",
    provider: "coregrid-postgres",
    classification: "server_runtime_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Direct Postgres connection for migrations and live verification drills",
    adapterRef: null,
    hasHealthCheck: true,
    status: "OPERATIONAL",
    verificationLevel: "capability_tested",
    note: "Consumed by scripts/db-*.mjs with strict TLS against COREGRID_DB_CA_CERT.",
  },
  {
    envVar: "COREGRID_DB_CA_CERT",
    provider: "coregrid-postgres",
    classification: "server_runtime_configuration",
    runtimeScope: "infrastructure",
    requiredCapability: "Managed Postgres CA (PEM) for strictly-verified TLS",
    adapterRef: null,
    hasHealthCheck: false,
    status: "OPERATIONAL",
    verificationLevel: "capability_tested",
    note: "Verification is never disabled for convenience (scripts/lib/pg-ssl.mjs policy).",
  },

  // ── Email (Resend behind EmailAdapter contract) ──
  {
    envVar: "RESEND_API_KEY",
    provider: "resend",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "Outbound email delivery through the provider-agnostic EmailAdapter",
    adapterRef: "frontend/src/lib/communications/resend-email.server.ts",
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Fail-closed adapter; credential gate before any network contact.",
  },
  {
    envVar: "RESEND_FROM_ADDRESS",
    provider: "resend",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "Verified sender identity for outbound email",
    adapterRef: "frontend/src/lib/communications/resend-email.server.ts",
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Requires the sending domain to be verified in the provider dashboard.",
  },

  // ── Payments (Paystack behind PaymentAdapter contract) ──
  {
    envVar: "PAYSTACK_SECRET_KEY",
    provider: "paystack",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "Payment initialization/verification + webhook signature verification",
    adapterRef: "frontend/src/lib/payments/paystack-adapter.ts",
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Server-side verification is authoritative; the browser never declares success.",
  },

  // ── Voice / telephony (V1-009 communication fabric) ──
  {
    envVar: "VAPI_API_KEY",
    provider: "vapi",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "Voice AI assistant calls (credential-gated STUB in V1 — no live call path)",
    adapterRef: "frontend/src/lib/communications/vapi-voice.server.ts",
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Stub contract: credential gate real, live call path intentionally not implemented.",
  },
  {
    envVar: "TWILIO_ACCOUNT_SID",
    provider: "twilio",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "Twilio account identifier for REST authentication (Basic SID:TOKEN)",
    adapterRef: "frontend/src/lib/communications/twilio-sms.server.ts",
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Identifier paired with TWILIO_AUTH_TOKEN; server-side only.",
  },
  {
    envVar: "TWILIO_AUTH_TOKEN",
    provider: "twilio",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "Twilio REST auth + inbound webhook signature verification",
    adapterRef: "frontend/src/lib/communications/twilio-sms.server.ts",
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "SERVER-ONLY. Signs/verifies webhooks; never logged.",
  },

  // ── Intelligence gateway (provider-neutral, OpenAI-compatible) ──
  {
    envVar: "AI_API_KEY",
    provider: "ai-gateway",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "Governed model invocation through the CoreGrid intelligence gateway",
    adapterRef: "frontend/src/lib/ai-gateway.server.ts",
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Centralized gateway: budget, rate limits, metering, secret-free logs.",
  },
  {
    envVar: "AI_GATEWAY_URL",
    provider: "ai-gateway",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "OpenAI-compatible gateway base URL the router resolves models against",
    adapterRef: "frontend/src/lib/ai-gateway.server.ts",
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Operator-declared endpoint; provider-neutral (§25).",
  },

  // ── V2-DEFERRED vendor integrations (V1CAP-29 — classify only, §45) ──
  {
    envVar: "POSTHOG_PERSONAL_API_KEY",
    provider: "posthog",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "Product analytics management API (V2-DEFERRED vendor integration)",
    adapterRef: null,
    hasHealthCheck: false,
    status: "NOT_REQUIRED",
    verificationLevel: "credential_present",
    note: "V1CAP-29 defers Sentry/PostHog vendors to V2; credential classified, no vendor surface implemented. A personal API key cannot ingest client events (needs a project key), so no client analytics is derivable.",
  },
  {
    envVar: "SENTRY_AUTH_TOKEN",
    provider: "sentry",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Release/source-map upload in CI (V2-DEFERRED vendor integration)",
    adapterRef: null,
    hasHealthCheck: false,
    status: "NOT_REQUIRED",
    verificationLevel: "credential_present",
    note: "V1CAP-29 defers Sentry to V2; a runtime DSN would be required for error reporting (absent).",
  },
  {
    envVar: "NEW_RELIC_ACCOUNT_ID",
    provider: "new-relic",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Infrastructure monitoring account scope identifier",
    adapterRef: null,
    hasHealthCheck: false,
    status: "NOT_REQUIRED",
    verificationLevel: "credential_present",
    note: "Infrastructure observability plane; no app-runtime surface in V1.",
  },
  {
    envVar: "NEW_RELIC_LICENSE_KEY",
    provider: "new-relic",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Infrastructure telemetry ingest credential",
    adapterRef: null,
    hasHealthCheck: false,
    status: "NOT_REQUIRED",
    verificationLevel: "credential_present",
    note: "Infrastructure observability plane; no app-runtime surface in V1.",
  },
  {
    envVar: "NEW_RELIC_USER_KEY",
    provider: "new-relic",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Infrastructure monitoring management API",
    adapterRef: null,
    hasHealthCheck: false,
    status: "NOT_REQUIRED",
    verificationLevel: "credential_present",
    note: "Infrastructure observability plane; no app-runtime surface in V1.",
  },

  // ── Deployment / infrastructure planes ──
  {
    envVar: "CLOUDFLARE_API_TOKEN",
    provider: "cloudflare",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "DNS/CDN/WAF traffic-layer management (IaC scope)",
    adapterRef: null,
    hasHealthCheck: false,
    status: "NOT_REQUIRED",
    verificationLevel: "credential_present",
    note: "Scoped per infrastructure/CREDENTIALS.md; never an app runtime variable.",
  },
  {
    envVar: "VERCEL_API_TOKEN",
    provider: "vercel",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Deployment platform management (CI scope)",
    adapterRef: null,
    hasHealthCheck: false,
    status: "NOT_REQUIRED",
    verificationLevel: "credential_present",
    note: "Deployment plane only; server secrets must be configured in the platform dashboard, not derivable from this token.",
  },
  {
    envVar: "EXPO_TOKEN",
    provider: "expo-eas",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Mobile (EAS) build submission",
    adapterRef: null,
    hasHealthCheck: false,
    status: "NOT_REQUIRED",
    verificationLevel: "credential_present",
    note: "Mobile builds receive only EXPO_PUBLIC_ client-safe config (mobile env contract).",
  },
];

/* ─────────────────────────────────────────────────────────────
 * Registry validation & accessors
 * ────────────────────────────────────────────────────────────*/

export interface RegistryParseResult {
  ok: boolean;
  issues: string[];
}

/**
 * Fail-closed parse of the registry: schema validity, unique env vars, and
 * secret-shape hygiene over every string field. Any issue refuses the whole
 * registry (never half-trusts).
 */
export function validateProviderCredentialRegistry(
  entries: readonly unknown[] = PROVIDER_CREDENTIAL_REGISTRY,
): RegistryParseResult {
  const issues: string[] = [];
  const seenEnvVars = new Set<string>();
  entries.forEach((raw, index) => {
    const parsed = providerCredentialEntrySchema.safeParse(raw);
    if (!parsed.success) {
      issues.push(`entry[${index}]: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      return;
    }
    const entry = parsed.data;
    if (seenEnvVars.has(entry.envVar)) {
      issues.push(`duplicate env var: ${entry.envVar}`);
    }
    seenEnvVars.add(entry.envVar);
    const stringFields = [
      entry.envVar,
      entry.provider,
      entry.requiredCapability,
      entry.note,
      entry.adapterRef ?? "",
    ];
    for (const field of stringFields) {
      if (containsSecretShape(field)) {
        issues.push(`${entry.envVar}: field contains raw secret-shaped material`);
      }
    }
  });
  return { ok: issues.length === 0, issues };
}

/** Entry lookup by environment variable name. */
export function credentialEntryForEnvVar(envVar: string): ProviderCredentialEntry | null {
  return PROVIDER_CREDENTIAL_REGISTRY.find((entry) => entry.envVar === envVar) ?? null;
}

/** All entries for one provider id. */
export function credentialEntriesForProvider(provider: string): readonly ProviderCredentialEntry[] {
  return PROVIDER_CREDENTIAL_REGISTRY.filter((entry) => entry.provider === provider);
}

/**
 * Server-only secret names derived from the registry — a single source
 * consumable by lib/env exposure checks. A credential classified
 * `server_runtime_secret` or `deployment_infrastructure_secret` must never
 * appear under a client-visible prefix (VITE_ / NEXT_PUBLIC_ / PUBLIC_).
 */
export function registryServerOnlyEnvVars(): readonly string[] {
  return PROVIDER_CREDENTIAL_REGISTRY.filter((entry) =>
    CLIENT_UNSAFE_CLASSIFICATIONS.includes(entry.classification),
  ).map((entry) => entry.envVar);
}

/**
 * Client-prefix exposure audit over a raw environment view: returns the
 * names of registry credentials that would leak through a public prefix.
 */
export function registryClientPrefixExposures(
  env: Record<string, string | undefined>,
): readonly string[] {
  const CLIENT_PREFIXES = ["VITE_", "NEXT_PUBLIC_", "PUBLIC_"];
  return registryServerOnlyEnvVars().filter((name) =>
    CLIENT_PREFIXES.some((prefix) => {
      const value = env[`${prefix}${name}`];
      return typeof value === "string" && value.trim() !== "";
    }),
  );
}