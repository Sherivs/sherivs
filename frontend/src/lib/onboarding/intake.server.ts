/**
 * M5 part B (ADR-108): server side of the public onboarding intake. Server-only.
 *
 * Order for every public call: rate limit by address -> zod validation -> honeypot -> captcha
 * (submit only) -> service-role database function. Responses carry a resume token once (on
 * submit) and a session view; never the token hash, a request id, the stored contact data, or
 * whether an email address is already known. Log lines carry an event name and a reason code
 * only: no token, no hash, no address, no form values.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { captchaRequired } from "@/components/security/turnstile";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import type { PublicRateLimitResult } from "@/lib/security/public-rate-limit.server";
import {
  INTAKE_CONSENT_VERSION,
  INTAKE_PENDING_GRAPH_VERSION,
  IntakeCompleteSchema,
  IntakeLoadSchema,
  IntakeRequestSchema,
  IntakeSaveSchema,
  invalidFields,
  type IntakeFailure,
  type IntakeFailureCode,
  type IntakeJson,
  type IntakeLoadResult,
  type IntakeSaveResult,
  type IntakeSessionView,
  type IntakeSubmitResult,
} from "./intake";

export const INTAKE_RATE_LIMITS = {
  submit: { bucket: "onboarding-intake-submit", maxRequests: 5, windowMs: 10 * 60_000 },
  session: { bucket: "onboarding-intake-session", maxRequests: 30, windowMs: 60_000 },
} as const;

const SESSION_DAYS = 30;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type IntakeRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string } | null }>;

export type IntakeLogDetail = Record<string, string | number | boolean>;

export type IntakeDeps = {
  rpc: IntakeRpc;
  rateLimit: (
    bucket: string,
    key: string,
    config: { maxRequests: number; windowMs: number },
  ) => Promise<PublicRateLimitResult>;
  /** True when the server holds a Turnstile secret, so a token is required and verified. */
  captchaEnabled: boolean;
  verifyCaptcha: (token: string, ip: string) => Promise<boolean>;
  log: (event: string, detail: IntakeLogDetail) => void;
  nowMs?: () => number;
  randomToken?: () => string;
};

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/** 32 bytes from the platform CSPRNG, base64url (43 characters). Shown to the visitor once. */
export function generateResumeToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha-256 of the token as lowercase hex. Only this value is stored. */
export function hashResumeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two sha-256 hex digests. */
export function sameTokenHash(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

// ---------------------------------------------------------------------------
// Turnstile (Cloudflare, free tier)
// ---------------------------------------------------------------------------

/** Server-side Turnstile check. Fails closed on any network or response error. */
export async function verifyTurnstileToken(
  token: string,
  ip: string,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown };
    return result.success === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handlers (dependency-injected so they are unit-testable without a database)
// ---------------------------------------------------------------------------

const fail = (code: IntakeFailureCode, extra: Partial<IntakeFailure> = {}): IntakeFailure => ({
  ok: false,
  code,
  ...extra,
});

function dbFailure(error: { code?: string }): IntakeFailure {
  if (error.code === "PT404") return fail("not_found");
  if (error.code === "PT409") return fail("stale");
  return fail("unavailable");
}

function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}

function defaultNow(): number {
  return new TimeAuthority(new SystemClock()).now().atMs;
}

async function limited(
  deps: IntakeDeps,
  kind: keyof typeof INTAKE_RATE_LIMITS,
  ip: string,
): Promise<IntakeFailure | null> {
  const { bucket, maxRequests, windowMs } = INTAKE_RATE_LIMITS[kind];
  const decision = await deps.rateLimit(bucket, `ip:${ip}`, { maxRequests, windowMs });
  if (decision.allowed) return null;
  deps.log("onboarding.intake.rate_limited", { kind });
  return fail("rate_limited", { retryAfterSeconds: decision.retryAfterSeconds });
}

export async function submitIntake(
  input: unknown,
  ip: string,
  deps: IntakeDeps,
): Promise<IntakeSubmitResult> {
  const blocked = await limited(deps, "submit", ip);
  if (blocked) return blocked;

  const parsed = IntakeRequestSchema.safeParse(input);
  if (!parsed.success) {
    deps.log("onboarding.intake.invalid", { fields: invalidFields(parsed.error).length });
    return fail("invalid", { fields: invalidFields(parsed.error) });
  }
  const data = parsed.data;
  const token = (deps.randomToken ?? generateResumeToken)();
  const nowMs = (deps.nowMs ?? defaultNow)();

  if (data.website && data.website.trim() !== "") {
    // Automated submission. Answer exactly like a success so the sender learns nothing;
    // store nothing. The token is never saved, so it resumes nothing.
    deps.log("onboarding.intake.honeypot", { source: data.source });
    return {
      ok: true,
      resumeToken: token,
      session: {
        graphVersion: INTAKE_PENDING_GRAPH_VERSION,
        revision: 0,
        completionPct: 0,
        completed: false,
        expiresAt: new Date(nowMs + SESSION_DAYS * 86_400_000).toISOString(),
      },
    };
  }

  if (captchaRequired(deps.captchaEnabled, data.captchaToken ?? null, false)) {
    deps.log("onboarding.intake.captcha_missing", { source: data.source });
    return fail("captcha_required");
  }
  if (deps.captchaEnabled && data.captchaToken) {
    const human = await deps.verifyCaptcha(data.captchaToken, ip);
    if (!human) {
      deps.log("onboarding.intake.captcha_rejected", { source: data.source });
      return fail("captcha_required");
    }
  }

  const { data: rows, error } = await deps.rpc("onboarding_intake_create", {
    p_org_name: data.orgName,
    p_institution_type: data.institutionType,
    p_state: data.state ?? null,
    p_lga: data.lga ?? null,
    p_contact_name: data.contactName,
    p_contact_email: data.contactEmail,
    p_contact_phone: data.contactPhone ?? null,
    p_contact_role: data.contactRole ?? null,
    p_note: data.note ?? null,
    p_consent_version: INTAKE_CONSENT_VERSION,
    p_source: data.source,
    p_token_hash: hashResumeToken(token),
    p_graph_version: INTAKE_PENDING_GRAPH_VERSION,
  });
  if (error) {
    // A duplicate email is not an error (the table allows it), so this never reveals one.
    deps.log("onboarding.intake.store_failed", { source: data.source });
    return fail("unavailable");
  }
  const row = firstRow(rows);
  deps.log("onboarding.intake.created", { source: data.source });
  return {
    ok: true,
    resumeToken: token,
    session: {
      graphVersion: INTAKE_PENDING_GRAPH_VERSION,
      revision: Number(row?.revision ?? 0),
      completionPct: Number(row?.completion_pct ?? 0),
      completed: false,
      expiresAt: String(
        row?.expires_at ?? new Date(nowMs + SESSION_DAYS * 86_400_000).toISOString(),
      ),
    },
  };
}

