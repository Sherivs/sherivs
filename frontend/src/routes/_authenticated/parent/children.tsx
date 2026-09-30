import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, EmptyCard } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/parent/children")({
  ssr: false,
  component: ParentChildrenPage,
});

type Child = {
  student_id: string;
  full_name: string;
  admission_number: string | null;
  class_name: string | null;
};

function ParentChildrenPage() {
  const { profile } = useApp();
  const parentId = profile?.id;

  const children = useQuery<Child[]>({
    queryKey: ["parent-children-list", parentId],
    enabled: !!parentId,
    queryFn: async () => {
      const { data: map } = await supabase
        .from("parent_student_map")
        .select("student_id")
        .eq("parent_id", parentId!);
      const ids = (map ?? []).map((r) => r.student_id as string);
      if (ids.length === 0) return [];
      const { data: students } = await supabase
        .from("students")
        .select("id, admission_number, user_id, class_id")
        .in("id", ids);
      const userIds = (students ?? []).map((s) => s.user_id).filter(Boolean) as string[];
      const classIds = (students ?? []).map((s) => s.class_id).filter(Boolean) as string[];
      const [{ data: users }, { data: classes }] = await Promise.all([
        userIds.length
          ? supabase.from("users").select("id, full_name").in("id", userIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
        classIds.length
          ? supabase.from("classes").select("id, name").in("id", classIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ]);
      const nameOf = new Map((users ?? []).map((u) => [u.id, u.full_name as string]));
      const classOf = new Map((classes ?? []).map((c) => [c.id, c.name as string]));
      return (students ?? []).map((s) => ({
        student_id: s.id as string,
        full_name: s.user_id ? (nameOf.get(s.user_id as string) ?? "Child") : "Child",
        admission_number: (s.admission_number as string) ?? null,
        class_name: s.class_id ? (classOf.get(s.class_id as string) ?? null) : null,
      }));
    },
  });

  return (
    <PortalPage title="My children" subtitle="All students linked to your account.">
      {(children.data?.length ?? 0) === 0 ? (
        <EmptyCard
          title="No children linked"
          body="Ask your school admin to link your child's record to this account so you can see grades, attendance, and fees."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {children.data!.map((c) => (
            <div key={c.student_id} className="uos-card p-5">
              <h3 className="font-display text-lg font-semibold">{c.full_name}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.admission_number ? `#${c.admission_number}` : "No admission #"}
                {c.class_name ? ` · ${c.class_name}` : ""}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Link
                  to="/parent/grades"
                  className="rounded-md border border-border px-3 py-1.5 hover:bg-muted/40"
                >
                  Grades
                </Link>
                <Link
                  to="/parent/attendance"
                  className="rounded-md border border-border px-3 py-1.5 hover:bg-muted/40"
                >
                  Attendance
                </Link>
                <Link
                  to="/parent/report-cards"
                  className="rounded-md border border-border px-3 py-1.5 hover:bg-muted/40"
                >
                  Report card
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </PortalPage>
  );
}
