import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { TimetableGrid, type TimetableSlot } from "@/components/timetable-grid";

export const Route = createFileRoute("/_authenticated/teacher/timetable")({
  ssr: false,
  component: TeacherTimetablePage,
});

function TeacherTimetablePage() {
  const { profile } = useApp();
  const teacherId = profile?.id;

  const q = useQuery({
    queryKey: ["teacher-timetable", teacherId],
    enabled: !!teacherId,
    queryFn: async () => {
      const { data } = await supabase
        .from("timetable_slots")
        .select(
          "day_of_week, period_number, start_time, end_time, subject, room, is_break, break_label",
        )
        .eq("teacher_id", teacherId!)
        .order("period_number");
      return (data ?? []) as TimetableSlot[];
    },
  });

  return (
    <PortalPage title="My timetable" subtitle="Your weekly teaching schedule.">
      <div className="mb-4 text-xs">
        <Link
          to="/teacher/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back
        </Link>
      </div>
      <TimetableGrid slots={q.data ?? []} />
    </PortalPage>
  );
}
