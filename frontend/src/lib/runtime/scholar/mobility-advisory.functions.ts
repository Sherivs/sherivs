import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { invokeAiGateway, type AiGatewayOutcome } from "@/lib/ai-gateway.server";
import { appendMemoryContext } from "@/lib/ai-context";
import {
  aiGuardLimits,
  buildGuardedPrompt,
  guardAiOutput,
  type AiLabelled,
} from "@/lib/ai/ai-guard.server";
import {
  MobilityAdvisorySchema,
  mobilityAdvisoryEvidence,
  mobilityAdvisoryEvidenceReferences,
  validateMobilityAdvisoryCitations,
  type MobilityAdvisory,
} from "@/lib/scholar/mobility-advisory";

const MODEL = "google/gemini-3-flash-preview";
type MobilityAdviceRpcClient = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};
const Input = z.object({
  studentId: z.string().uuid(),
  targetClassId: z.string().uuid().nullable(),
  movementType: z.enum([
    "promote",
    "repeat",
    "double_promote",
    "conditional_promote",
    "demote",
    "internal_transfer",
    "withdraw",
    "graduate",
    "readmit",
  ]),
});

export const getMobilityAdvisory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<AiLabelled<MobilityAdvisory>> => {
    if (typeof context?.claims?.exp !== "number" || tokenMsRemaining(context.claims.exp) <= 0) {
      throw new Error("Your session is expired. Sign in again before requesting an advisory.");
    }

    const supabase = context.supabase as unknown as MobilityAdviceRpcClient;
    const { data: schoolId, error: scopeError } = await supabase.rpc("get_my_school_id");
    if (scopeError || typeof schoolId !== "string") {
      throw new Error("No authorized organization is available for this advisory.");
    }
    const { data: allowed, error: permissionError } = await supabase.rpc("scholar_can", {
      p_org: schoolId,
      p_perm: "students.transfer",
    });
    if (permissionError || allowed !== true) {
      throw new Error("The students.transfer permission is required for a mobility advisory.");
    }

    const { data: rawEvidence, error: previewError } = await supabase.rpc(
      "student_mobility_preview",
      {
        p_student: data.studentId,
        p_target_class: data.targetClassId,
        p_movement_type: data.movementType,
        p_additional_students: 0,
      },
    );
    if (previewError) throw new Error("Mobility evidence could not be verified.");
    const evidence = mobilityAdvisoryEvidence(rawEvidence);
    const { system, prompt } = buildGuardedPrompt(
      [
        "Provide one explainable, advisory-only student mobility recommendation.",
        "Use only the supplied policy-preview facts. Do not invent institutional policy or student history.",
        "If any eligibility check is unmet, recommend human review rather than proceeding.",
        "Never approve, apply, submit, or execute a movement. A human approval chain is always required.",
        `Cite only exact entries from this verified evidence list: ${JSON.stringify(mobilityAdvisoryEvidenceReferences(evidence))}.`,
        "State the limitations of this snapshot.",
      ].join(" "),
      { "Policy preview facts": JSON.stringify(evidence) },
    );
    const limits = await aiGuardLimits(schoolId);
    let outcome: AiGatewayOutcome<MobilityAdvisory>;
    try {
      outcome = await invokeAiGateway({
        tenantRef: schoolId,
        actorRef: context.userId,
        agentRef: null,
        missionRef: null,
        model: MODEL,
        provider: "ai-gateway",
        purpose: "workflow_assistance",
        ...limits,
        invoke: async (provider, gatewayContext) => {
          const { output, usage } = await generateText({
            model: provider(MODEL),
            output: Output.object({ schema: MobilityAdvisorySchema }),
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
    } catch {
      throw new Error(
        "The mobility advisory is unavailable. Eligibility and approval rules remain unchanged.",
      );
    }
    if (outcome.decision === "deny") {
      throw new Error(
        outcome.code === "unconfigured"
          ? "AI is not configured. Eligibility and approval rules remain unchanged."
          : outcome.reason,
      );
    }
    const advisory = validateMobilityAdvisoryCitations(
      MobilityAdvisorySchema.parse(outcome.payload),
      evidence,
    );
    return guardAiOutput(advisory, MODEL);
  });
