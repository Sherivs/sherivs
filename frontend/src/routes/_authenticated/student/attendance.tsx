import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/student/attendance")({
  ssr: false,
  component: StudentAttendancePage,
});

type Status = "present" | "absent" | "late" | "excused";
type Row = { id: string; date: string; status: Status; note: string | null };

const COLORS: Record<Status, string> = {
  present: "bg-emerald-500/80 text-white",
  absent: "bg-rose-500/80 text-white",
  late: "bg-amber-500/80 text-white",
  excused: "bg-blue-500/80 text-white",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function StudentAttendancePage() {
  const { profile } = useApp();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("id")
        .eq("user_id", profile.id)
        .maybeSingle();
      setStudentId(data?.id ?? null);
    })();
  }, [profile?.id]);

  const monthStart = `${year}-${pad(month + 1)}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${pad(month + 1)}-${pad(lastDay)}`;

  const records = useQuery({
    queryKey: ["student-attendance", studentId, year, month],
    enabled: !!studentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance")
        .select("id, date, status, note")
        .eq("student_id", studentId!)
        .gte("date", monthStart)
        .lte("date", monthEnd)
        .order("date", { ascending: true });
      return (data ?? []) as Row[];
    },
  });

  const byDate = useMemo(() => {
    const m = new Map<string, Row>();
    (records.data ?? []).forEach((r) => m.set(r.date, r));
    return m;
  }, [records.data]);

  const stats = useMemo(() => {
    const rows = records.data ?? [];
    const present = rows.filter((r) => r.status === "present").length;
    const absent = rows.filter((r) => r.status === "absent").length;
    const late = rows.filter((r) => r.status === "late").length;
    const excused = rows.filter((r) => r.status === "excused").length;
    const total = rows.length;
    const rate = total ? Math.round(((present + late) / total) * 100) : 0;
    return { present, absent, late, excused, rate, total };
  }, [records.data]);

  // Calendar grid
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const cells: Array<{ day: number | null; date: string | null; row: Row | null }> = [];
  for (let i = 0; i < firstDow; i += 1) cells.push({ day: null, date: null, row: null });
  for (let d = 1; d <= lastDay; d += 1) {
    const date = `${year}-${pad(month + 1)}-${pad(d)}`;
    cells.push({ day: d, date, row: byDate.get(date) ?? null });
  }

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  };

  if (!studentId && profile?.id) {
    return (
      <PortalPage title="My attendance">
        <div className="uos-card p-6">
          <p className="text-sm text-muted-foreground">
            Your account is not linked to a student record yet. Ask your school admin to link it.
          </p>
        </div>
      </PortalPage>
    );
  }

  return (
    <PortalPage title="My attendance" subtitle="Your day-by-day attendance history.">
      <div className="mb-4 text-xs">
        <Link
          to="/student/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back
        </Link>
      </div>

      <div className="uos-card p-5">
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={prevMonth}>
            ← Prev
          </Button>
          <h2 className="font-display text-lg font-semibold">
            {MONTHS[month]} {year}
          </h2>
          <Button variant="outline" size="sm" onClick={nextMonth}>
            Next →
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs uppercase text-muted-foreground">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((c, i) => (
            <div
              key={i}
              className={`aspect-square rounded-md flex items-center justify-center text-xs font-medium ${
                !c.day ? "" : c.row ? COLORS[c.row.status] : "bg-muted/30 text-muted-foreground"
              }`}
              title={c.row ? `${c.date}: ${c.row.status}` : (c.date ?? "")}
            >
              {c.day ?? ""}
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-3 text-xs">
          <Legend color="bg-emerald-500/80" label="Present" />
          <Legend color="bg-rose-500/80" label="Absent" />
          <Legend color="bg-amber-500/80" label="Late" />
          <Legend color="bg-blue-500/80" label="Excused" />
          <Legend color="bg-muted/30" label="No record" />
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Present" value={stats.present} className="text-emerald-400" />
        <Stat label="Absent" value={stats.absent} className="text-rose-400" />
        <Stat label="Late" value={stats.late} className="text-amber-400" />
        <Stat label="Excused" value={stats.excused} className="text-blue-400" />
        <Stat label="Attendance rate" value={`${stats.rate}%`} />
      </div>

      <div className="uos-card mt-6 p-5">
        <h3 className="font-display text-base font-semibold">
          Records for {MONTHS[month]} {year}
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2">Date</th>
                <th className="py-2">Day</th>
                <th className="py-2">Status</th>
                <th className="py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {(records.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    No attendance records found for this month.
                  </td>
                </tr>
              ) : (
                (records.data ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="py-2 font-mono text-xs">{r.date}</td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(r.date).toLocaleDateString(undefined, { weekday: "long" })}
                    </td>
                    <td className="py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs ${COLORS[r.status]}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">{r.note ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PortalPage>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`size-3 rounded ${color}`} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: number | string;
  className?: string;
}) {
  return (
    <div className="uos-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl font-bold ${className ?? ""}`}>{value}</div>
    </div>
  );
}
