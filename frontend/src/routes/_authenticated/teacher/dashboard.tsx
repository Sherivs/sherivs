import { createFileRoute, Link } from "@tanstack/react-router";
import { SkeletonDashboard } from "@/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { PreviewPublicSiteCard } from "@/components/preview-public-site";
import { AnnouncementsFeed } from "@/components/announcements-feed";
import {
  QrCode,
  Award,
  CalendarCheck,
  FileText,
  AlertTriangle,
  Clock,
  ArrowRight,
  Bot,
  BookOpen,
  Users2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/teacher/dashboard")({
  ssr: false,
  component: TeacherDashboard,
});

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

type Slot = {
  id?: string;
  period_number: number | null;
  start_time: string;
  end_time: string;
  subject: string | null;
  room: string | null;
};

function toMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function TeacherDashboard() {
  const { school, profile } = useApp();
  const teacherId = profile?.id;
  const schoolId = school?.id;

  const today = new Date();
  const todayDay = DAYS[today.getDay()];
  const todayIso = today.toISOString().slice(0, 10);
  const nowMin = today.getHours() * 60 + today.getMinutes();

  const signIn = useQuery({
    queryKey: ["teacher-signin-today", schoolId, teacherId, todayIso],
    enabled: !!schoolId && !!teacherId,
    queryFn: async () => {
      const start = `${todayIso}T00:00:00.000Z`;
      const end = `${todayIso}T23:59:59.999Z`;
      const { data } = await supabase
        .from("attendance_logs")
        .select("id, type, timestamp, verified")
        .eq("school_id", schoolId!)
        .eq("teacher_id", teacherId!)
        .gte("timestamp", start)
        .lte("timestamp", end)
        .order("timestamp", { ascending: true });
      return (data ?? []) as {
        id: string;
        type: string;
        timestamp: string;
        verified: boolean | null;
      }[];
    },
  });

  const classesToday = useQuery<Slot[]>({
    queryKey: ["teacher-classes-today", teacherId, todayDay],
    enabled: !!teacherId,
    queryFn: async () => {
      const { data } = await supabase
        .from("timetable_slots")
        .select("id, period_number, start_time, end_time, subject, room")
        .eq("teacher_id", teacherId!)
        .eq("day_of_week", todayDay)
        .eq("is_break", false)
        .order("period_number", { ascending: true });
      return (data ?? []) as Slot[];
    },
  });

  const myClasses = useQuery({
    queryKey: ["teacher-my-classes", teacherId, schoolId],
    enabled: !!teacherId && !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("classes")
        .select("id, name, grade_level")
        .eq("school_id", schoolId!)
        .eq("teacher_id", teacherId!);
      return (data ?? []) as { id: string; name: string; grade_level: string | null }[];
    },
  });

  const classIds = (myClasses.data ?? []).map((c) => c.id);

  const perfData = useQuery({
    queryKey: ["teacher-class-perf", classIds.join(",")],
    enabled: classIds.length > 0,
    queryFn: async () => {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const [grades, attWeek, attMonth, students] = await Promise.all([
        supabase
          .from("grades")
          .select("class_id, total_score, student_id")
          .in("class_id", classIds)
          .eq("is_published", true),
        supabase
          .from("attendance")
          .select("class_id, status")
          .in("class_id", classIds)
          .gte("date", weekAgo),
        supabase
          .from("attendance")
          .select("student_id, status")
          .in("class_id", classIds)
          .gte("date", monthAgo),
        supabase.from("students").select("id, class_id, user_id").in("class_id", classIds),
      ]);
      return {
        grades: (grades.data ?? []) as {
          class_id: string | null;
          total_score: number | null;
          student_id: string;
        }[],
        attWeek: (attWeek.data ?? []) as { class_id: string | null; status: string }[],
        attMonth: (attMonth.data ?? []) as { student_id: string; status: string }[],
        students: (students.data ?? []) as {
          id: string;
          class_id: string | null;
          user_id: string;
        }[],
      };
    },
  });

  const plans = useQuery({
    queryKey: ["teacher-pending-plans", schoolId, teacherId],
    enabled: !!schoolId && !!teacherId,
    queryFn: async () => {
      const { data } = await supabase
        .from("lesson_plans")
        .select("id, title, subject, date_planned, status")
        .eq("school_id", schoolId!)
        .eq("teacher_id", teacherId!)
        .in("status", ["draft", "needs_revision"])
        .order("date_planned", { ascending: true, nullsFirst: false })
        .limit(5);
      return (data ?? []) as {
        id: string;
        title: string;
        subject: string | null;
        date_planned: string | null;
        status: string;
      }[];
    },
  });

  const unreadMsg = useQuery({
    queryKey: ["teacher-unread-msg", teacherId],
    enabled: !!teacherId,
    queryFn: async () => {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", teacherId!)
        .eq("is_read", false);
      return count ?? 0;
    },
  });

  const perClass = useMemo(() => {
    const d = perfData.data;
    if (!d) return [];
    return (myClasses.data ?? []).map((c) => {
      const g = d.grades.filter((r) => r.class_id === c.id);
      const avg = g.length
        ? g.reduce((a, r) => a + Number(r.total_score ?? 0), 0) / g.length
        : null;
      const a = d.attWeek.filter((r) => r.class_id === c.id);
      const present = a.filter((r) => r.status === "present" || r.status === "late").length;
      const rate = a.length ? Math.round((present / a.length) * 100) : null;
      const studCount = d.students.filter((s) => s.class_id === c.id).length;
      const tone = avg == null ? "slate" : avg >= 70 ? "green" : avg >= 50 ? "amber" : "red";
      return { ...c, avg, rate, studCount, tone };
    });
  }, [perfData.data, myClasses.data]);

  const atRisk = useMemo(() => {
    const d = perfData.data;
    if (!d) return [];
    const attByStudent = new Map<string, { p: number; t: number }>();
    d.attMonth.forEach((r) => {
      const cur = attByStudent.get(r.student_id) ?? { p: 0, t: 0 };
      cur.t += 1;
      if (r.status === "present" || r.status === "late") cur.p += 1;
      attByStudent.set(r.student_id, cur);
    });
    const gradeByStudent = new Map<string, { s: number; n: number }>();
    d.grades.forEach((r) => {
      const cur = gradeByStudent.get(r.student_id) ?? { s: 0, n: 0 };
      cur.s += Number(r.total_score ?? 0);
      cur.n += 1;
      gradeByStudent.set(r.student_id, cur);
    });
    const risk: { student_id: string; attRate: number | null; avg: number | null }[] = [];
    d.students.forEach((s) => {
      const a = attByStudent.get(s.id);
      const g = gradeByStudent.get(s.id);
      const attRate = a && a.t > 0 ? Math.round((a.p / a.t) * 100) : null;
      const avg = g && g.n > 0 ? g.s / g.n : null;
      if ((attRate != null && attRate < 70) || (avg != null && avg < 50)) {
        risk.push({ student_id: s.id, attRate, avg });
      }
    });
    return risk.slice(0, 8);
  }, [perfData.data]);

  const atRiskNames = useQuery({
    queryKey: ["teacher-risk-names", atRisk.map((r) => r.student_id).join(",")],
    enabled: atRisk.length > 0,
    queryFn: async () => {
      const sids = atRisk.map((r) => r.student_id);
      const { data: students } = await supabase
        .from("students")
        .select("id, user_id, admission_number")
        .in("id", sids);
      const uids = (students ?? []).map((s) => s.user_id as string).filter(Boolean);
      const { data: users } = await supabase.from("users").select("id, full_name").in("id", uids);
      const nm = new Map<string, string>();
      (users ?? []).forEach((u) => nm.set(u.id as string, (u.full_name as string) ?? ""));
      const map = new Map<string, { name: string; adm: string | null }>();
      (students ?? []).forEach((s) =>
        map.set(s.id as string, {
          name: nm.get(s.user_id as string) ?? "Student",
          adm: (s.admission_number as string) ?? null,
        }),
      );
      return map;
    },
  });

  const nameFor = (id: string) => atRiskNames.data?.get(id)?.name ?? "Student";

  const signInLog = signIn.data?.find((l) => l.type === "sign_in");
  const signOutLog = signIn.data?.find((l) => l.type === "sign_out");
  const currentPeriod = classesToday.data?.find(
    (s) => nowMin >= toMinutes(s.start_time) && nowMin < toMinutes(s.end_time),
  );
  const nextPeriod = classesToday.data?.find((s) => nowMin < toMinutes(s.start_time));

  const pendingGrades = useMemo(() => {
    if (!classesToday.data || !perfData.data) return 0;
    const passed = classesToday.data.filter((s) => nowMin >= toMinutes(s.end_time));
    return passed.length;
  }, [classesToday.data, perfData.data, nowMin]);

  if (signIn.isLoading) return <SkeletonDashboard />;

  return (
    <PortalPage
      title={`Welcome, ${profile?.full_name?.split(" ")[0] ?? "Teacher"}`}
      subtitle="Your teaching command center"
    >
      <PreviewPublicSiteCard />

      {/* Quick actions */}
      <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <QuickAction
          to="/teacher/attendance"
          icon={<QrCode className="h-4 w-4" />}
          label="Mark Attendance"
        />
        <QuickAction
          to="/teacher/grades"
          icon={<Award className="h-4 w-4" />}
          label="Enter Grades"
        />
        <QuickAction
          to="/teacher/timetable"
          icon={<CalendarCheck className="h-4 w-4" />}
          label="View Timetable"
        />
        <QuickAction
          to="/teacher/lesson-plans"
          icon={<FileText className="h-4 w-4" />}
          label="Lesson Plan"
        />
      </div>

      <SectionGrid>
        <StatCard
          label="Sign-in today"
          value={
            signInLog
              ? new Date(signInLog.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"
          }
          hint={signInLog?.verified ? "Verified" : signInLog ? "Pending" : "Not signed in"}
        />
        <StatCard
          label="Sign-out"
          value={
            signOutLog
              ? new Date(signOutLog.timestamp).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"
          }
          hint={signOutLog ? "Recorded" : "Open"}
        />
        <StatCard label="Classes today" value={classesToday.data?.length ?? 0} hint={todayDay} />
        <StatCard
          label="My classes"
          value={myClasses.data?.length ?? 0}
          hint={`${perClass.reduce((a, c) => a + c.studCount, 0)} students`}
        />
      </SectionGrid>

      {/* Today's Schedule timeline */}
      <div className="mt-6 uos-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-display text-base">Today's schedule</h2>
          </div>
          <Link to="/teacher/timetable" className="text-xs text-primary hover:underline">
            Full timetable
          </Link>
        </div>
        {(classesToday.data?.length ?? 0) === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No classes scheduled today.</p>
        ) : (
          <>
            <div className="mt-4 space-y-2">
              {classesToday.data!.map((s, i) => {
                const active = currentPeriod && s.start_time === currentPeriod.start_time;
                const passed = nowMin >= toMinutes(s.end_time);
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-all ${
                      active
                        ? "border-primary bg-primary/10 shadow-md"
                        : passed
                          ? "border-border/40 opacity-60"
                          : "border-border"
                    }`}
                  >
                    <div className="font-mono text-xs text-muted-foreground w-24">
                      {String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{s.subject ?? "Class"}</p>
                      {s.room && <p className="text-xs text-muted-foreground">Room {s.room}</p>}
                    </div>
                    {active && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary-foreground">
                        Now
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {nextPeriod && !currentPeriod && (
              <p className="mt-3 text-xs text-muted-foreground">
                Next: <span className="text-foreground font-medium">{nextPeriod.subject}</span> at{" "}
                {String(nextPeriod.start_time).slice(0, 5)}
              </p>
            )}
          </>
        )}
      </div>

      {/* Class Performance + At-risk */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="uos-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-display text-base">Class performance</h2>
            </div>
            <Link
              to="/teacher/class-intelligence"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              Details <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {perClass.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No classes assigned yet.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {perClass.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-border p-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        c.tone === "green"
                          ? "bg-emerald-500"
                          : c.tone === "amber"
                            ? "bg-amber-500"
                            : c.tone === "red"
                              ? "bg-rose-500"
                              : "bg-muted"
                      }`}
                    />
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">{c.studCount} students</p>
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <p>
                      Grade avg:{" "}
                      <span className="font-mono text-foreground">
                        {c.avg == null ? "—" : `${c.avg.toFixed(0)}%`}
                      </span>
                    </p>
                    <p>
                      Attendance:{" "}
                      <span className="font-mono text-foreground">
                        {c.rate == null ? "—" : `${c.rate}%`}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="uos-card p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-400" />
            <h2 className="font-display text-base">At-risk students</h2>
          </div>
          {atRisk.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No students currently flagged. 🎉</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {atRisk.map((r) => (
                <li
                  key={r.student_id}
                  className="flex items-center justify-between rounded-md border border-rose-500/20 bg-rose-500/5 p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{nameFor(r.student_id)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.attRate != null && r.attRate < 70 ? `Attendance ${r.attRate}%` : null}
                      {r.attRate != null && r.attRate < 70 && r.avg != null && r.avg < 50
                        ? " · "
                        : null}
                      {r.avg != null && r.avg < 50 ? `Grade avg ${r.avg.toFixed(0)}%` : null}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Pending tasks */}
      <div className="mt-6 uos-card p-5">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display text-base">Pending tasks</h2>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <TaskTile
            count={pendingGrades}
            label="Grades to enter"
            href="/teacher/grades"
            tone="amber"
          />
          <TaskTile
            count={plans.data?.length ?? 0}
            label="Lesson plans open"
            href="/teacher/lesson-plans"
            tone="blue"
          />
          <TaskTile
            count={unreadMsg.data ?? 0}
            label="Unread messages"
            href="/messages"
            tone="rose"
          />
        </div>
      </div>

      {/* AI Assistant teaser */}
      <div className="mt-6 uos-card p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-3 text-primary">
            <Bot className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-base">Teacher AI Assistant</h3>
            <p className="text-xs text-muted-foreground">
              Generate lesson plans, draft parent messages, and analyze class performance.
            </p>
            <Link
              to="/teacher/ai-assistant"
              className="mt-3 inline-flex text-sm text-primary hover:underline items-center gap-1"
            >
              Open assistant <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <AnnouncementsFeed seeAllHref="/teacher/news" />
      </div>
    </PortalPage>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="uos-card flex items-center gap-3 p-3 text-sm font-medium hover:border-primary/40 transition-colors"
    >
      <span className="rounded-md bg-primary/10 p-2 text-primary">{icon}</span>
      {label}
    </Link>
  );
}

function TaskTile({
  count,
  label,
  href,
  tone,
}: {
  count: number;
  label: string;
  href: string;
  tone: "amber" | "blue" | "rose";
}) {
  const cls = {
    amber: "border-amber-500/30 text-amber-300",
    blue: "border-blue-500/30 text-blue-300",
    rose: "border-rose-500/30 text-rose-300",
  }[tone];
  return (
    <Link to={href} className={`rounded-md border p-3 hover:bg-muted/30 ${cls}`}>
      <p className="font-display text-2xl">{count}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Link>
  );
}
