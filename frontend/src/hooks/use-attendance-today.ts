import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";

export type AttendanceToday = {
  date: string;
  total: number;
  present: number;
  absent: number;
  late: number;
  rate: number;
};

/** Today's attendance roll-up for the current school (30s stale window). */
export function useAttendanceToday() {
  const { profile } = useApp();
  const schoolId = profile?.school_id;
  const today = new Date().toISOString().slice(0, 10);

  return useQuery<AttendanceToday>({
    queryKey: ["attendance-today", schoolId, today],
    enabled: !!schoolId,
    staleTime: 30 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("status")
        .eq("school_id", schoolId!)
        .eq("date", today)
        .limit(5000);
      if (error) throw error;
      const rows = data ?? [];
      const present = rows.filter((r) => r.status === "present").length;
      const late = rows.filter((r) => r.status === "late").length;
      const absent = rows.filter((r) => r.status === "absent").length;
      const total = rows.length;
      return {
        date: today,
        total,
        present,
        absent,
        late,
        rate: total ? Math.round(((present + late) / total) * 100) : 0,
      };
    },
  });
}
