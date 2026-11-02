/**
 * Sherivs — provider integration health (auth-level, read-only).
 *
 * The execution plane behind the §18 health vocabulary. Every check is a
 * SINGLE read-only request against the provider's OWN health/list endpoint
 * (never a mutating capability), bounded by a hard timeout, with the
 * credential carried only in the auth header and NEVER in any result,
 * detail, or log line (§30).
 *
 * State vocabulary (mission §18 — fail-closed semantics):
 * - NOT_CONFIGURED   a required credential/config var is absent — no network contact
 * - CONFIGURED       credential present but the provider refused it (401/403)
 * - AUTHENTICATED    the provider accepted the credential on a read-only probe
 * - OPERATIONAL      the provider answered a service-health probe affirmatively
 * - DEGRADED         credential present but the provider was unreachable/timed out
 * - NOT_REQUIRED     no V1 runtime surface exists for this provider (§45)
 *
 * IMPORTANT (§20 honesty law): a credential existing is NOT health. Only a
 * network-verified state (AUTHENTICATED and above) may ever be reported as
 * provider-verified evidence. These checks are SUPPLEMENTARY to the live
 * drills (scripts/verify-*.drill.mjs) — the drills remain the authoritative
 * capability-level evidence.
 *
 * This module never runs inside a request path and never blocks page
 * delivery: it is consumed by verification drills and authorized operator
 * surfaces. Health checks that would make outbound calls from the
 * unauthenticated /health.json endpoint are deliberately excluded from that
 * surface (no third-party contact from a public endpoint).
 */

import { twilioRestAuthFromEnv } from "../communications/twilio-auth.server";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { validateTestModeKey } from "../payments/paystack-testmode.server";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const healthTimeAuthority = new TimeAuthority(new SystemClock());

export const PROVIDER_HEALTH_STATES = [
  "NOT_CONFIGURED",
  "CONFIGURED",
  "AUTHENTICATED",
  "OPERATIONAL",
  "DEGRADED",
  "NOT_REQUIRED",
] as const;
export type ProviderHealthState = (typeof PROVIDER_HEALTH_STATES)[number];

/** Hard bound for every single probe (parity with the drills' handshake budget). */
export const PROVIDER_HEALTH_TIMEOUT_MS = 8_000;

/** Read-only view over the server environment (never a secret carrier). */
export type ServerEnv = Record<string, string | undefined>;

export type FetchLike = typeof fetch;

export interface ProviderHealthReport {
  provider: string;
  state: ProviderHealthState;
  /** Human-safe, secret-free detail (env var NAMES and http status only). */
  detail: string;
  checkedAt: string;
  /** Provider HTTP status when contact was made; null otherwise. */
  httpStatus: number | null;
  durationMs: number;
}

function isNonBlank(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Probes must only ever target https (§25 provider-neutrality, no cleartext). */
function assertHttpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    // A non-URL value in a URL-role env var is a configuration defect.
    return null;
  }
}

interface ProbeOutcome {
  httpStatus: number | null;
  state: ProviderHealthState;
  detail: string;
}

