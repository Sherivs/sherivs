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
 * The PostHog/Sentry/New Relic/Cloudflare/Vercel/Expo-EAS/Redis vendor planes
 * were UN-FROZEN for V1 by the explicit operator authorization record
 * DECISIONS.md #204 (PLATFORM-013, 2026-10-06): each supplied credential is
 * verified through a single read-only health probe; no analytics ingestion
 * surface may be built without satisfying §19/§20/§21 first.
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
 * The registry — supplied credentials + evidence-derived config entries
 * (region API hosts, Redis REST plane, VAPID pair, PostHog project key),
 * names only
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
    status: "OPERATIONAL",
    verificationLevel: "capability_tested",
    note: "LIVE-PROVEN 2026-10-06: read-only auth probe 200 + one governed self-addressed send through the adapter returned a provider receipt (artifact resend-capability-probe.json).",
  },
  {
    envVar: "RESEND_FROM_ADDRESS",
    provider: "resend",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "Verified sender identity for outbound email",
    adapterRef: "frontend/src/lib/communications/resend-email.server.ts",
    hasHealthCheck: true,
    status: "OPERATIONAL",
    verificationLevel: "capability_tested",
    note: "Sending domain verified (read-only GET /domains); the governed probe send was accepted from this identity.",
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
    status: "OPERATIONAL",
    verificationLevel: "capability_tested",
    note: "TEST RAILS ONLY (sk_test_): read-only auth probe 200 + governed drill round (audit, initialize, owned-verify, denied mismatch) PASSED 2026-10-06; live rails parked pending operator business verification (BLK-4).",
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
    verificationLevel: "provider_reachable",
    note: "Auth live-verified 2026-10-06 (read-only probe 200). The adapter remains a deliberate credential-gated stub in V1 — no live call path implemented, none fabricated.",
  },
  {
    envVar: "TWILIO_ACCOUNT_SID",
    provider: "twilio",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "Twilio account identifier for REST authentication (Basic SID:TOKEN)",
    adapterRef: "frontend/src/lib/communications/twilio-sms.server.ts",
    hasHealthCheck: true,
    status: "BLOCKED",
    verificationLevel: "provider_reachable",
    note: "Auth live-verified 2026-10-06 (read-only probe 200). SMS/voice SEND capability BLOCKED on sender-number provisioning: the API purchase attempt was refused with Twilio error 21404 (trial accounts must first verify a phone number — operator console action).",
  },
  {
    envVar: "TWILIO_AUTH_TOKEN",
    provider: "twilio",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "Twilio REST auth + inbound webhook signature verification",
    adapterRef: "frontend/src/lib/communications/twilio-sms.server.ts",
    hasHealthCheck: true,
    status: "BLOCKED",
    verificationLevel: "provider_reachable",
    note: "SERVER-ONLY. Auth live-verified 2026-10-06. Webhook signature validator implemented; an inbound webhook route activates only once a sender number + console webhook config exist (sender-number purchase currently blocked by Twilio error 21404 — trial verification).",
  },

  {
    envVar: "TWILIO_FROM_NUMBER",
    provider: "twilio",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "E.164 sender identity for outbound SMS/voice via the Twilio adapter",
    adapterRef: "frontend/src/lib/communications/twilio-sms.server.ts",
    hasHealthCheck: false,
    status: "BLOCKED",
    verificationLevel: "none",
    note: "Purchase attempted via the Twilio REST API 2026-10-06 — refused with error 21404: 'Trial accounts must verify a phone number before purchasing a Twilio number.' Operator must verify their own phone number in the Twilio console (or upgrade the account), then re-run scripts/provision-vercel-env.mjs with TWILIO_FROM_NUMBER set.",
  },

  // ── Web push (VAPID pair generated locally 2026-10-06) ──
  {
    envVar: "VAPID_PUBLIC_KEY",
    provider: "web-push",
    classification: "public_configuration",
    runtimeScope: "server",
    requiredCapability: "VAPID application-server key for authenticated web push delivery",
    adapterRef: "frontend/src/lib/push.server.ts",
    hasHealthCheck: false,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Generated locally (uncompressed P-256 point, base64url) 2026-10-06; provisioned to Vercel + mirrored as VITE_VAPID_PUBLIC_KEY. Delivery activates once browser subscriptions exist.",
  },
  {
    envVar: "VAPID_PRIVATE_KEY",
    provider: "web-push",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "VAPID signing scalar for ES256 push JWTs",
    adapterRef: "frontend/src/lib/push.server.ts",
    hasHealthCheck: false,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "SERVER-ONLY. Raw 32-byte scalar, base64url. Guarded by env exposure checks.",
  },
  {
    envVar: "VITE_VAPID_PUBLIC_KEY",
    provider: "web-push",
    classification: "public_configuration",
    runtimeScope: "client",
    requiredCapability: "Build-time mirror of the VAPID public key for the service-worker client",
    adapterRef: "frontend/src/lib/push-client.ts",
    hasHealthCheck: false,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Mirrored from VAPID_PUBLIC_KEY at provisioning; public by design (an application-server key is not a secret).",
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
    status: "OPERATIONAL",
    verificationLevel: "capability_tested",
    note: "LIVE-PROVEN 2026-10-06: read-only /models probe 200 + one governed inference through the gateway path (STATUS=DRILL_PASS, single attempt, digest-only output).",
  },
  {
    envVar: "AI_GATEWAY_URL",
    provider: "ai-gateway",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "OpenAI-compatible gateway base URL the router resolves models against",
    adapterRef: "frontend/src/lib/ai-gateway.server.ts",
    hasHealthCheck: true,
    status: "OPERATIONAL",
    verificationLevel: "capability_tested",
    note: "Operator-declared endpoint (§25); live-verified with the credential on a read-only probe and the governed inference drill.",
  },

  // ── Observability vendor planes (UN-FROZEN by DECISIONS.md #204) ──
  {
    envVar: "POSTHOG_PERSONAL_API_KEY",
    provider: "posthog",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "PostHog management-API verification (personal key; cannot ingest client events)",
    adapterRef: null,
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "provider_reachable",
    note: "Auth live-verified 2026-10-06 (GET us.posthog.com/api/projects/ 200, project 532234). api.posthog.com is unreachable from the build VM; the region host is authoritative. Client analytics ingestion still requires a project API key (phc_) — operator action.",
  },
  {
    envVar: "POSTHOG_API_URL",
    provider: "posthog",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "Region-qualified PostHog API base URL for the health probe",
    adapterRef: null,
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "provider_reachable",
    note: "Defaults to https://us.posthog.com (evidence-backed 2026-10-06); EU projects must override to https://eu.posthog.com.",
  },
  {
    envVar: "POSTHOG_PROJECT_API_KEY",
    provider: "posthog",
    classification: "client_safe_identifier",
    runtimeScope: "client",
    requiredCapability: "PostHog client-side event ingestion (project API key)",
    adapterRef: null,
    hasHealthCheck: false,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "capability_tested",
    note: "Grabbed autonomously via the management API and ingest-verified with ONE synthetic event (http 200, distinct_id control-plane/creds-wave-5) 2026-10-06. Safe in the browser bundle by design (ingest key, not a secret). NO analytics surface may ship until the §19/§20/§21 pipeline (authorization -> classification -> minimization -> redaction) is implemented and tested.",
  },
  {
    envVar: "SENTRY_AUTH_TOKEN",
    provider: "sentry",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Sentry API token verification (CI scope)",
    adapterRef: null,
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "provider_reachable",
    note: "Token live-verified 2026-10-06 (GET api.sentry.io/api/0/ 200) but scope-limited to org:ci — it cannot read organizations. A runtime DSN is still absent (operator action); release upload needs project + org slugs.",
  },
  {
    envVar: "NEW_RELIC_ACCOUNT_ID",
    provider: "new-relic",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Infrastructure monitoring account scope identifier",
    adapterRef: null,
    hasHealthCheck: false,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "EU-region account confirmed via the user-key probe (api.eu.newrelic.com) 2026-10-06.",
  },
  {
    envVar: "NEW_RELIC_LICENSE_KEY",
    provider: "new-relic",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Infrastructure telemetry ingest credential",
    adapterRef: null,
    hasHealthCheck: false,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "credential_present",
    note: "Ingest-plane credential; consumed by infrastructure agents, not the app runtime.",
  },
  {
    envVar: "NEW_RELIC_USER_KEY",
    provider: "new-relic",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Infrastructure monitoring management API (GraphQL actor probe)",
    adapterRef: null,
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "provider_reachable",
    note: "Auth live-verified 2026-10-06 (POST api.eu.newrelic.com/graphql actor.user.email 200).",
  },
  {
    envVar: "NEW_RELIC_API_URL",
    provider: "new-relic",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "Region-qualified New Relic GraphQL base URL for the health probe",
    adapterRef: null,
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "provider_reachable",
    note: "Defaults to https://api.eu.newrelic.com (evidence-backed 2026-10-06); US accounts must override to https://api.newrelic.com.",
  },

  // ── Deployment / infrastructure planes (UN-FROZEN by DECISIONS.md #204) ──
  {
    envVar: "CLOUDFLARE_API_TOKEN",
    provider: "cloudflare",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "DNS/CDN/WAF traffic-layer management (IaC scope)",
    adapterRef: null,
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "provider_reachable",
    note: "Token live-verified 2026-10-06 (GET /client/v4/user/tokens/verify 200, active). IaC scope only; never an app runtime variable.",
  },
  {
    envVar: "VERCEL_API_TOKEN",
    provider: "vercel",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Deployment platform management + environment provisioning (CI scope)",
    adapterRef: null,
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "provider_reachable",
    note: "Token live-verified 2026-10-06 (GET /v9/projects 200, team-scoped). Project coregrid-scholar-migration exists; app runtime env provisioned via scripts/provision-vercel-env.mjs.",
  },
  {
    envVar: "EXPO_TOKEN",
    provider: "expo-eas",
    classification: "deployment_infrastructure_secret",
    runtimeScope: "infrastructure",
    requiredCapability: "Mobile (EAS) build submission",
    adapterRef: null,
    hasHealthCheck: true,
    status: "CONFIGURED_BUT_UNVERIFIED",
    verificationLevel: "provider_reachable",
    note: "Token live-verified 2026-10-06 (POST api.expo.dev/graphql viewer 200, user vibeoraai-bit). Mobile builds receive only EXPO_PUBLIC_ client-safe config.",
  },

  // ── Optional distributed rate-limit plane (Upstash-compatible REST) ──
  {
    envVar: "REDIS_REST_URL",
    provider: "redis",
    classification: "server_runtime_configuration",
    runtimeScope: "server",
    requiredCapability: "Distributed fixed-window rate limiting behind the RateLimiter contract (optional)",
    adapterRef: "frontend/src/lib/rate-limit/redis-rate-limiter.server.ts",
    hasHealthCheck: true,
    status: "NOT_CONFIGURED",
    verificationLevel: "none",
    note: "No credential supplied: the adapter falls back to the in-process limiter (Part 31). Provide REDIS_REST_URL + REDIS_REST_TOKEN (Upstash REST) to enable multi-instance limiting.",
  },
  {
    envVar: "REDIS_REST_TOKEN",
    provider: "redis",
    classification: "server_runtime_secret",
    runtimeScope: "server",
    requiredCapability: "Bearer credential for the Upstash-compatible REST data plane",
    adapterRef: "frontend/src/lib/rate-limit/redis-rate-limiter.server.ts",
    hasHealthCheck: true,
    status: "NOT_CONFIGURED",
    verificationLevel: "none",
    note: "SERVER-ONLY when supplied. Absent today — no distributed limiter is active.",
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