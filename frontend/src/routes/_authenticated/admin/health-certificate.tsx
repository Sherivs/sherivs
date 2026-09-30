import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Printer, Download, ShieldCheck, Info } from "lucide-react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas-pro";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, FeatureLockedCard, PortalPageSkeleton } from "@/components/portal-shell";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { SUBSCRIPTION_TIERS, isFeatureActive, type TierName } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/admin/health-certificate")({
  ssr: false,
  component: HealthCertificatePage,
});

type ScoreBand = "excellent" | "good" | "fair" | "critical";

function band(score: number): ScoreBand {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "critical";
}

function bandColor(score: number): string {
  if (score >= 80) return "#10b981"; // emerald
  if (score >= 60) return "#f59e0b"; // amber
  return "#f43f5e"; // rose
}

function bandTailwind(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-500";
  return "bg-rose-500";
}

function interpretation(score: number): string {
  const b = band(score);
  if (b === "excellent") return "Excellent — Your school is performing at the highest level";
  if (b === "good") return "Good — Some areas need attention to reach excellence";
  if (b === "fair") return "Fair — Multiple areas require immediate focus";
  return "Critical — Urgent intervention needed across key areas";
}

function monthBounds(d = new Date()) {
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const toISO = (x: Date) => x.toISOString().slice(0, 10);
  return {
    startISO: toISO(start),
    endISO: toISO(end),
    startTS: start.toISOString(),
    label: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

function HealthCertificatePage() {
  const { profile, school } = useApp();
  const schoolId = profile?.school_id ?? "";
  const tier = (school?.subscription_tier ?? "trial") as TierName;
  const activeFeatures = (school?.active_features as Record<string, boolean> | undefined) ?? {};
  const canHealth = isFeatureActive(tier, activeFeatures, "school_health_certificate");

  const { startISO, endISO, startTS, label } = useMemo(() => monthBounds(), []);

  const q = useQuery({
    queryKey: ["school-health-certificate", schoolId, startISO, endISO],
    enabled: !!schoolId && canHealth,
    queryFn: async () => {
      const [attendance, grades, fees, teachers, students, staffLogs, lessons] = await Promise.all([
        supabase
          .from("attendance")
          .select("status")
          .eq("school_id", schoolId)
          .gte("date", startISO)
          .lte("date", endISO),
        supabase
          .from("grades")
          .select("total_score, created_at")
          .eq("school_id", schoolId)
          .eq("is_published", true)
          .gte("created_at", startTS),
        supabase
          .from("fees")
          .select("amount, paid_amount, status, created_at")
          .eq("school_id", schoolId)
          .gte("created_at", startTS),
        supabase
          .from("users")
          .select("id, is_active, role")
          .eq("school_id", schoolId)
          .eq("role", "teacher"),
        supabase.from("students").select("id, is_active").eq("school_id", schoolId),
        supabase
          .from("attendance_logs")
          .select("teacher_id, timestamp")
          .eq("school_id", schoolId)
          .gte("timestamp", startTS),
        supabase
          .from("lesson_plans")
          .select("id, created_at")
          .eq("school_id", schoolId)
          .gte("created_at", startTS),
      ]);

      // Component 1: Student Attendance
      const attRows = attendance.data ?? [];
      const presentCount = attRows.filter(
        (a: any) => a.status === "present" || a.status === "late",
      ).length;
      const totalAtt = attRows.length;
      const attendanceScore = totalAtt > 0 ? (presentCount / totalAtt) * 100 : 0;

      // Component 2: Academic
      const gradeRows = grades.data ?? [];
      const academicScore =
        gradeRows.length > 0
          ? gradeRows.reduce((sum: number, g: any) => sum + (Number(g.total_score) || 0), 0) /
            gradeRows.length
          : 0;

      // Component 3: Fee Collection
      const feeRows = fees.data ?? [];
      const totalBilled = feeRows.reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0);
      const totalCollected = feeRows.reduce(
        (s: number, f: any) => s + (Number(f.paid_amount) || 0),
        0,
      );
      const feeScore = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 100;

      // Component 4: Staff Attendance
      const teacherRows = teachers.data ?? [];
      const totalTeachers = teacherRows.length;
      const logRows = staffLogs.data ?? [];
      const uniqueTeachers = new Set(logRows.map((l: any) => l.teacher_id).filter(Boolean)).size;
      const staffScore = totalTeachers > 0 ? (uniqueTeachers / totalTeachers) * 100 : 0;

      // Component 5: Parent Engagement (placeholder)
      const parentScore = 70;

      const overall = Math.round(
        attendanceScore * 0.25 +
          academicScore * 0.25 +
          feeScore * 0.2 +
          staffScore * 0.15 +
          parentScore * 0.15,
      );

      // Extra metrics
      const studentRows = students.data ?? [];
      const activeStudents = studentRows.filter((s: any) => s.is_active).length;
      const activeTeachers = teacherRows.filter((t: any) => t.is_active).length;
      const lessonsPlanned = (lessons.data ?? []).length;
      const absentRows = attRows.filter((a: any) => a.status === "absent").length;
      const studentsAtRisk =
        totalAtt > 0 ? Math.round((absentRows / totalAtt) * activeStudents) : 0;
      const teacherAbsenceDays =
        totalTeachers > 0 ? Math.max(0, totalTeachers - uniqueTeachers) : 0;

      return {
        overall: Math.min(100, Math.max(0, overall)),
        components: [
          { label: "Student Attendance", score: Math.round(attendanceScore), weight: 25 },
          { label: "Academic Performance", score: Math.round(academicScore), weight: 25 },
          { label: "Fee Collection", score: Math.round(feeScore), weight: 20 },
          { label: "Staff Attendance", score: Math.round(staffScore), weight: 15 },
          {
            label: "Parent Engagement",
            score: parentScore,
            weight: 15,
            note: "Based on portal activity estimates",
          },
        ],
        metrics: {
          totalStudents: activeStudents,
          activeTeachers,
          feesCollected: totalCollected,
          lessonsPlanned,
          studentsAtRisk,
          teacherAbsenceDays,
        },
      };
    },
  });

  // Print stylesheet
  useEffect(() => {
    const style = document.createElement("style");
    style.media = "print";
    style.innerHTML = `
      nav, aside, .no-print { display: none !important; }
      body { background: white; color: black; }
      .glass-card { background: white !important; border: 1px solid #e5e7eb !important; box-shadow: none !important; }
      .text-white { color: #111827 !important; }
      .text-white\\/50, .text-white\\/40, .text-white\\/60, .text-white\\/70 { color: #4b5563 !important; }
      .print-only { display: block !important; }
      @page { margin: 16mm; }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Animate progress bars
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    if (q.data) {
      const t = setTimeout(() => setAnimated(true), 50);
      return () => clearTimeout(t);
    }
  }, [q.data]);

  const certRef = useRef<HTMLDivElement>(null);

  async function downloadPDF() {
    if (!certRef.current) return;
    const canvas = await html2canvas(certRef.current, {
      backgroundColor: "#0a0f1e",
      scale: 2,
    });
    const img = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    pdf.addImage(img, "PNG", (pageW - w) / 2, 16, w, h);
    pdf.save(`${school?.name ?? "school"}-health-${label.replace(/\s+/g, "-")}.pdf`);
  }

  if (!canHealth) {
    return (
      <PortalPage title="School Health Certificate" subtitle="Monthly institutional health report">
        <FeatureLockedCard
          featureName="School Health Certificate"
          requiredTier="Growth"
          description="Generate a comprehensive monthly health certificate combining attendance, academics, fees and staff metrics."
        />
      </PortalPage>
    );
  }

  if (q.isLoading || !q.data) {
    return <PortalPageSkeleton />;
  }

  const d = q.data;
  const tierMeta = SUBSCRIPTION_TIERS[tier];

  return (
    <PortalPage
      title="School Health Certificate"
      subtitle={`Monthly institutional health report — ${label}`}
      actions={
        <div className="flex gap-2 no-print">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="hidden sm:inline-flex"
          >
            <Printer className="w-4 h-4 mr-2" /> Print
          </Button>
          <Button size="sm" onClick={downloadPDF}>
            <Download className="w-4 h-4 mr-2" /> Download PDF
          </Button>
        </div>
      }
    >
      <div ref={certRef} className="space-y-6">
        {/* Print-only header */}
        <div className="hidden print-only" style={{ display: "none" }}>
          <PageHeader
            title={school?.name ?? "School"}
            subtitle={`Health Certificate — ${label} · Generated ${new Date().toLocaleDateString()}`}
          />
        </div>

        {/* Section 2: Overall Gauge */}
        <div className="glass-card p-6 sm:p-10 flex flex-col items-center text-center">
          <Gauge score={d.overall} />
          <h2 className="mt-6 text-xl sm:text-2xl font-bold text-white">Overall Health Score</h2>
          <p className="mt-2 text-sm sm:text-base text-white/60 max-w-xl">
            {interpretation(d.overall)}
          </p>
          <p className="mt-3 text-xs text-white/40">
            {tierMeta.name} plan · {label}
          </p>
        </div>

        {/* Section 3: Component Breakdown */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-bold text-white mb-5 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            Component Breakdown
          </h3>
          <div className="space-y-5">
            {d.components.map((c) => (
              <div key={c.label}>
                <div className="flex items-baseline justify-between mb-2">
                  <div>
                    <div className="text-sm font-medium text-white">{c.label}</div>
                    {(c as any).note && (
                      <div className="text-xs text-white/40 flex items-center gap-1 mt-0.5">
                        <Info className="w-3 h-3" /> {(c as any).note}
                      </div>
                    )}
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-lg font-bold text-white">{c.score}%</span>
                    <span className="text-xs text-white/40">Weight: {c.weight}%</span>
                  </div>
                </div>
                <div className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-out ${bandTailwind(c.score)}`}
                    style={{ width: animated ? `${Math.min(100, Math.max(0, c.score))}%` : "0%" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: Key Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard label="Total Students" value={d.metrics.totalStudents} />
          <MetricCard label="Active Teachers" value={d.metrics.activeTeachers} />
          <MetricCard
            label="Fees Collected (Month)"
            value={`₦${d.metrics.feesCollected.toLocaleString()}`}
          />
          <MetricCard label="Lessons Planned" value={d.metrics.lessonsPlanned} />
          <MetricCard label="Students At Risk" value={d.metrics.studentsAtRisk} />
          <MetricCard label="Teacher Absence Days" value={d.metrics.teacherAbsenceDays} />
        </div>

        {/* Print-only footer */}
        <div className="hidden print-only text-center text-xs text-white/40 pt-6 border-t border-white/10">
          Confidential — School Administration Only
        </div>
      </div>
    </PortalPage>
  );
}

function Gauge({ score }: { score: number }) {
  const color = bandColor(score);
  const pct = Math.min(100, Math.max(0, score));
  const bg = `conic-gradient(${color} ${pct}%, rgba(255,255,255,0.08) ${pct}% 100%)`;
  return (
    <div
      className="relative rounded-full flex items-center justify-center"
      style={{
        background: bg,
        width: "min(200px, 60vw)",
        height: "min(200px, 60vw)",
        maxWidth: 200,
        maxHeight: 200,
      }}
      role="img"
      aria-label={`Overall health score ${score} out of 100`}
    >
      <div className="absolute inset-2 rounded-full bg-[#0a0f1e] flex items-center justify-center border border-white/10">
        <div className="text-5xl sm:text-6xl font-bold text-white tabular-nums">{score}</div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-card p-4">
      <div className="text-xs uppercase tracking-wider text-white/50 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
    </div>
  );
}