function viewFromRow(row: Record<string, unknown>): IntakeSessionView {
  return {
    graphVersion: String(row.graph_version ?? ""),
    revision: Number(row.revision ?? 0),
    completionPct: Number(row.completion_pct ?? 0),
    completed: row.completed_at != null,
    expiresAt: String(row.expires_at ?? ""),
  };
}

export async function loadIntakeSession(
  input: unknown,
  ip: string,
  deps: IntakeDeps,
): Promise<IntakeLoadResult> {
  const blocked = await limited(deps, "session", ip);
  if (blocked) return blocked;
  const parsed = IntakeLoadSchema.safeParse(input);
  if (!parsed.success) return fail("not_found");

  const hash = hashResumeToken(parsed.data.resumeToken);
  const { data, error } = await deps.rpc("onboarding_intake_load", { p_token_hash: hash });
  if (error) return dbFailure(error);
  const row = firstRow(data);
  if (!row || !sameTokenHash(String(row.resume_token_hash ?? ""), hash)) {
    deps.log("onboarding.intake.load_miss", {});
    return fail("not_found");
  }
  const answers =
    row.answers && typeof row.answers === "object" && !Array.isArray(row.answers)
      ? (row.answers as { [key: string]: IntakeJson })
      : {};
  return { ok: true, session: viewFromRow(row), answers };
}

export async function saveIntakeAnswers(
  input: unknown,
  ip: string,
  deps: IntakeDeps,
): Promise<IntakeSaveResult> {
  const blocked = await limited(deps, "session", ip);
  if (blocked) return blocked;
  const parsed = IntakeSaveSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", { fields: invalidFields(parsed.error) });

  const hash = hashResumeToken(parsed.data.resumeToken);
  const saved = await deps.rpc("onboarding_intake_save", {
    p_token_hash: hash,
    p_expected_revision: parsed.data.expectedRevision,
    p_answers: parsed.data.answers,
    p_completion_pct: parsed.data.completionPct,
  });
  if (saved.error) return dbFailure(saved.error);
  return loadIntakeSession({ resumeToken: parsed.data.resumeToken }, ip, {
    ...deps,
    rateLimit: async () => ({ allowed: true }),
  }).then((loaded) => (loaded.ok ? { ok: true, session: loaded.session } : loaded));
}

export async function completeIntakeSession(
  input: unknown,
  ip: string,
  deps: IntakeDeps,
): Promise<IntakeSaveResult> {
  const blocked = await limited(deps, "session", ip);
  if (blocked) return blocked;
  const parsed = IntakeCompleteSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", { fields: invalidFields(parsed.error) });

  const hash = hashResumeToken(parsed.data.resumeToken);
  const done = await deps.rpc("onboarding_intake_complete", {
    p_token_hash: hash,
    p_expected_revision: parsed.data.expectedRevision,
  });
  if (done.error) return dbFailure(done.error);
  return loadIntakeSession({ resumeToken: parsed.data.resumeToken }, ip, {
    ...deps,
    rateLimit: async () => ({ allowed: true }),
  }).then((loaded) => (loaded.ok ? { ok: true, session: loaded.session } : loaded));
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

/** Real dependencies: service-role client, shared public limiter, Turnstile secret from env. */
export async function productionIntakeDeps(): Promise<IntakeDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { checkPublicRateLimit } = await import("@/lib/security/public-rate-limit.server");
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim() || undefined;
  const client = supabaseAdmin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{
      data: unknown;
      error: { code?: string } | null;
    }>;
  };
  return {
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args);
      return { data, error: error ? { code: error.code } : null };
    },
    rateLimit: checkPublicRateLimit,
    captchaEnabled: Boolean(secret),
    verifyCaptcha: (token, ip) =>
      secret ? verifyTurnstileToken(token, ip, secret) : Promise.resolve(false),
    log: (event, detail) => console.info(JSON.stringify({ event, ...detail })),
  };
}
