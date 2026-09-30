import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, AlertTriangle, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/teacher/class-intelligence")({
  ssr: false,
  component: ClassIntelligence,
});

type Klass = { id: string; name: string; grade_level: string | null };

function ClassIntelligence() {
  const { school, profile } = useApp();
  const teacherId = profile?.id;
  const schoolId = school?.id;
  const [selected, setSelected] = useState<string | null>(null);

  const myClasses = useQuery<Klass[]>({
    queryKey: ["teacher-ci-classes", teacherId, schoolId],
    enabled: !!teacherId && !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("classes")
        .select("id, name, grade_level")
        .eq("school_id", schoolId!)
        .eq("teacher_id", teacherId!);
      return (data ?? []) as Klass[];
    },
  });

  const classIds = (myClasses.data ?? []).map((c) => c.id);

  const bulk = useQuery({
    queryKey: ["teacher-ci-bulk", classIds.join(",")],
    enabled: classIds.length > 0,
    queryFn: async () => {
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [students, grades, attendance] = await Promise.all([
        supabase
          .from("students")
          .select("id, class_id, user_id, admission_number")
          .in("class_id", classIds),
        supabase
          .from("grades")
          .select("class_id, student_id, total_score")
          .in("class_id", classIds)
          .eq("is_published", true),
        supabase
          .from("attendance")
          .select("class_id, student_id, status")
          .in("class_id", classIds)
          .gte("date", monthAgo),
      ]);
      const uids = (students.data ?? []).map((s) => s.user_id as string).filter(Boolean);
      const nm = new Map<string, string>();
      if (uids.length) {
        const { data: users } = await supabase.from("users").select("id, full_name").in("id", uids);
        (users ?? []).forEach((u) => nm.set(u.id as string, (u.full_name as string) ?? ""));
      }
      return {
        students: (students.data ?? []).map((s) => ({
          id: s.id as string,
          class_id: (s.class_id as string) ?? null,
          admission_number: (s.admission_number as string) ?? null,
          name: nm.get(s.user_id as string) ?? "Student",
        })),
        grades: (grades.data ?? []) as {
          class_id: string | null;
          student_id: string;
          total_score: number | null;
        }[],
        attendance: (attendance.data ?? []) as {
          class_id: string | null;
          student_id: string;
          status: string;
        }[],
      };
    },
  });

  const classStats = useMemo(() => {
    if (!bulk.data) return [];
    return (myClasses.data ?? []).map((c) => {
      const st = bulk.data.students.filter((s) => s.class_id === c.id);
      const g = bulk.data.grades.filter((r) => r.class_id === c.id);
      const avg = g.length
        ? g.reduce((a, r) => a + Number(r.total_score ?? 0), 0) / g.length
        : null;
      const a = bulk.data.attendance.filter((r) => r.class_id === c.id);
      const present = a.filter((r) => r.status === "present" || r.status === "late").length;
      const rate = a.length ? Math.round((present / a.length) * 100) : null;
      const studentRisk = st.map((s) => {
        const sg = g.filter((r) => r.student_id === s.id);
        const savg = sg.length
          ? sg.reduce((x, r) => x + Number(r.total_score ?? 0), 0) / sg.length
          : null;
        const sa = a.filter((r) => r.student_id === s.id);
        const sp = sa.filter((r) => r.status === "present" || r.status === "late").length;
        const srate = sa.length ? Math.round((sp / sa.length) * 100) : null;
        const attScore = srate ?? 100;
        const grScore = savg ?? 60;
        const feeScore = 100;
        const risk = Math.max(
          0,
          Math.min(100, 100 - (attScore * 0.4 + grScore * 0.35 + feeScore * 0.25)),
        );
        return { ...s, avg: savg, rate: srate, risk };
      });
      const atRisk = studentRisk.filter((s) => s.risk > 60).length;
      const top = [...studentRisk]
        .filter((s) => s.avg != null)
        .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))
        .slice(0, 3);
      return { ...c, studentCount: st.length, avg, rate, atRisk, top, studentRisk };
    });
  }, [bulk.data, myClasses.data]);

  const selectedClass = classStats.find((c) => c.id === selected);

  return (
    <PortalPage title="My Classes" subtitle="Student analytics for every class you teach">
      {selectedClass ? (
        <>
          <button
            onClick={() => setSelected(null)}
            className="mb-4 inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> Back to classes
          </button>
          <div className="uos-card p-5">
            <h2 className="font-display text-xl">{selectedClass.name}</h2>
            <p className="text-xs text-muted-foreground">
              {selectedClass.grade_level ?? ""} · {selectedClass.studentCount} students
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-md border border-border p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Grade avg</p>
                <p className="font-mono">
                  {selectedClass.avg == null ? "—" : `${selectedClass.avg.toFixed(1)}%`}
                </p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-[10px] uppercase text-muted-foreground">Attendance</p>
                <p className="font-mono">
                  {selectedClass.rate == null ? "—" : `${selectedClass.rate}%`}
                </p>
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-[10px] uppercase text-muted-foreground">At risk</p>
                <p className="font-mono text-rose-400">{selectedClass.atRisk}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 uos-card">
            <header className="border-b border-border p-4">
              <h3 className="font-display text-base">Students</h3>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Adm #</th>
                    <th className="p-3">Attendance</th>
                    <th className="p-3">Grade avg</th>
                    <th className="p-3">Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selectedClass.studentRisk
                    .sort((a, b) => b.risk - a.risk)
                    .map((s) => {
                      const level =
                        s.risk > 75
                          ? { label: "Critical", cls: "bg-rose-500/15 text-rose-300" }
                          : s.risk > 60
                            ? { label: "High", cls: "bg-amber-500/15 text-amber-300" }
                            : s.risk > 40
                              ? { label: "Medium", cls: "bg-yellow-500/15 text-yellow-300" }
                              : { label: "Low", cls: "bg-emerald-500/15 text-emerald-300" };
                      return (
                        <tr key={s.id}>
                          <td className="p-3 font-medium">{s.name}</td>
                          <td className="p-3 text-muted-foreground">{s.admission_number ?? "—"}</td>
                          <td className="p-3 font-mono">{s.rate == null ? "—" : `${s.rate}%`}</td>
                          <td className="p-3 font-mono">
                            {s.avg == null ? "—" : `${s.avg.toFixed(0)}%`}
                          </td>
                          <td className="p-3">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${level.cls}`}
                            >
                              {level.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <>
          {classStats.length === 0 ? (
            <div className="uos-card p-8 text-center text-sm text-muted-foreground">
              You aren't assigned to any classes yet.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {classStats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className="uos-card p-5 text-left hover:border-primary/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-display text-base">{c.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {c.grade_level ?? ""} · {c.studentCount} students
                      </p>
                    </div>
                    {c.atRisk > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">
                        <AlertTriangle className="h-3 w-3" /> {c.atRisk}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border border-border p-2">
                      <p className="text-[10px] uppercase text-muted-foreground">Grade avg</p>
                      <p className="font-mono">{c.avg == null ? "—" : `${c.avg.toFixed(0)}%`}</p>
                    </div>
                    <div className="rounded-md border border-border p-2">
                      <p className="text-[10px] uppercase text-muted-foreground">Attendance</p>
                      <p className="font-mono">{c.rate == null ? "—" : `${c.rate}%`}</p>
                    </div>
                  </div>
                  {c.top.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                        <Trophy className="h-3 w-3" /> Top performers
                      </p>
                      <ul className="mt-1 text-xs space-y-0.5">
                        {c.top.map((s) => (
                          <li key={s.id} className="flex justify-between">
                            <span className="truncate">{s.name}</span>
                            <span className="font-mono text-muted-foreground">
                              {s.avg?.toFixed(0)}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </PortalPage>
  );
}