/** One bounded fetch; network failures degrade, never throw past this layer. */
async function probe(
  url: string,
  headers: Record<string, string>,
  fetchImpl: FetchLike,
  init: { method?: "GET" | "POST"; body?: string } = {},
): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
      signal: controller.signal,
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) {
      return {
        httpStatus: response.status,
        state: "CONFIGURED",
        detail: `provider refused the read-only probe (http ${response.status}); credential present but not accepted`,
      };
    }
    if (response.ok) {
      return {
        httpStatus: response.status,
        state: "AUTHENTICATED",
        detail: `provider authenticated the read-only probe (http ${response.status})`,
      };
    }
    return {
      httpStatus: response.status,
      state: "DEGRADED",
      detail: `provider responded with http ${response.status} to the read-only probe`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      httpStatus: null,
      state: "DEGRADED",
      detail: `provider could not be reached for the read-only probe (${reason.slice(0, 120)})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function notConfigured(provider: string, envNames: readonly string[]): ProviderHealthReport {
  return {
    provider,
    state: "NOT_CONFIGURED",
    detail: `BLOCKED_NO_CREDENTIAL: ${envNames.join(", ")} ${envNames.length === 1 ? "is" : "are"} not set; no probe was attempted`,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: null,
    durationMs: 0,
  };
}

function configuredBadTarget(provider: string, envName: string): ProviderHealthReport {
  return {
    provider,
    state: "NOT_CONFIGURED",
    detail: `${envName} is not a valid https:// URL; no probe was attempted`,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: null,
    durationMs: 0,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Per-provider checks (read-only probes only)
 * ────────────────────────────────────────────────────────────*/

/** Supabase auth service health — read-only GET {SUPABASE_URL}/auth/v1/health. */
export async function checkSupabaseHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.SUPABASE_URL) || !isNonBlank(env.SUPABASE_PUBLISHABLE_KEY)) {
    return notConfigured("supabase", ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
  }
  const base = assertHttpsUrl(env.SUPABASE_URL as string);
  if (base === null) return configuredBadTarget("supabase", "SUPABASE_URL");

  const outcome = await probe(
    `${base}/auth/v1/health`,
    { apikey: env.SUPABASE_PUBLISHABLE_KEY as string },
    fetchImpl,
  );
  const state: ProviderHealthState =
    outcome.state === "AUTHENTICATED" ? "OPERATIONAL" : outcome.state;
  return {
    provider: "supabase",
    state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/** Resend — read-only GET /domains with the bearer credential. */
export async function checkResendHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.RESEND_API_KEY)) return notConfigured("resend", ["RESEND_API_KEY"]);

  const outcome = await probe(
    "https://api.resend.com/domains",
    { Authorization: `Bearer ${env.RESEND_API_KEY as string}` },
    fetchImpl,
  );
  return {
    provider: "resend",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/** Paystack — read-only GET /transaction?perPage=1 with the bearer credential. */
export async function checkPaystackHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  const keyCheck = validateTestModeKey(env.PAYSTACK_SECRET_KEY ?? "");
  if (!keyCheck.ok) return notConfigured("paystack", ["PAYSTACK_SECRET_KEY"]);

  const outcome = await probe(
    "https://api.paystack.co/transaction?perPage=1",
    { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY as string}` },
    fetchImpl,
  );
  return {
    provider: "paystack",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/** Twilio — read-only GET /2010-04-01/Accounts/{sid}.json with Basic auth. */
export async function checkTwilioHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  const auth = twilioRestAuthFromEnv(env);
  if (!auth) {
    return notConfigured("twilio", [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_API_KEY+TWILIO_API_SECRET or TWILIO_AUTH_TOKEN",
    ]);
  }

  const accountSid = auth.accountSid;
  const basic = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
  const outcome = await probe(
    // Standard API keys cannot read the Accounts resource itself (401), so the
    // key-pair scheme probes the read-only Balance sub-resource instead.
    auth.scheme === "api_key"
      ? `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Balance.json`
      : `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
    { Authorization: `Basic ${basic}` },
    fetchImpl,
  );
  return {
    provider: "twilio",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/** Vapi — read-only GET /assistant?limit=1 with the bearer credential. */
export async function checkVapiHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.VAPI_API_KEY)) return notConfigured("vapi", ["VAPI_API_KEY"]);

  const outcome = await probe(
    "https://api.vapi.ai/assistant?limit=1",
    { Authorization: `Bearer ${env.VAPI_API_KEY as string}` },
    fetchImpl,
  );
  return {
    provider: "vapi",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/**
 * AI gateway — read-only GET {AI_GATEWAY_URL}/models with the bearer
 * credential. The gateway URL is operator-declared config (§25); the probe
 * is provider-neutral and hard-refuses non-https targets.
 */
export async function checkAiGatewayHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.AI_API_KEY) || !isNonBlank(env.AI_GATEWAY_URL)) {
    return notConfigured("ai-gateway", ["AI_API_KEY", "AI_GATEWAY_URL"]);
  }
  const base = assertHttpsUrl(env.AI_GATEWAY_URL as string);
  if (base === null) return configuredBadTarget("ai-gateway", "AI_GATEWAY_URL");

  const outcome = await probe(
    `${base}/models`,
    { Authorization: `Bearer ${env.AI_API_KEY as string}` },
    fetchImpl,
  );
  return {
    provider: "ai-gateway",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/**
 * PostHog — read-only GET {POSTHOG_API_URL}/api/projects/ with the personal
 * key. The API host is REGION-QUALIFIED: PostHog cloud serves the US region
 * at us.posthog.com (EU at eu.posthog.com); the bare api.posthog.com host is
 * NOT guaranteed to resolve from every network. The personal key cannot
 * ingest client events — that requires a project key (phc_), which remains
 * an operator action.
 */
export async function checkPosthogHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.POSTHOG_PERSONAL_API_KEY))
    return notConfigured("posthog", ["POSTHOG_PERSONAL_API_KEY"]);
  const rawBase = isNonBlank(env.POSTHOG_API_URL) ? env.POSTHOG_API_URL : "https://us.posthog.com";
  const base = assertHttpsUrl(rawBase);
  if (base === null) return configuredBadTarget("posthog", "POSTHOG_API_URL");

  const outcome = await probe(
    `${base}/api/projects/`,
    { Authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY as string}` },
    fetchImpl,
  );
  return {
    provider: "posthog",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/**
 * Sentry — read-only GET https://api.sentry.io/api/0/ (the auth root). The
 * supplied token may be deliberately narrow (e.g. org:ci for release
 * automation): the auth root validates the CREDENTIAL without requiring
 * organization scope, so a valid-but-narrow token authenticates instead of
 * degrading. A runtime DSN (error reporting) remains a separate operator
 * action and is never derivable from this token.
 */
export async function checkSentryHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.SENTRY_AUTH_TOKEN)) return notConfigured("sentry", ["SENTRY_AUTH_TOKEN"]);

  const outcome = await probe(
    "https://api.sentry.io/api/0/",
    { Authorization: `Bearer ${env.SENTRY_AUTH_TOKEN as string}` },
    fetchImpl,
  );
  return {
    provider: "sentry",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/**
 * New Relic — read-only POST graphql actor.user query with the user key.
 * The GraphQL host is REGION-QUALIFIED: the account evidence is EU-region
 * (api.eu.newrelic.com); US accounts must override NEW_RELIC_API_URL.
 */
export async function checkNewRelicHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.NEW_RELIC_USER_KEY))
    return notConfigured("new-relic", ["NEW_RELIC_USER_KEY"]);
  const rawBase = isNonBlank(env.NEW_RELIC_API_URL)
    ? env.NEW_RELIC_API_URL
    : "https://api.eu.newrelic.com";
  const base = assertHttpsUrl(rawBase);
  if (base === null) return configuredBadTarget("new-relic", "NEW_RELIC_API_URL");

  const outcome = await probe(
    `${base}/graphql`,
    { "Api-Key": env.NEW_RELIC_USER_KEY as string, "Content-Type": "application/json" },
    fetchImpl,
    { method: "POST", body: JSON.stringify({ query: "{ actor { user { email } } }" }) },
  );
  return {
    provider: "new-relic",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/** Cloudflare — read-only GET /client/v4/user/tokens/verify (token self-check). */
export async function checkCloudflareHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.CLOUDFLARE_API_TOKEN))
    return notConfigured("cloudflare", ["CLOUDFLARE_API_TOKEN"]);

  const outcome = await probe(
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
    { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN as string}` },
    fetchImpl,
  );
  return {
    provider: "cloudflare",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/** Vercel — read-only GET /v9/projects with the (team-scoped) bearer token. */
export async function checkVercelHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.VERCEL_API_TOKEN)) return notConfigured("vercel", ["VERCEL_API_TOKEN"]);

  const outcome = await probe(
    "https://api.vercel.com/v9/projects",
    { Authorization: `Bearer ${env.VERCEL_API_TOKEN as string}` },
    fetchImpl,
  );
  return {
    provider: "vercel",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/** Expo EAS — read-only POST graphql viewer query with the bearer token. */
export async function checkExpoHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.EXPO_TOKEN)) return notConfigured("expo-eas", ["EXPO_TOKEN"]);

  const outcome = await probe(
    "https://api.expo.dev/graphql",
    { Authorization: `Bearer ${env.EXPO_TOKEN as string}`, "Content-Type": "application/json" },
    fetchImpl,
    { method: "POST", body: JSON.stringify({ query: "{ viewer { username } }" }) },
  );
  return {
    provider: "expo-eas",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/**
 * Redis (Upstash-compatible REST) — optional distributed rate-limit plane.
 * When no credential is supplied the report is NOT_REQUIRED (the V1 default
 * is the in-process limiter, Part 31) and the posture stays ok: an absent
 * OPTIONAL capability must never fail the battery. When supplied, a single
 * read-only PING verifies the credential.
 */
export async function checkRedisHealth(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.REDIS_REST_URL) || !isNonBlank(env.REDIS_REST_TOKEN)) {
    return {
      provider: "redis",
      state: "NOT_REQUIRED",
      detail:
        "no REDIS_REST_URL/REDIS_REST_TOKEN supplied — the in-process rate limiter remains active (Part 31); distributed limiting stays disabled",
      checkedAt: healthTimeAuthority.now().at,
      httpStatus: null,
      durationMs: 0,
    };
  }
  const base = assertHttpsUrl(env.REDIS_REST_URL as string);
  if (base === null) return configuredBadTarget("redis", "REDIS_REST_URL");

  const outcome = await probe(
    base,
    {
      Authorization: `Bearer ${env.REDIS_REST_TOKEN as string}`,
      "Content-Type": "application/json",
    },
    fetchImpl,
    { method: "POST", body: JSON.stringify(["PING"]) },
  );
  return {
    provider: "redis",
    state: outcome.state,
    detail: outcome.detail,
    checkedAt: healthTimeAuthority.now().at,
    httpStatus: outcome.httpStatus,
    durationMs: healthTimeAuthority.now().atMs - startedAt,
  };
}

