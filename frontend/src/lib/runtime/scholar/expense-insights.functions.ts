/**
 * AI-powered expense insights.
 * Aggregates the last 90 days of school_expenses for the caller's school,
 * summarises spend by category, compares against monthly budgets, and asks
 * Gemini for plain-English insights + budget alerts. Never persists.
 */
import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireStaffContext } from "@/lib/security-role-gate";
import { invokeAiGateway, type AiGatewayOutcome } from "@/lib/ai-gateway.server";
import { appendMemoryContext } from "@/lib/ai-context";
import {
  aiGuardLimits,
  buildGuardedPrompt,
  guardAiOutput,
  type AiProvenance,
} from "@/lib/ai/ai-guard.server";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const EXPENSE_INSIGHTS_MODEL = "google/gemini-3-flash-preview";

const InsightSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  alerts: z
    .array(
      z.object({
        severity: z.enum(["info", "warn", "critical"]),
        category: z.string(),
        message: z.string(),
      }),
    )
    .max(8),
  recommendations: z.array(z.string()).max(6),
});

export type ExpenseInsights = z.infer<typeof InsightSchema>;

export const getExpenseInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExpenseInsights & { aiProvenance?: AiProvenance }> => {
    // Canonical Phase 08 finance-staff gate (admin/principal/bursar). Replaces
    // the legacy inline users.role read + check.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const staff = await requireStaffContext(context.supabase, "finance_staff", {
      lifecycle: null,
      sessionValid:
        typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const cutoff = new Date(timeAuthority.now().atMs - 90 * 86400_000).toISOString().slice(0, 10);

    const [{ data: rows }, { data: budgets }] = await Promise.all([
      context.supabase
        .from("school_expenses")
        .select("amount, expense_category, expense_date")
        .eq("school_id", staff.schoolId)
        .gte("expense_date", cutoff),
      context.supabase
        .from("school_expense_budgets")
        .select("category, monthly_budget")
        .eq("school_id", staff.schoolId),
    ]);

    const byCat = new Map<string, number>();
    for (const r of rows ?? []) {
      byCat.set(r.expense_category, (byCat.get(r.expense_category) ?? 0) + Number(r.amount ?? 0));
    }
    const budgetMap = new Map<string, number>();
    for (const b of budgets ?? []) budgetMap.set(b.category, Number(b.monthly_budget ?? 0));

    const summary = Array.from(byCat.entries()).map(([cat, total]) => ({
      category: cat,
      total_90d: Math.round(total),
      monthly_avg: Math.round(total / 3),
      monthly_budget: budgetMap.get(cat) ?? null,
    }));

    if (summary.length === 0) {
      return {
        headline: "No expenses recorded yet",
        summary: "Start logging expenses to unlock AI-driven category insights and budget alerts.",
        alerts: [],
        recommendations: ["Add your first expense from the Add Expense form."],
      };
    }

    // Category names are user-entered records: fenced as untrusted data.
    const { system, prompt } = buildGuardedPrompt(
      [
        "You are a school finance analyst. Currency: Nigerian Naira (₦).",
        "Given the following 90-day expense aggregates per category and monthly budgets,",
        "produce a short headline, a 2-3 sentence summary, alerts for any category whose",
        "monthly average exceeds 90% of its budget (critical at >100%, warn at >90%, info otherwise),",
        "and up to 6 cost-saving recommendations. Use only the numbers in the data.",
      ].join("\n"),
      { DATA: JSON.stringify(summary, null, 2) },
    );
    const limits = await aiGuardLimits(staff.schoolId);

    let outcome: AiGatewayOutcome<ExpenseInsights>;
    try {
      outcome = await invokeAiGateway({
        tenantRef: staff.schoolId,
        actorRef: context.userId,
        agentRef: null,
        missionRef: null,
        model: EXPENSE_INSIGHTS_MODEL,
        provider: "ai-gateway",
        purpose: "summarization",
        ...limits,
        invoke: async (provider, gatewayContext) => {
          const { output, usage } = await generateText({
            model: provider(EXPENSE_INSIGHTS_MODEL),
            output: Output.object({ schema: InsightSchema }),
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
      if (/402/.test(msg)) throw new Error("AI credits exhausted for this workspace.");
      throw new Error(`AI insights failed: ${msg}`);
    }
    if (outcome.decision === "deny") {
      if (outcome.code === "unconfigured") {
        throw new Error("AI is not configured");
      }
      throw new Error(outcome.reason);
    }
    return guardAiOutput(InsightSchema.parse(outcome.payload), EXPENSE_INSIGHTS_MODEL);
  });
