/**
 * R2 (QA-SIGNUP) — rate-limit-aware self-serve signup harness for T2 of the
 * F-13 vertical slice (progress/v1-wave/F-13-report.md).
 *
 * Background: the canonical Supabase project enforces an anonymous-signup
 * email-send rate limit (`429 over_email_send_rate_limit`) whose window did
 * not clear over ~2h of probing. T2 therefore skips with a typed reason when
 * rate-limited — that honesty is preserved. This module makes the attempt
 * rate-limit-AWARE instead of rate-limit-blind:
 *
 *   1. PROBE — before the first real attempt, a cheap availability probe is
 *      sent to the REAL auth surface (`POST /auth/v1/recover` with a
 *      run-unique address that belongs to no account: GoTrue answers without
 *      sending email and without creating rows when the address is unknown,
 *      but the request still traverses the auth rate limiter). A 429 proves
 *      the email-send window is closed and may yield a Retry-After hint; any
 *      other response is recorded as "open"/"unknown". The probe is HEURISTIC
 *      and advisory only — the authoritative classification always comes from
 *      the real signup attempt itself, which is made regardless of the probe
 *      result (a "closed" probe only seeds the first backoff wait).
 *
 *   2. RETRY — when a real attempt is rate-limited, the signup is retried
 *      with bounded exponential backoff, fresh run-unique credentials per
 *      attempt, honoring a Retry-After hint when present. Total ADDED waiting
 *      time is capped (90s by default) and the Playwright test timeout is
 *      raised once, up front, to cover the worst-case budget, so backoff
 *      waits can never manifest as a Playwright timeout.
 *
 *   3. CLASSIFY — every rendered outcome is classified CREATED /
 *      RATE_LIMITED / EMAIL_COLLISION / OTHER with the backend message
 *      captured verbatim so the typed skip text in T2 stays honest.
 *
 * Honesty law (§42): nothing here fakes, weakens, or bypasses anything. A
 * skip after exhausted retries is still a typed skip carrying the verbatim
 * backend message; a CREATED outcome still faces T2's full real contract
 * assertion. If the outcome panel never renders at all, the caller's
 * `outcomeText` rejects and the test FAILS — a UI regression is a failure
 * signal, never a skip.
 *
 * Secrets: emails/passwords are run-generated, held in process memory, and
 * never printed; no env var value is ever logged.
 */
import { test, type Page } from "@playwright/test";

export type SignupOutcomeClassification = "CREATED" | "RATE_LIMITED" | "EMAIL_COLLISION" | "OTHER";

export interface RateLimitProbe {
  /** "closed" is proven (429 from the real limiter); open/unknown are weak signals. */
  window: "open" | "closed" | "unknown";
  /** Verbatim backend response excerpt (bounded length). */
  detail: string;
  retryAfterMs: number | null;
}

export interface SignupResilienceOptions {
  supabaseUrl: string;
  publishableKey: string;
  /** Run-unique address for the availability probe (belongs to no account). */
  probeEmail: string;
  /** Credentials for the FIRST real attempt. */
  email: string;
  password: string;
  /** Credential factories for backoff retries (fresh per attempt — no collision reuse). */
  makeEmail: (label: string) => string;
  makePassword: () => string;
  /** Drives the REAL signup journey for one attempt (page navigation included). */
  attempt: (page: Page, email: string, password: string) => Promise<void>;
  /** Reads the rendered outcome text; MUST reject if no outcome ever renders. */
  outcomeText: (page: Page) => Promise<string>;
  /** The real success contract text (e.g. T2's exact full-contract sentence). */
  contractPattern: RegExp;
  rateLimitPattern?: RegExp;
  collisionPattern?: RegExp;
  /** Cap on total ADDED backoff waiting time (default 90s). */
  maxAddedWaitMs?: number;
}

export interface SignupResilienceResult {
  classification: SignupOutcomeClassification;
  /** Verbatim rendered backend message (bounded to keep skip texts sane). */
  backendMessage: string;
  attempts: number;
  waitedMs: number;
  probe: RateLimitProbe;
  /** Credentials of the FINAL attempt (the CREATED one when classification is CREATED). */
  finalEmail: string;
  finalPassword: string;
}

const DEFAULT_MAX_ADDED_WAIT_MS = 90_000;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRIES = 4;
/** Worst-case wall-clock assumed per real attempt when sizing the test timeout. */
const ATTEMPT_BUDGET_MS = 25_000;
const PROBE_BUDGET_MS = 10_000;
const MESSAGE_CAP = 240;

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asSeconds = Number(headerValue);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return Math.round(asSeconds * 1000);
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

