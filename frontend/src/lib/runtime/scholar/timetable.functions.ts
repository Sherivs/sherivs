/**
 * Timetable: AI-assisted weekly schedule generation + persistence.
 * Generates a draft for a single class, then saves the timetable + slots
 * in one transaction-ish flow.
 */
import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { invokeAiGateway } from "@/lib/ai-gateway.server";
import { appendMemoryContext } from "@/lib/ai-context";
import { aiGuardLimits, buildGuardedPrompt, guardAiOutput } from "@/lib/ai/ai-guard.server";

const TIMETABLE_MODEL = "google/gemini-3-flash-preview";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

const slotSchema = z.object({
  day_of_week: z.enum(DAYS),
  period_number: z.number().int().min(1).max(12),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  subject: z.string().min(1).max(80),
  is_break: z.boolean().default(false),
  break_label: z.string().nullable().optional(),
});

const draftSchema = z.object({ slots: z.array(slotSchema).min(5).max(80) });

const generateInput = z.object({
  class_id: z.string().uuid(),
  subjects: z.array(z.string().min(1)).min(1).max(20),
  periods_per_day: z.number().int().min(4).max(10).default(7),
  start_hour: z.number().int().min(6).max(10).default(8),
  period_minutes: z.number().int().min(30).max(60).default(40),
  include_break: z.boolean().default(true),
});

export const generateTimetableDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => generateInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    const { data: klass } = await supabase
      .from("classes")
      .select("id, name, grade_level, school_id")
      .eq("id", data.class_id)
      .maybeSingle();
    if (!klass || klass.school_id !== schoolId) throw new Error("Class not found in your school");

    // Class name and subject names are user-entered: fenced as untrusted data.
    const { system, prompt } = buildGuardedPrompt(
      `You are a school timetable planner. Build a 5-day weekly schedule (Mon–Fri) for the class described below.
Constraints:
- ${data.periods_per_day} periods per school day, each ${data.period_minutes} minutes, starting at ${String(data.start_hour).padStart(2, "0")}:00.
- Distribute the listed subjects fairly across the week; use only those subject names.
- ${data.include_break ? "Insert a 20-minute break after period 3 each day (is_break=true, break_label='Break', subject='Break')." : "No break period."}
- No subject should appear more than 2 times in a single day.
- Spread heavy subjects (Maths, English, Sciences) earlier in the day when possible.
Return JSON with shape { "slots": [{day_of_week, period_number, start_time, end_time, subject, is_break, break_label}] }.
Times must be HH:MM 24h. day_of_week is lowercase (monday..friday).`,
      {
        Class: `${klass.name} (${klass.grade_level ?? "general"})`,
        Subjects: data.subjects.join(", "),
      },
    );
    const limits = await aiGuardLimits(schoolId);

    let draft: z.infer<typeof draftSchema>;
    try {
      const outcome = await invokeAiGateway({
        tenantRef: schoolId,
        actorRef: context.userId,
        agentRef: null,
        missionRef: null,
        model: TIMETABLE_MODEL,
        provider: "ai-gateway",
        purpose: "drafting",
        ...limits,
        invoke: async (provider, gatewayContext) => {
          const { output, usage } = await generateText({
            model: provider(TIMETABLE_MODEL),
            output: Output.object({ schema: draftSchema }),
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
      if (outcome.decision === "deny") {
        if (outcome.code === "unconfigured") {
          throw new Error("AI gateway not configured");
        }
        throw new Error(outcome.reason);
      }
      draft = outcome.payload;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI generation failed";
      if (msg.includes("429")) throw new Error("AI rate limit reached. Try again in a moment.");
      if (msg.includes("402"))
        throw new Error("AI credits exhausted. Top up in workspace settings.");
      throw new Error(msg);
    }

    // Output check: only requested subjects (or Break) may appear.
    const allowed = new Set([...data.subjects.map((x) => x.trim().toLowerCase()), "break"]);
    const slots = draft.slots.filter((sl) => allowed.has(String(sl.subject).trim().toLowerCase()));
    const guarded = guardAiOutput({ slots }, TIMETABLE_MODEL);
    return {
      class_id: data.class_id,
      school_id: schoolId,
      slots: guarded.slots,
      aiProvenance: guarded.aiProvenance,
    };
  });

const saveInput = z.object({
  class_id: z.string().uuid(),
  academic_year: z.string().min(4).max(20),
  term: z.string().min(1).max(20),
  publish: z.boolean().default(false),
  slots: z.array(slotSchema).min(1).max(120),
});

export const saveTimetable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => saveInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading: see generateTimetableDraft for the signal semantics.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    // Deactivate prior timetables for this class+year+term
    await supabase
      .from("timetables")
      .update({ is_active: false })
      .eq("school_id", schoolId)
      .eq("class_id", data.class_id)
      .eq("academic_year", data.academic_year)
      .eq("term", data.term);

    const { data: tt, error: ttErr } = await supabase
      .from("timetables")
      .insert({
        school_id: schoolId,
        class_id: data.class_id,
        academic_year: data.academic_year,
        term: data.term,
        generated_by: "ai",
        is_active: true,
        published: data.publish,
      })
      .select("id")
      .single();
    if (ttErr) throw new Error(ttErr.message);

    const rows = data.slots.map((s) => ({
      timetable_id: tt.id,
      school_id: schoolId,
      day_of_week: s.day_of_week,
      period_number: s.period_number,
      start_time: s.start_time,
      end_time: s.end_time,
      subject: s.subject,
      is_break: s.is_break,
      break_label: s.break_label ?? null,
    }));

    const { error: slErr } = await supabase.from("timetable_slots").insert(rows);
    if (slErr) throw new Error(slErr.message);

    return { timetable_id: tt.id, slot_count: rows.length };
  });
