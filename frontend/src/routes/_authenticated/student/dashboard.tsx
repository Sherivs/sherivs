import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, GlassCard, EmptyState, SkeletonLine } from "@/components/portal-shell";
import { PreviewPublicSiteCard } from "@/components/preview-public-site";
import { Button } from "@/components/ui/button";
import {
  Bot,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  GraduationCap,
  Sparkles,
  Wallet,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/student/dashboard")({
  ssr: false,
  component: StudentDashboard,
});

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

type Slot = {
  period_number: number | null;
  start_time: string;
  end_time: string;
  subject: string | null;
  room: string | null;
  is_break: boolean | null;
  break_label: string | null;
};

const PERIOD_COLORS = [
  "border-teal-400/40 bg-teal-400/10 text-teal-200",
  "border-amber-400/40 bg-amber-400/10 text-amber-200",
  "border-sky-400/40 bg-sky-400/10 text-sky-200",
  "border-violet-400/40 bg-violet-400/10 text-violet-200",
  "border-rose-400/40 bg-rose-400/10 text-rose-200",
  "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
];

function toMinutes(t: string | null | undefined) {
  if (!t) return null;
  const [h, m] = String(t).split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function scoreTone(score: number | null) {
  if (score == null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-rose-400";
}

/** Ticking clock in minutes-since-midnight, refreshed every 30s. */
function useNowMinutes() {
  const [now, setNow] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    }, 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function StudentDashboard() {
  const { profile, school } = useApp();
  const userId = profile?.id;
  const schoolId = school?.id ?? profile?.school_id;
  const [studentId, setStudentId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const nowMinutes = useNowMinutes();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("id, class_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!cancelled && data) {
        setStudentId(data.id as string);
        setClassId((data.class_id as string) ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const today = new Date();
  const todayDay = DAYS[today.getDay()];
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const weekAhead = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const todayISO = today.toISOString().slice(0, 10);

  /* ------------------------------ academic health ------------------------ */
  const health = useQuery({
    queryKey: ["student-health", studentId, classId, schoolId, monthStart],
    enabled: !!studentId && !!schoolId,
    queryFn: async () => {
      const [grades, att, plans] = await Promise.all([
        supabase
          .from("grades")
          .select("total_score")
          .eq("school_id", schoolId!)
          .eq("student_id", studentId!)
          .eq("is_published", true),
        supabase
          .from("attendance")
          .select("status")
          .eq("student_id", studentId!)
          .gte("date", monthStart),
        classId
          ? supabase
              .from("lesson_plans")
              .select("id, title, subject, homework_assignment, date_planned")
              .eq("school_id", schoolId!)
              .eq("class_id", classId)
              .not("homework_assignment", "is", null)
              .gte("date_planned", todayISO)
              .lte("date_planned", weekAhead)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);

      const gradeRows = (grades.data ?? []) as { total_score: number | null }[];
      const avg =
        gradeRows.length === 0
          ? null
          : gradeRows.reduce((a, r) => a + Number(r.total_score ?? 0), 0) / gradeRows.length;

      const attRows = (att.data ?? []) as { status: string }[];
      const present = attRows.filter((r) => r.status === "present" || r.status === "late").length;
      const rate = attRows.length === 0 ? null : Math.round((present / attRows.length) * 100);

      return {
        avg,
        rate,
        attCount: attRows.length,
        gradeCount: gradeRows.length,
        assignments: (plans.data ?? []).length,
      };
    },
  });

  /* --------------------------------- today ------------------------------ */
  const timetable = useQuery({
    queryKey: ["student-today", classId, todayDay],
    enabled: !!classId,
    queryFn: async () => {
      const { data: tts } = await supabase
        .from("timetables")
        .select("id")
        .eq("class_id", classId!)
        .eq("published", true)
        .limit(1);
      const ttId = tts?.[0]?.id as string | undefined;
      if (!ttId) return [] as Slot[];
      const { data } = await supabase
        .from("timetable_slots")
        .select("period_number, start_time, end_time, subject, room, is_break, break_label")
        .eq("timetable_id", ttId)
        .eq("day_of_week", todayDay)
        .order("period_number", { ascending: true });
      return (data ?? []) as Slot[];
    },
  });

  const slots = timetable.data ?? [];
  const { currentIndex, nextSlot, minutesToNext } = useMemo(() => {
    let current = -1;
    let next: Slot | null = null;
    slots.forEach((s, i) => {
      const start = toMinutes(s.start_time);
      const end = toMinutes(s.end_time);
      if (start != null && end != null && nowMinutes >= start && nowMinutes < end) current = i;
      if (next === null && start != null && start > nowMinutes) next = s;
    });
    const nextStart = next ? toMinutes((next as Slot).start_time) : null;
    return {
      currentIndex: current,
      nextSlot: next as Slot | null,
      minutesToNext: nextStart == null ? null : nextStart - nowMinutes,
    };
  }, [slots, nowMinutes]);

  /* ------------------------------ recent grades -------------------------- */
  const recentGrades = useQuery({
    queryKey: ["student-recent-grades", studentId, schoolId],
    enabled: !!studentId && !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("grades")
        .select("id, subject, total_score, grade, created_at, term")
        .eq("school_id", schoolId!)
        .eq("student_id", studentId!)
        .eq("is_published", true)
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(5);
      return data ?? [];
    },
  });

  /* ---------------------------------- fees ------------------------------- */
  const fees = useQuery({
    queryKey: ["student-fees", studentId, schoolId],
    enabled: !!studentId && !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("fees")
        .select("amount, paid_amount, status")
        .eq("school_id", schoolId!)
        .eq("student_id", studentId!);
      const rows = (data ?? []) as {
        amount: number;
        paid_amount: number | null;
        status: string | null;
      }[];
      const outstanding = rows
        .filter((f) => f.status !== "paid")
        .reduce((a, f) => a + Number(f.amount) - Number(f.paid_amount ?? 0), 0);
      return { outstanding: Math.max(0, outstanding), count: rows.length };
    },
  });

  /* -------------------------------- events ------------------------------- */
  const events = useQuery({
    queryKey: ["student-events", schoolId, todayISO],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("events")
        .select("id, title, description, event_date, event_time, location")
        .eq("school_id", schoolId!)
        .eq("is_published", true)
        .gte("event_date", todayISO)
        .order("event_date", { ascending: true })
        .limit(3);
      return data ?? [];
    },
  });

  const firstName = profile?.full_name?.split(" ")[0] ?? "Student";

  return (
    <PortalPage
      title={`Welcome, ${firstName}`}
      subtitle="Your personal command center for today"
      actions={
        <Button asChild className="rounded-xl">
          <Link to="/student/ai-tutor">
            <Bot className="mr-2 size-4" /> AI Tutor
          </Link>
        </Button>
      }
    >
      <PreviewPublicSiteCard />

      {!studentId && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          Your account isn't linked to a student record yet. Ask your school admin to link it.
        </div>
      )}

      {/* --------------------------- Today's schedule -------------------- */}
      <GlassCard className="p-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            <h2 className="font-display text-lg font-semibold capitalize">
              Today&apos;s schedule · {todayDay}
            </h2>
          </div>
          {nextSlot && minutesToNext != null && minutesToNext > 0 && (
            <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted/20 px-3 py-1 text-xs">
              <Clock className="size-3.5 text-primary" />
              {nextSlot.is_break ? (nextSlot.break_label ?? "Break") : nextSlot.subject} in{" "}
              {minutesToNext >= 60
                ? `${Math.floor(minutesToNext / 60)}h ${minutesToNext % 60}m`
                : `${minutesToNext}m`}
            </span>
          )}
        </header>

        {!classId ? (
          <p className="p-6 text-sm text-muted-foreground">
            You aren&apos;t assigned to a class yet.
          </p>
        ) : timetable.isLoading ? (
          <div className="space-y-2 p-4">
            <SkeletonLine />
            <SkeletonLine />
            <SkeletonLine />
          </div>
        ) : slots.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            No timetable published for {todayDay} yet.
          </p>
        ) : (
          <ol className="flex gap-3 overflow-x-auto p-4">
            {slots.map((s, i) => {
              const active = i === currentIndex;
              const tone = s.is_break
                ? "border-white/10 bg-white/5 text-muted-foreground"
                : PERIOD_COLORS[i % PERIOD_COLORS.length];
              return (
                <li
                  key={`${s.period_number ?? i}-${s.start_time}`}
                  className={`min-w-[150px] flex-1 rounded-2xl border p-3 transition ${tone} ${
                    active ? "ring-2 ring-primary/70" : ""
                  }`}
                  style={active ? { animation: "pulse-glow 2s ease-in-out infinite" } : undefined}
                >
                  <p className="font-mono text-[11px] opacity-80">
                    {String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold">
                    {s.is_break ? (s.break_label ?? "Break") : s.subject}
                  </p>
                  {s.room && <p className="mt-1 text-[11px] opacity-70">{s.room}</p>}
                  {active && (
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-widest">Now</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </GlassCard>

      {/* --------------------------- Academic health --------------------- */}
      <GlassCard className="p-0">
        <header className="flex items-center gap-2 border-b border-border p-4">
          <GraduationCap className="size-4 text-primary" />
          <h2 className="font-display text-lg font-semibold">Academic health</h2>
        </header>
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Term average</p>
            <p className={`mt-1 text-2xl font-bold ${scoreTone(health.data?.avg ?? null)}`}>
              {health.data?.avg == null ? "—" : `${health.data.avg.toFixed(1)}%`}
            </p>
            <p className="text-xs text-muted-foreground">
              {health.data?.gradeCount ?? 0} published grades
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Attendance this month
            </p>
            <p className={`mt-1 text-2xl font-bold ${scoreTone(health.data?.rate ?? null)}`}>
              {health.data?.rate == null ? "—" : `${health.data.rate}%`}
            </p>
            <p className="text-xs text-muted-foreground">
              {health.data?.attCount ?? 0} days recorded
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Assignments due this week
            </p>
            <p className="mt-1 text-2xl font-bold">{health.data?.assignments ?? 0}</p>
            <p className="text-xs text-muted-foreground">From your class lesson plans</p>
          </div>
        </div>
      </GlassCard>

      {/* ------------------------------ AI tutor ------------------------- */}
      <GlassCard className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
            <Bot className="size-7 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">Your personal AI tutor is ready</h2>
            <p className="text-sm text-muted-foreground">
              Ask questions, get explanations and practice — any subject, any time.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { label: "Help me study for Mathematics", subject: "Mathematics" },
            { label: "Explain today's lesson", subject: undefined },
            { label: "Quiz me on Science", subject: "Science" },
          ].map((q) => (
            <Link
              key={q.label}
              to="/student/ai-tutor"
              search={{ prompt: q.label, subject: q.subject }}
              className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-border bg-muted/20 px-3 py-1.5 text-xs transition hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
            >
              <Sparkles className="size-3.5" /> {q.label}
            </Link>
          ))}
        </div>
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------- Recent grades --------------------- */}
        <GlassCard className="p-0">
          <header className="flex items-center gap-2 border-b border-border p-4">
            <BookOpen className="size-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Recent grades</h2>
          </header>
          {recentGrades.isLoading ? (
            <div className="space-y-2 p-4">
              <SkeletonLine />
              <SkeletonLine />
            </div>
          ) : (recentGrades.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<BookOpen className="size-5" />}
              title="No grades yet"
              description="Your published results will appear here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentGrades.data!.map((g) => {
                const score = g.total_score == null ? null : Number(g.total_score);
                return (
                  <li key={g.id as string} className="flex items-center gap-3 p-3 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {g.subject as string}
                    </span>
                    <span className={`font-semibold tabular-nums ${scoreTone(score)}`}>
                      {score == null ? "—" : `${score}%`}
                    </span>
                    <span className="w-8 text-center text-xs font-bold">
                      {(g.grade as string) ?? "—"}
                    </span>
                    <span className="w-24 text-right text-xs text-muted-foreground">
                      {g.created_at ? new Date(g.created_at as string).toLocaleDateString() : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </GlassCard>

        {/* ------------------------------ Fees --------------------------- */}
        <div className="flex flex-col gap-4">
          {fees.isLoading ? (
            <GlassCard className="p-5">
              <SkeletonLine />
            </GlassCard>
          ) : (fees.data?.outstanding ?? 0) > 0 ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5">
              <div className="flex items-center gap-2 text-amber-300">
                <Wallet className="size-4" />
                <h2 className="font-display text-lg font-semibold">Outstanding fees</h2>
              </div>
              <p className="mt-2 text-3xl font-bold tabular-nums">
                ₦{(fees.data?.outstanding ?? 0).toLocaleString()}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild variant="outline" className="rounded-xl">
                  <Link to="/student/fees">View breakdown</Link>
                </Button>
                <Button asChild className="rounded-xl">
                  <a
                    href={`mailto:?subject=${encodeURIComponent("School fees outstanding")}&body=${encodeURIComponent(
                      `Hello, my outstanding school fee balance is ₦${(fees.data?.outstanding ?? 0).toLocaleString()}.`,
                    )}`}
                  >
                    Inform Parent
                  </a>
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5">
              <div className="flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="size-4" />
                <h2 className="font-display text-lg font-semibold">All fees paid ✓</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                You have no outstanding balance. Keep it up!
              </p>
            </div>
          )}

          {/* --------------------------- Upcoming events ------------------ */}
          <GlassCard className="flex-1 p-0">
            <header className="flex items-center gap-2 border-b border-border p-4">
              <ClipboardList className="size-4 text-primary" />
              <h2 className="font-display text-lg font-semibold">Upcoming events</h2>
            </header>
            {events.isLoading ? (
              <div className="space-y-2 p-4">
                <SkeletonLine />
                <SkeletonLine />
              </div>
            ) : (events.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={<CalendarDays className="size-5" />}
                title="Nothing scheduled"
                description="New school events will show up here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {events.data!.map((e) => (
                  <li key={e.id as string} className="p-4">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                      {new Date(e.event_date as string).toLocaleDateString()}
                      {e.event_time ? ` · ${String(e.event_time).slice(0, 5)}` : ""}
                    </p>
                    <p className="mt-1 font-medium">{e.title as string}</p>
                    {e.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {e.description as string}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </div>
      </div>
    </PortalPage>
  );
}