/** Cheap, side-effect-free availability probe against the REAL auth limiter. */
export async function probeRateLimitWindow(
  supabaseUrl: string,
  publishableKey: string,
  probeEmail: string,
): Promise<RateLimitProbe> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: probeEmail }),
      signal: AbortSignal.timeout(PROBE_BUDGET_MS - 2_000),
    });
    const text = (await res.text()).slice(0, MESSAGE_CAP);
    if (res.status === 429 || /over_email_send_rate_limit|rate limit/i.test(text)) {
      return {
        window: "closed",
        detail: text,
        retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
      };
    }
    return { window: "open", detail: `HTTP ${res.status}`, retryAfterMs: null };
  } catch (e) {
    return {
      window: "unknown",
      detail: (e instanceof Error ? e.message : String(e)).slice(0, MESSAGE_CAP),
      retryAfterMs: null,
    };
  }
}

/**
 * Attempts the real signup journey with a pre-attempt availability probe and
 * bounded exponential backoff retries on RATE_LIMITED. Only RATE_LIMITED is
 * retried; EMAIL_COLLISION and OTHER return immediately (they are not
 * transient backend pressure and retrying could mask a real signal).
 */
export async function attemptSignupWithRateLimitResilience(
  page: Page,
  options: SignupResilienceOptions,
): Promise<SignupResilienceResult> {
  const rateLimitPattern = options.rateLimitPattern ?? /rate limit/i;
  const collisionPattern = options.collisionPattern ?? /already/i;
  const maxAddedWaitMs = options.maxAddedWaitMs ?? DEFAULT_MAX_ADDED_WAIT_MS;

  // Raise the current test's timeout ONCE to the worst-case budget (probe +
  // attempt work + capped backoff waits). A ceiling raise only covers the
  // retry budget — the added wall-clock time itself stays capped at 90s.
  const currentTimeout = test.info().timeout;
  test.setTimeout(
    Math.max(currentTimeout, maxAddedWaitMs + MAX_RETRIES * ATTEMPT_BUDGET_MS + PROBE_BUDGET_MS),
  );

  const probe = await probeRateLimitWindow(
    options.supabaseUrl,
    options.publishableKey,
    options.probeEmail,
  );
  if (probe.window === "closed") {
    console.log(
      `signup-resilience: probe says the email-send window is closed (advisory only; retryAfterMs=${probe.retryAfterMs})`,
    );
  }

  let email = options.email;
  let password = options.password;
  let waitedMs = 0;
  let attempts = 0;
  let retryAfterMs = probe.window === "closed" ? probe.retryAfterMs : null;

  for (;;) {
    attempts += 1;
    await options.attempt(page, email, password);
    const text = await options.outcomeText(page);
    const backendMessage = text.trim().slice(0, MESSAGE_CAP);

    if (options.contractPattern.test(text)) {
      return {
        classification: "CREATED",
        backendMessage,
        attempts,
        waitedMs,
        probe,
        finalEmail: email,
        finalPassword: password,
      };
    }
    if (!rateLimitPattern.test(text)) {
      return {
        classification: collisionPattern.test(text) ? "EMAIL_COLLISION" : "OTHER",
        backendMessage,
        attempts,
        waitedMs,
        probe,
        finalEmail: email,
        finalPassword: password,
      };
    }

    // RATE_LIMITED — stop when the retry budget is spent, else back off.
    if (attempts >= MAX_RETRIES + 1) {
      return {
        classification: "RATE_LIMITED",
        backendMessage,
        attempts,
        waitedMs,
        probe,
        finalEmail: email,
        finalPassword: password,
      };
    }
    const exponential = BASE_BACKOFF_MS * 2 ** (attempts - 1);
    const desired = Math.min(
      Math.max(retryAfterMs ?? exponential, BASE_BACKOFF_MS),
      MAX_BACKOFF_MS,
    );
    const remaining = maxAddedWaitMs - waitedMs;
    const wait = Math.min(desired, remaining);
    if (wait < BASE_BACKOFF_MS) {
      return {
        classification: "RATE_LIMITED",
        backendMessage,
        attempts,
        waitedMs,
        probe,
        finalEmail: email,
        finalPassword: password,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    waitedMs += wait;
    retryAfterMs = null;
    email = options.makeEmail(`visitor-r${attempts}`);
    password = options.makePassword();
  }
}
