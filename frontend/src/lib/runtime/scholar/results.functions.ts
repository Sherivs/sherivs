/** Score and result mutations use tenant-resolving M06 database RPCs with auditable writes. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const componentSchema = z.object({
  code: z.string().trim().min(1).max(64),
  weight: z.number().positive().max(100),
  max_score: z.number().positive(),
});

const configureWeightsSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  term: z.string().trim().min(1).max(48),
  academic_year: z.string().trim().min(4).max(32),
  ca_weight: z.number().positive().max(100),
  terminal_weight: z.number().positive().max(100),
  terminal_max_score: z.number().positive(),
  ca_components: z.array(componentSchema).min(1),
});

const scoreSchema = z.object({
  student_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(120),
  term: z.string().trim().min(1).max(48),
  academic_year: z.string().trim().min(4).max(32),
  ca_scores: z.record(z.string(), z.number().nonnegative().nullable()),
  terminal_score: z.number().nonnegative().nullable(),
});

const gradeIdSchema = z.object({ grade_id: z.string().uuid() });
const amendmentSchema = gradeIdSchema.extend({
  ca_scores: z.record(z.string(), z.number().nonnegative().nullable()),
  terminal_score: z.number().nonnegative().nullable(),
  reason: z.string().trim().min(8).max(1000),
});
const uuidResultSchema = z.string().uuid();
const scoreResultSchema = z.object({
  ca_score: z.number().nullable(),
  terminal_score: z.number().nullable(),
  total_score: z.number().nullable(),
  grade: z.string().nullable(),
});

type ResultsRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function callResultsRpc(
  supabase: unknown,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await (supabase as ResultsRpcClient).rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export const configureResultWeights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => configureWeightsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const profileId = await callResultsRpc(context.supabase, "m06_set_result_weights", {
      p_subject: data.subject,
      p_term: data.term,
      p_academic_year: data.academic_year,
      p_ca_weight: data.ca_weight,
      p_terminal_weight: data.terminal_weight,
      p_terminal_max_score: data.terminal_max_score,
      p_ca_components: data.ca_components,
    });
    return { profile_id: uuidResultSchema.parse(profileId) };
  });

export const enterResultScores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => scoreSchema.parse(input))
  .handler(async ({ data, context }) => {
    const gradeId = await callResultsRpc(context.supabase, "m06_enter_result_scores", {
      p_student_id: data.student_id,
      p_subject: data.subject,
      p_term: data.term,
      p_academic_year: data.academic_year,
      p_ca_scores: data.ca_scores,
      p_terminal_score: data.terminal_score,
    });
    return { grade_id: uuidResultSchema.parse(gradeId) };
  });

export const approveResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => gradeIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await callResultsRpc(context.supabase, "m06_approve_result", {
      p_grade_id: data.grade_id,
    });
    return { ok: true };
  });

export const publishResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => gradeIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await callResultsRpc(context.supabase, "m06_publish_result", {
      p_grade_id: data.grade_id,
    });
    return { ok: true };
  });

export const amendResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => amendmentSchema.parse(input))
  .handler(async ({ data, context }) => {
    const result = await callResultsRpc(context.supabase, "m06_amend_result", {
      p_grade_id: data.grade_id,
      p_ca_scores: data.ca_scores,
      p_terminal_score: data.terminal_score,
      p_reason: data.reason,
    });
    return { result: scoreResultSchema.parse(result) };
  });
