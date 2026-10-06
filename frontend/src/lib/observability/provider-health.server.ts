/**
 * CoreGrid — provider integration health (auth-level, read-only).
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

import { SystemClock, TimeAuthority } from "../kernel/time-authority";

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
): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
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
export async function checkSupabaseHealth(env: ServerEnv, fetchImpl: FetchLike = fetch): Promise<ProviderHealthReport> {
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
export async function checkResendHealth(env: ServerEnv, fetchImpl: FetchLike = fetch): Promise<ProviderHealthReport> {
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
export async function checkPaystackHealth(env: ServerEnv, fetchImpl: FetchLike = fetch): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.PAYSTACK_SECRET_KEY)) return notConfigured("paystack", ["PAYSTACK_SECRET_KEY"]);

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
export async function checkTwilioHealth(env: ServerEnv, fetchImpl: FetchLike = fetch): Promise<ProviderHealthReport> {
  const startedAt = healthTimeAuthority.now().atMs;
  if (!isNonBlank(env.TWILIO_ACCOUNT_SID) || !isNonBlank(env.TWILIO_AUTH_TOKEN)) {
    return notConfigured("twilio", ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]);
  }

  const accountSid = env.TWILIO_ACCOUNT_SID as string;
  const basic = Buffer.from(`${accountSid}:${env.TWILIO_AUTH_TOKEN as string}`).toString("base64");
  const outcome = await probe(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
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
export async function checkVapiHealth(env: ServerEnv, fetchImpl: FetchLike = fetch): Promise<ProviderHealthReport> {
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
export async function checkAiGatewayHealth(env: ServerEnv, fetchImpl: FetchLike = fetch): Promise<ProviderHealthReport> {
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
 * Providers with no V1 runtime surface (V2-deferred vendors per V1CAP-29,
 * infrastructure planes, unprovisioned capabilities). Declared statically —
 * never probed, never claimed operational.
 */
export function staticNotRequiredProviders(): readonly ProviderHealthReport[] {
  const at = healthTimeAuthority.now().at;
  const entries: readonly [string, string][] = [
    ["posthog", "V2-DEFERRED vendor integration (V1CAP-29); no runtime surface in V1"],
    ["sentry", "V2-DEFERRED vendor integration (V1CAP-29); no runtime DSN provisioned"],
    ["new-relic", "infrastructure observability plane; no app-runtime surface in V1"],
    ["cloudflare", "IaC traffic-layer plane (infrastructure/CREDENTIALS.md); no app-runtime surface"],
    ["vercel", "deployment platform plane; no app-runtime surface in V1"],
    ["expo-eas", "mobile build plane; mobile receives client-safe EXPO_PUBLIC_ config only"],
    ["redis", "no Redis credential supplied and no V1 capability requires one (in-process rate limiting per Part 31)"],
  ];
  return entries.map(([provider, detail]) => ({
    provider,
    state: "NOT_REQUIRED" as const,
    detail,
    checkedAt: at,
    httpStatus: null,
    durationMs: 0,
  }));
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
  ] = await Promise.all([
    checkSupabaseHealth(env, fetchImpl),
    checkResendHealth(env, fetchImpl),
    checkPaystackHealth(env, fetchImpl),
    checkTwilioHealth(env, fetchImpl),
    checkVapiHealth(env, fetchImpl),
    checkAiGatewayHealth(env, fetchImpl),
  ]);
  return [supabase, resend, paystack, twilio, vapi, aiGateway, ...staticNotRequiredProviders()];
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