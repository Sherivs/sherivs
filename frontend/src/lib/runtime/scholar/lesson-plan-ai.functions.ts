/**
 * AI-assisted lesson plan draft generator.
 * Uses the Sherivs AI Gateway. Returns a structured draft the
 * teacher can edit before saving / submitting. Never persists anything itself.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, Output } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireStaffContext } from "@/lib/security-role-gate";
import { invokeAiGateway, type AiGatewayOutcome } from "@/lib/ai-gateway.server";
import { appendMemoryContext } from "@/lib/ai-context";
import {
  aiGuardLimits,
  buildGuardedPrompt,
  guardAiOutput,
  type AiLabelled,
} from "@/lib/ai/ai-guard.server";

const LESSON_PLAN_MODEL = "google/gemini-3-flash-preview";

const Input = z.object({
  subject: z.string().trim().min(2).max(80),
  topic: z.string().trim().min(2).max(180),
  grade_level: z.string().trim().max(80).optional(),
  duration_minutes: z.number().int().min(10).max(240).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const Schema = z.object({
  title: z.string(),
  objectives: z.array(z.string()).min(1).max(8),
  materials: z.array(z.string()).max(10),
  activities: z
    .array(
      z.object({
        minutes: z.number().int().min(1).max(120),
        description: z.string(),
      }),
    )
    .min(2)
    .max(8),
  assessment: z.string(),
  homework: z.string(),
});

export type LessonPlanDraft = z.infer<typeof Schema>;

export const draftLessonPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<AiLabelled<LessonPlanDraft>> => {
    // Canonical Phase 08 teaching-staff gate (admin/principal/teacher).
    // Lesson-plan generation consumes the workspace AI gateway — cost-bearing,
    // so it is restricted to staff rather than any authenticated user.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const staff = await requireStaffContext(context.supabase, "teaching_staff", {
      lifecycle: null,
      sessionValid:
        typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const duration = data.duration_minutes ?? 40;
    // Teacher-supplied text is untrusted: redacted, screened and fenced.
    const { system, prompt } = buildGuardedPrompt(
      [
        `Draft a single classroom lesson plan.`,
        `Total duration: ${duration} minutes.`,
        `Return concise, age-appropriate objectives, a list of materials, a sequence of activities whose minutes sum to roughly ${duration}, an assessment idea, and a short homework task.`,
      ].join("\n"),
      {
        Subject: data.subject,
        Topic: data.topic,
        "Grade / level": data.grade_level,
        "Teacher notes": data.notes,
      },
    );
    const limits = await aiGuardLimits(staff.schoolId);

    let outcome: AiGatewayOutcome<LessonPlanDraft>;
    try {
      outcome = await invokeAiGateway({
        tenantRef: staff.schoolId,
        actorRef: context.userId,
        agentRef: null,
        missionRef: null,
        model: LESSON_PLAN_MODEL,
        provider: "ai-gateway",
        purpose: "drafting",
        ...limits,
        invoke: async (provider, gatewayContext) => {
          const { output, usage } = await generateText({
            model: provider(LESSON_PLAN_MODEL),
            output: Output.object({ schema: Schema }),
            system,
            prompt: appendMemoryContext(prompt, gatewayContext?.memoryContext ?? null),
          });
          return {
            payload: output,
            tokensIn: usage?.inputTokens ?? 0,
            tokensOut: usage?.outputTokens ?? 0,
          };
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/429/.test(msg)) throw new Error("AI is busy right now — try again in a moment.");
      if (/402/.test(msg))
        throw new Error(
          "AI credits exhausted for this workspace. Top up in Settings → Plans & credits.",
        );
      throw new Error(`AI draft failed: ${msg}`);
    }
    if (outcome.decision === "deny") {
      if (outcome.code === "unconfigured") {
        throw new Error("AI is not configured");
      }
      throw new Error(outcome.reason);
    }
    return guardAiOutput(Schema.parse(outcome.payload), LESSON_PLAN_MODEL);
  });
