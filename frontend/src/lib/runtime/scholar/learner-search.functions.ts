import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import type { RecordSearchHit } from "@/lib/platform/command-registry";

/**
 * Learner record search for the platform command palette.
 *
 * Authenticated, tenant-resolved from the caller's own administrator scope (never from
 * the client), validated, and executed with the caller's session so RLS applies.
 */
const learnerSearchSchema = z.object({
  term: z.string().trim().min(3).max(80),
});

/** ILIKE treats % and _ as wildcards; a search term is matched literally. */
function literalLikePattern(term: string): string {
  return `%${term.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

export const searchLearnerRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => learnerSearchSchema.parse(input))
  .handler(async ({ data, context }): Promise<RecordSearchHit[]> => {
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const { data: users } = await context.supabase
      .from("users")
      .select("id, full_name")
      .eq("role", "student")
      .eq("school_id", schoolId)
      .ilike("full_name", literalLikePattern(data.term))
      .limit(5);
    const people = (users ?? []) as Array<{ id: string; full_name: string | null }>;
    if (people.length === 0) return [];

    const { data: learnerRows } = await context.supabase
      .from("students")
      .select("id, user_id, admission_number, class_id")
      .eq("school_id", schoolId)
      .in(
        "user_id",
        people.map((person) => person.id),
      );
    const learners = (learnerRows ?? []) as Array<{
      id: string;
      user_id: string;
      admission_number: string | null;
      class_id: string | null;
    }>;

    const classIds = [...new Set(learners.map((row) => row.class_id).filter((id): id is string => Boolean(id)))];
    const classNames = new Map<string, string>();
    if (classIds.length > 0) {
      const { data: classRows } = await context.supabase
        .from("classes")
        .select("id, name")
        .eq("school_id", schoolId)
        .in("id", classIds);
      for (const row of (classRows ?? []) as Array<{ id: string; name: string | null }>) {
        if (row.name) classNames.set(row.id, row.name);
      }
    }

    const byUser = new Map(learners.map((row) => [row.user_id, row]));
    return people.map((person) => {
      const learner = byUser.get(person.id);
      const className = learner?.class_id ? classNames.get(learner.class_id) : undefined;
      return {
        recordRef: learner?.id ?? person.id,
        label: person.full_name ?? "(unnamed)",
        hint: [className, learner?.admission_number].filter(Boolean).join(" · ") || undefined,
      };
    });
  });
