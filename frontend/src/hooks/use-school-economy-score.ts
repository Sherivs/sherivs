import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";

export type EconomyScoreBreakdown = {
  feeCollection: { score: number; rate: number; label: string };
  studentAttendance: { score: number; rate: number; label: string };
  teacherAttendance: { score: number; rate: number; label: string };
  enrollment: { score: number; rate: number; label: string };
  academic: { score: number; rate: number; label: string };
  overall: number;
  grade: "A" | "B" | "C" | "D" | "F";
  trend: "up" | "down" | "stable";
};

/**
 * Shared School Economy Score for the current tenant.
 * Computes a composite institutional health index from fee collection,
 * student attendance, teacher attendance, enrollment capacity, and academic
 * performance over the last three months.
 */
export function useSchoolEconomyScore() {
  const { school } = useApp();
  const schoolId = school?.id;

  return useQuery<EconomyScoreBreakdown>({
    queryKey: ["school-economy-score", schoolId],
    staleTime: 5 * 60 * 1000,
    enabled: !!schoolId,
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const termStart = new Date();
      termStart.setMonth(termStart.getMonth() - 3);
      const termStartStr = termStart.toISOString().split("T")[0];

      // Parallel queries for performance
      const [feesRes, stuAttRes, tchAttRes, studentsRes, gradesRes] = await Promise.all([
        supabase.from("fees").select("amount, paid_amount").eq("school_id", schoolId!),
        supabase
          .from("attendance")
          .select("status")
          .eq("school_id", schoolId!)
          .gte("date", termStartStr),
        supabase
          .from("attendance_logs")
          .select("timestamp")
          .eq("school_id", schoolId!)
          .gte("timestamp", termStartStr),
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId!)
          .eq("is_active", true),
        supabase
          .from("grades")
          .select("total_score")
          .eq("school_id", schoolId!)
          .gte("created_at", termStartStr),
      ]);

      // Fee collection score (weight 25%)
      const fees = feesRes.data ?? [];
      const totalBilled = fees.reduce((s, f) => s + (f.amount ?? 0), 0);
      const totalPaid = fees.reduce((s, f) => s + (f.paid_amount ?? 0), 0);
      const feeRate = totalBilled > 0 ? (totalPaid / totalBilled) * 100 : 0;
      const feeScore = Math.round(feeRate * 0.25);

      // Student attendance score (weight 25%)
      const stuAtt = stuAttRes.data ?? [];
      const stuPres = stuAtt.filter((a) => a.status === "present").length;
      const stuRate = stuAtt.length > 0 ? (stuPres / stuAtt.length) * 100 : 0;
      const stuScore = Math.round(stuRate * 0.25);

      // Teacher attendance score (weight 20%)
      const tchAtt = tchAttRes.data ?? [];
      const tchRate = tchAtt.length > 0 ? Math.min(100, (tchAtt.length / 20) * 100) : 0;
      const tchScore = Math.round(tchRate * 0.2);

      // Enrollment score (weight 15%)
      const enrolled = studentsRes.count ?? 0;
      const maxCap = (school?.max_students as number | undefined) ?? enrolled;
      const enrollRate = maxCap > 0 ? Math.min(100, (enrolled / maxCap) * 100) : 100;
      const enrollScore = Math.round(enrollRate * 0.15);

      // Academic score (weight 15%)
      const gr = gradesRes.data ?? [];
      const avgScore =
        gr.length > 0 ? gr.reduce((s, g) => s + (g.total_score ?? 0), 0) / gr.length : 0;
      const acadScore = Math.round(avgScore * 0.15);

      const overall = feeScore + stuScore + tchScore + enrollScore + acadScore;

      const grade: EconomyScoreBreakdown["grade"] =
        overall >= 80 ? "A" : overall >= 60 ? "B" : overall >= 40 ? "C" : overall >= 20 ? "D" : "F";

      return {
        feeCollection: { score: feeScore, rate: feeRate, label: "Fee Collection" },
        studentAttendance: { score: stuScore, rate: stuRate, label: "Student Attendance" },
        teacherAttendance: { score: tchScore, rate: tchRate, label: "Teacher Presence" },
        enrollment: { score: enrollScore, rate: enrollRate, label: "Enrollment Health" },
        academic: { score: acadScore, rate: avgScore, label: "Academic Performance" },
        overall,
        grade,
        trend: "stable",
      };
    },
  });
}
