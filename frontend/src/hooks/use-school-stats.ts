import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";

export type SchoolStats = {
  /** Legacy count fields — kept for existing consumers. */
  students: number;
  teachers: number;
  classes: number;
  fees: number;
  /** Aggregate figures for dashboards and the operations center. */
  totalStudents: number;
  totalTeachers: number;
  feeCollectionRate: number;
  todayAttendanceRate: number;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
};

/**
 * Shared stats for the current school. Deduped across the admin dashboard,
 * HQ dashboard and operations page via a single query key.
 */
export function useSchoolStats() {
  const { school, profile } = useApp();
  const schoolId = school?.id ?? profile?.school_id;

  return useQuery<SchoolStats>({
    queryKey: ["school-stats", schoolId],
    enabled: !!schoolId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];

      const [students, teachers, classes, feeRows, attendance] = await Promise.all([
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId!)
          .eq("is_active", true),
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId!)
          .eq("role", "teacher"),
        supabase
          .from("classes")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId!),
        supabase.from("fees").select("amount, paid_amount").eq("school_id", schoolId!),
        supabase.from("attendance").select("status").eq("school_id", schoolId!).eq("date", today),
      ]);

      const fees = feeRows.data ?? [];
      const totalBilled = fees.reduce((s, f) => s + Number(f.amount ?? 0), 0);
      const totalPaid = fees.reduce((s, f) => s + Number(f.paid_amount ?? 0), 0);
      const feeRate = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;

      const marks = attendance.data ?? [];
      const present = marks.filter((a) => a.status === "present").length;
      const attRate = marks.length > 0 ? Math.round((present / marks.length) * 100) : 0;

      const totalStudents = students.count ?? 0;
      const totalTeachers = teachers.count ?? 0;

      return {
        students: totalStudents,
        teachers: totalTeachers,
        classes: classes.count ?? 0,
        fees: fees.length,
        totalStudents,
        totalTeachers,
        feeCollectionRate: feeRate,
        todayAttendanceRate: attRate,
        totalBilled,
        totalPaid,
        outstanding: totalBilled - totalPaid,
      };
    },
  });
}

export default useSchoolStats;
