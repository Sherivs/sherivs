import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { TimetableGrid, type TimetableSlot } from "@/components/timetable-grid";

export const Route = createFileRoute("/_authenticated/student/timetable")({
  ssr: false,
  component: StudentTimetablePage,
});

function StudentTimetablePage() {
  const { profile } = useApp();
  const userId = profile?.id;
  const [classId, setClassId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("class_id")
        .eq("user_id", userId)
        .maybeSingle();
      setClassId((data?.class_id as string) ?? null);
    })();
  }, [userId]);

  const q = useQuery({
    queryKey: ["student-timetable", classId],
    enabled: !!classId,
    queryFn: async () => {
      const { data: tt } = await supabase
        .from("timetables")
        .select("id")
        .eq("class_id", classId!)
        .eq("is_active", true)
        .eq("published", true)
        .maybeSingle();
      if (!tt) return [] as TimetableSlot[];
      const { data: slots } = await supabase
        .from("timetable_slots")
        .select(
          "day_of_week, period_number, start_time, end_time, subject, room, is_break, break_label",
        )
        .eq("timetable_id", tt.id)
        .order("period_number");
      return (slots ?? []) as TimetableSlot[];
    },
  });

  return (
    <PortalPage title="My class timetable" subtitle="Your weekly class schedule.">
      <div className="mb-4 text-xs">
        <Link
          to="/student/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back
        </Link>
      </div>
      {!classId ? (
        <div className="uos-empty p-8 text-center text-sm text-muted-foreground">
          Your account isn't linked to a class yet. Ask your school admin.
        </div>
      ) : (
        <TimetableGrid slots={q.data ?? []} />
      )}
    </PortalPage>
  );
}