/**
 * Providers with NO runtime surface at all. After DECISIONS.md #204 every
 * supplied vendor credential has a verification probe, so this set is
 * intentionally empty; it remains as the declared-none escape hatch for any
 * future capability that must never be probed.
 */
export function staticNotRequiredProviders(): readonly ProviderHealthReport[] {
  return [];
}

/** The complete §18 integration-health battery (read-only probes + statics). */
export async function runProviderHealthBattery(
  env: ServerEnv,
  fetchImpl: FetchLike = fetch,
): Promise<readonly ProviderHealthReport[]> {
  const [
    supabase,
    resend,
    paystack,
    twilio,
    vapi,
    aiGateway,
    posthog,
    sentry,
    newRelic,
    cloudflare,
    vercel,
    expo,
    redis,
  ] = await Promise.all([
    checkSupabaseHealth(env, fetchImpl),
    checkResendHealth(env, fetchImpl),
    checkPaystackHealth(env, fetchImpl),
    checkTwilioHealth(env, fetchImpl),
    checkVapiHealth(env, fetchImpl),
    checkAiGatewayHealth(env, fetchImpl),
    checkPosthogHealth(env, fetchImpl),
    checkSentryHealth(env, fetchImpl),
    checkNewRelicHealth(env, fetchImpl),
    checkCloudflareHealth(env, fetchImpl),
    checkVercelHealth(env, fetchImpl),
    checkExpoHealth(env, fetchImpl),
    checkRedisHealth(env, fetchImpl),
  ]);
  return [
    supabase,
    resend,
    paystack,
    twilio,
    vapi,
    aiGateway,
    posthog,
    sentry,
    newRelic,
    cloudflare,
    vercel,
    expo,
    redis,
    ...staticNotRequiredProviders(),
  ];
}

/** Overall battery posture: failing iff any probed provider is NOT_CONFIGURED/DEGRADED... */
export interface ProviderHealthBatteryPosture {
  /** "ok" when every probe is AUTHENTICATED/OPERATIONAL; "degraded" when CONFIGURED probes exist among configured providers; "failing" on NOT_CONFIGURED probes for providers with declared V1 capability. */
  status: "ok" | "degraded" | "failing";
}

export function evaluateProviderHealthPosture(
  reports: readonly ProviderHealthReport[],
): ProviderHealthBatteryPosture {
  const statuses = reports.map((report) => {
    switch (report.state) {
      case "OPERATIONAL":
      case "AUTHENTICATED":
      case "NOT_REQUIRED":
        return "ok" as const;
      case "CONFIGURED":
        return "degraded" as const;
      case "DEGRADED":
      case "NOT_CONFIGURED":
        return "failing" as const;
    }
  });
  if (statuses.includes("failing")) return { status: "failing" };
  if (statuses.includes("degraded")) return { status: "degraded" };
  return { status: "ok" };
}
