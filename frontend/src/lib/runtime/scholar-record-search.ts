/**
 * Scholar runtime — learner record search for the platform command palette.
 *
 * Offered only to members whose resolved workspace contains the learner directory, and
 * scoped to the member's own organization. Supabase RLS remains the enforcement layer;
 * the tenant filter here only narrows the query.
 */
import { supabase } from "@/integrations/supabase/client";
import type { RecordSearchHit, RecordSearchProvider } from "@/lib/platform/command-registry";

async function searchLearners(term: string, scope: { tenantRef: string | null }): Promise<RecordSearchHit[]> {
  let userQuery = supabase
    .from("users")
    .select("id, full_name")
    .eq("role", "student")
    .ilike("full_name", `%${term}%`)
    .limit(5);
  if (scope.tenantRef) userQuery = userQuery.eq("school_id", scope.tenantRef);
  const { data: users } = await userQuery;
  const people = (users ?? []) as Array<{ id: string; full_name: string | null }>;
  if (people.length === 0) return [];

  let learnerQuery = supabase
    .from("students")
    .select("id, user_id, admission_number, class_id")
    .in(
      "user_id",
      people.map((person) => person.id),
    );
  if (scope.tenantRef) learnerQuery = learnerQuery.eq("school_id", scope.tenantRef);
  const { data: learnerRows } = await learnerQuery;
  const learners = (learnerRows ?? []) as Array<{
    id: string;
    user_id: string;
    admission_number: string | null;
    class_id: string | null;
  }>;

  const classIds = [...new Set(learners.map((row) => row.class_id).filter((id): id is string => Boolean(id)))];
  const classNames = new Map<string, string>();
  if (classIds.length > 0) {
    const { data: classRows } = await supabase.from("classes").select("id, name").in("id", classIds);
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
}

export const SCHOLAR_LEARNER_SEARCH: RecordSearchProvider = {
  id: "runtime:scholar/learners",
  groupLabel: "Learners",
  placeholderNoun: "learners",
  navItemKeys: ["r001.org_admin.students"],
  minQueryLength: 3,
  search: searchLearners,
};
