/**
 * SV1-REALITY R3 (#334) — school onboarding interview server functions (school-admin scope).
 *
 * The interview is stored in the existing neutral org-profile store (profile key
 * `reality.onboarding_interview`) through the existing tenant-scoped RPCs. The
 * tenant comes from the verified actor, never from the client. The client sends
 * one answer, one clear or one approval at a time; it never sends state, a
 * source, an approver or an approval flag. Every change goes through the pure
 * engine, which owns all rules. See ADR-053.
 *
 * Known limit: read-then-write is not atomic. `expectedRevision` stops a stale
 * screen from overwriting newer work; it does not serialise two simultaneous
 * requests (see ADR-053, consequences).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { SCHOLAR_PROFILE_RUNTIME } from "@/lib/runtime/scholar/org-profile.functions";
import {
  INTERVIEW_PROFILE_KEY,
  applyAnswer,
  approveInterview,
  buildInterviewView,
  clearAnswer,
  emptyInterview,
  parseInterview,
  type DiscoveryAnswer,
  type InterviewIssue,
  type InterviewState,
  type InterviewView,
} from "@/lib/scholar/reality";

const answerValue = z.union([
  z.string().max(600),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(200)).max(120),
  z.null(),
]);

const answerInput = z
  .object({
    questionId: z.string().min(1).max(160),
    state: z.enum(["confirmed", "unknown", "pending", "conflicting", "not_applicable"]),
    value: answerValue.optional(),
    candidates: z.array(answerValue).max(10).optional(),
    evidenceRef: z.string().max(200).optional(),
  })
  .strict();

const revision = z.number().int().min(0).max(1_000_000);

export type InterviewOutcome =
  | { readonly ok: true; readonly view: InterviewView }
  | {
      readonly ok: false;
      readonly issues: readonly InterviewIssue[];
      readonly view: InterviewView;
    };

export async function scope(context: {
  supabase: Parameters<typeof requireSchoolAdminScope>[0];
  claims?: { exp?: number } | null;
}): Promise<string> {
  // Same lifecycle threading as org-profile.functions.ts.
  return requireSchoolAdminScope(context.supabase, {
    lifecycle: null,
    sessionValid:
      typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
  });
}

export async function load(
  db: ReturnType<typeof asKernelAdmin>,
  schoolId: string,
  nowMs: number,
): Promise<{ state: InterviewState; notes: readonly string[] }> {
  const { data, error } = await db.rpc("get_org_profile", {
    p_tenant: schoolId,
    p_runtime: SCHOLAR_PROFILE_RUNTIME,
    p_profile_key: INTERVIEW_PROFILE_KEY,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row?.payload) return { state: emptyInterview(nowMs), notes: [] };
  const parsed = parseInterview(row.payload, nowMs);
  return { state: parsed.state, notes: parsed.notes };
}

async function save(
  db: ReturnType<typeof asKernelAdmin>,
  schoolId: string,
  state: InterviewState,
): Promise<void> {
  const { error } = await db.rpc("upsert_org_profile", {
    p_tenant: schoolId,
    p_runtime: SCHOLAR_PROFILE_RUNTIME,
    p_profile_key: INTERVIEW_PROFILE_KEY,
    p_payload: state as unknown as Record<string, unknown>,
  });
  if (error) throw new Error(error.message);
}

export const getInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).strict().parse(input))
  .handler(async ({ context }): Promise<InterviewView> => {
    const schoolId = await scope(context);
    const { state, notes } = await load(asKernelAdmin(context.supabase), schoolId, Date.now());
    return buildInterviewView(state, notes);
  });

export const submitInterviewAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ answer: answerInput, expectedRevision: revision }).strict().parse(input),
  )
  .handler(async ({ data, context }): Promise<InterviewOutcome> => {
    const schoolId = await scope(context);
    const db = asKernelAdmin(context.supabase);
    const nowMs = Date.now();
    const { state, notes } = await load(db, schoolId, nowMs);
    // The source is always "human": this endpoint only ever carries an admin's own answer.
    const answer = { ...data.answer, source: "human" } as DiscoveryAnswer;
    const result = applyAnswer(state, answer, nowMs, data.expectedRevision);
    if (!result.ok)
      return { ok: false, issues: result.issues, view: buildInterviewView(state, notes) };
    await save(db, schoolId, result.state);
    return { ok: true, view: buildInterviewView(result.state, notes) };
  });

export const clearInterviewAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ questionId: z.string().min(1).max(160), expectedRevision: revision })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<InterviewOutcome> => {
    const schoolId = await scope(context);
    const db = asKernelAdmin(context.supabase);
    const nowMs = Date.now();
    const { state, notes } = await load(db, schoolId, nowMs);
    const result = clearAnswer(state, data.questionId, nowMs, data.expectedRevision);
    if (!result.ok)
      return { ok: false, issues: result.issues, view: buildInterviewView(state, notes) };
    await save(db, schoolId, result.state);
    return { ok: true, view: buildInterviewView(result.state, notes) };
  });

export const approveInterviewAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ expectedRevision: revision }).strict().parse(input))
  .handler(async ({ data, context }): Promise<InterviewOutcome> => {
    const schoolId = await scope(context);
    const db = asKernelAdmin(context.supabase);
    const nowMs = Date.now();
    const { state, notes } = await load(db, schoolId, nowMs);
    // The approver is the verified actor; the client cannot name one.
    const result = approveInterview(state, context.userId, nowMs, data.expectedRevision);
    if (!result.ok)
      return { ok: false, issues: result.issues, view: buildInterviewView(state, notes) };
    await save(db, schoolId, result.state);
    return { ok: true, view: buildInterviewView(result.state, notes) };
  });
