/**
 * Report card view, rendered for one student / term / academic year.
 *
 * - Only reads `is_published = true` rows so unpublished drafts never leak
 *   to students or parents.
 * - Computes totals + average client-side; the DB trigger fills in
 *   `total_score` and the letter `grade` server-side when the teacher omits
 *   them, so the two views always agree.
 * - Aggregates the student's attendance counts (present / absent / late /
 *   excused) for a quick term-level summary on the card.
 * - "Print" uses the browser print dialog (works as Save-as-PDF).
 * - "Download PDF" rasterises the card with html2canvas-pro and ships a
 *   single-page jsPDF file — no server round-trip.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { computeGpa } from "@/lib/academics/grading";

type Grade = {
  id: string;
  subject: string;
  ca_score: number | null;
  exam_score: number | null;
  total_score: number | null;
  grade: string | null;
  grade_remark: string | null;
  term: string | null;
  academic_year: string | null;
  credit_units: number | null;
  grade_point: number | null;
};

type Student = {
  id: string;
  admission_number: string | null;
  class_id: string | null;
  user_id: string | null;
};

type AttendanceRow = { status: string | null };

export function ReportCard({
  studentId,
  term,
  academicYear,
}: {
  studentId: string;
  term?: string | null;
  academicYear?: string | null;
}) {
  const { school } = useApp();
  const cardRef = useRef<HTMLElement | null>(null);
  const [exporting, setExporting] = useState(false);

  const student = useQuery<Student | null>({
    queryKey: ["report-student", studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, admission_number, class_id, user_id")
        .eq("id", studentId)
        .maybeSingle();
      return (data as Student) ?? null;
    },
  });

  const studentName = useQuery<string | null>({
    queryKey: ["report-student-name", student.data?.user_id],
    enabled: !!student.data?.user_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", student.data!.user_id!)
        .maybeSingle();
      return (data?.full_name as string) ?? null;
    },
  });

  const grades = useQuery<Grade[]>({
    queryKey: ["report-grades", studentId, term, academicYear],
    enabled: !!studentId,
    queryFn: async () => {
      let q = supabase
        .from("grades")
        .select(
          "id, subject, ca_score, exam_score, total_score, grade, grade_remark, term, academic_year, credit_units, grade_point",
        )
        .eq("student_id", studentId)
        .eq("is_published", true)
        .order("subject", { ascending: true });
      if (term) q = q.eq("term", term);
      if (academicYear) q = q.eq("academic_year", academicYear);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as Grade[];
    },
  });

  const attendance = useQuery<AttendanceRow[]>({
    queryKey: ["report-attendance", studentId],
    enabled: !!studentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("status")
        .eq("student_id", studentId);
      if (error) throw new Error(error.message);
      return (data ?? []) as AttendanceRow[];
    },
  });

  const summary = useMemo(() => {
    const rows = grades.data ?? [];
    const scored = rows.filter((r) => r.total_score != null);
    const total = scored.reduce((a, r) => a + Number(r.total_score), 0);
    const avg = scored.length ? total / scored.length : 0;
    // SHERIVS-016: tertiary results carry credit units + grade points -> GPA.
    const gpa = computeGpa(
      rows.map((r) => ({
        courseCode: r.subject,
        creditUnits: r.credit_units,
        gradePoint: r.grade_point,
      })),
    );
    return { count: rows.length, total, avg, gpa };
  }, [grades.data]);

  const attendanceStats = useMemo(() => {
    const rows = attendance.data ?? [];
    const counts = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const r of rows) {
      const k = (r.status ?? "").toLowerCase() as keyof typeof counts;
      if (k in counts) counts[k]++;
    }
    const total = rows.length;
    const rate = total ? Math.round((counts.present / total) * 100) : 0;
    return {
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
      excused: counts.excused,
      total,
      rate,
    };
  }, [attendance.data]);

  async function downloadPdf() {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);
      const canvas = await html2canvas(cardRef.current, { scale: 2, backgroundColor: "#ffffff" });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      pdf.addImage(img, "PNG", (pageW - w) / 2, 20, w, h);
      const name = (studentName.data ?? "student").replace(/\s+/g, "_").toLowerCase();
      pdf.save(`report-card-${name}.pdf`);
    } finally {
      setExporting(false);
    }
  }

  if (grades.isLoading || student.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading report card…</p>;
  }

  return (
    <article ref={cardRef} className="uos-card p-6 print:border-0 print:shadow-none">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="font-display text-xl font-bold">
            {school?.name ?? "School"} — Report Card
          </h2>
          <p className="text-sm text-muted-foreground">
            {studentName.data ?? "Student"} · Admission #{student.data?.admission_number ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {[term, academicYear].filter(Boolean).join(" · ") || "All terms"}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted/40"
          >
            Print
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={exporting}
            className="rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20 disabled:opacity-60"
          >
            {exporting ? "Exporting…" : "Download PDF"}
          </button>
        </div>
      </header>

      {(grades.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          No published grades yet for this period. Check back after your teacher publishes them.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Subject</th>
                  <th className="px-3 py-2 text-right">CA</th>
                  <th className="px-3 py-2 text-right">Exam</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Grade</th>
                  <th className="px-3 py-2 text-left">Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {grades.data!.map((g) => (
                  <tr key={g.id}>
                    <td className="px-3 py-2 font-medium">{g.subject}</td>
                    <td className="px-3 py-2 text-right font-mono">{g.ca_score ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{g.exam_score ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{g.total_score ?? "—"}</td>
                    <td className="px-3 py-2 font-semibold">{g.grade ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {g.grade_remark ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Subjects</p>
              <p className="font-display text-lg font-bold">{summary.count}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Total points</p>
              <p className="font-display text-lg font-bold">{summary.total.toFixed(1)}</p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                {summary.gpa.gpa != null ? "GPA" : "Average"}
              </p>
              <p className="font-display text-lg font-bold">
                {summary.gpa.gpa != null
                  ? `${summary.gpa.gpa.toFixed(2)} (${summary.gpa.units} units)`
                  : summary.avg.toFixed(1)}
              </p>
            </div>
          </div>
        </>
      )}

      <section className="mt-6 border-t border-border pt-4">
        <h3 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
          Attendance summary
        </h3>
        {attendanceStats.total === 0 ? (
          <p className="text-sm text-muted-foreground">No attendance records yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            <Stat label="Present" value={attendanceStats.present} />
            <Stat label="Absent" value={attendanceStats.absent} />
            <Stat label="Late" value={attendanceStats.late} />
            <Stat label="Excused" value={attendanceStats.excused} />
            <Stat label="Rate" value={`${attendanceStats.rate}%`} highlight />
          </div>
        )}
      </section>
    </article>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border p-3 " + (highlight ? "border-primary bg-primary/10" : "border-border")
      }
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-lg font-bold">{value}</p>
    </div>
  );
}
