import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, EmptyState } from "@/components/portal-shell";
import { PreviewPublicSiteCard } from "@/components/preview-public-site";
import { SchoolEconomyScore } from "@/components/school-economy-score";
import { useSchoolEconomyScore } from "@/hooks/use-school-economy-score";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserPlus,
  CreditCard,
  CheckSquare,
  Brain,
  Megaphone,
  Calendar,
  Globe,
  Activity,
  AlertTriangle,
  Clock,
  TrendingDown,
  Bus,
  Users,
  Wallet,
  GraduationCap,
  UserCheck,
  FileBarChart,
  Newspaper,
  Sparkles,
  DollarSign,
  LifeBuoy,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  ssr: false,
  component: AdminDashboard,
});

/* ---------------------------------- utils --------------------------------- */

const isoDate = (d: Date) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 10);
};
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const naira = (n: number) => `₦${Math.round(n).toLocaleString()}`;

function timeAgo(ts?: string | null) {
  if (!ts) return "just now";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function clockTime(ts?: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function useCountUp(target: number, durationMs = 900) {
  const [v, setV] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / durationMs);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, durationMs]);
  return v;
}

function PanelShell({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="uos-card flex flex-col p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="shrink-0 rounded-md border border-border bg-muted/30 p-2 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-display text-sm font-semibold">{title}</h3>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </div>
  );
}

function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <AlertTriangle className="h-5 w-5 text-amber-400" />
      <p className="text-xs text-muted-foreground">Could not load this panel.</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function Bars({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/* ------------------------------- main page -------------------------------- */

export default function AdminDashboard() {
  const { school, profile } = useApp();
  const schoolId = school?.id;
  const qc = useQueryClient();
  const today = isoDate(new Date());

  const [scoreOpen, setScoreOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);

  const economy = useSchoolEconomyScore();

  /* ---------------------------- core stat counts --------------------------- */
  const counts = useQuery({
    queryKey: ["exec-counts", schoolId],
    enabled: !!schoolId,
    staleTime: 60_000,
    queryFn: async () => {
      const sid = schoolId!;
      const [students, teachers, tickets] = await Promise.all([
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("school_id", sid)
          .eq("is_active", true),
        supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("school_id", sid)
          .eq("role", "teacher")
          .eq("is_active", true),
        supabase
          .from("platform_complaints")
          .select("id", { count: "exact", head: true })
          .eq("school_id", sid)
          .in("status", ["open", "in_progress", "pending"]),
      ]);
      return {
        students: students.count ?? 0,
        teachers: teachers.count ?? 0,
        tickets: tickets.count ?? 0,
      };
    },
  });

  /* --------------------------------- fees ---------------------------------- */
  const fees = useQuery({
    queryKey: ["exec-fees", schoolId],
    enabled: !!schoolId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select("id, amount, paid_amount, status, due_date, paid_at, student_id")
        .eq("school_id", schoolId!);
      if (error) throw error;
      const rows = data ?? [];
      let billed = 0,
        collected = 0,
        overdueCount = 0,
        overdueAmount = 0;
      const cutoff = daysAgo(14);
      rows.forEach((f) => {
        const a = Number(f.amount ?? 0);
        const p = Number(f.paid_amount ?? 0);
        billed += a;
        collected += p;
        if (f.status !== "paid" && f.due_date && new Date(f.due_date) < cutoff) {
          overdueCount += 1;
          overdueAmount += Math.max(0, a - p);
        }
      });
      const paid = rows.filter((f) => f.paid_at);
      const todayPaid = paid.filter((f) => isoDate(new Date(f.paid_at!)) === today);
      const weekStart = daysAgo(7).getTime();
      const prevStart = daysAgo(14).getTime();
      let thisWeek = 0,
        lastWeek = 0;
      paid.forEach((f) => {
        const t = new Date(f.paid_at!).getTime();
        const amt = Number(f.paid_amount ?? 0);
        if (t >= weekStart) thisWeek += amt;
        else if (t >= prevStart) lastWeek += amt;
      });
      const dayKeys = new Set(paid.map((f) => isoDate(new Date(f.paid_at!))));
      const dailyAverage = dayKeys.size
        ? paid.reduce((s, f) => s + Number(f.paid_amount ?? 0), 0) / dayKeys.size
        : 0;
      return {
        rate: billed > 0 ? Math.round((collected / billed) * 100) : 0,
        overdueCount,
        overdueAmount,
        thisWeek,
        lastWeek,
        dailyAverage,
        todayTotal: todayPaid.reduce((s, f) => s + Number(f.paid_amount ?? 0), 0),
        todayCount: todayPaid.length,
        recent: [...todayPaid]
          .sort((a, b) => new Date(b.paid_at!).getTime() - new Date(a.paid_at!).getTime())
          .slice(0, 3),
      };
    },
  });

  const recentPayerIds = useMemo(
    () => Array.from(new Set((fees.data?.recent ?? []).map((f) => f.student_id))),
    [fees.data],
  );
  const payerNames = useQuery({
    queryKey: ["exec-payer-names", recentPayerIds.slice().sort().join(",")],
    enabled: recentPayerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, admission_number, user_id, parent_name")
        .in("id", recentPayerIds);
      return Object.fromEntries(
        (data ?? []).map((s) => [s.id, s.admission_number ?? s.parent_name ?? "Student"]),
      ) as Record<string, string>;
    },
  });

  /* ------------------------------- attendance ------------------------------ */
  const attendance = useQuery({
    queryKey: ["exec-attendance", schoolId, today],
    enabled: !!schoolId,
    staleTime: 60_000,
    queryFn: async () => {
      const from = isoDate(daysAgo(14));
      const { data, error } = await supabase
        .from("attendance")
        .select("date, status, student_id, class_id")
        .eq("school_id", schoolId!)
        .gte("date", from);
      if (error) throw error;
      const rows = data ?? [];
      const perStudent: Record<string, { p: number; t: number }> = {};
      const perClass: Record<string, { p: number; t: number }> = {};
      let present = 0,
        absent = 0,
        late = 0,
        totalToday = 0;
      rows.forEach((r) => {
        const ok = r.status === "present" || r.status === "late";
        const s = perStudent[r.student_id] ?? { p: 0, t: 0 };
        s.t += 1;
        if (ok) s.p += 1;
        perStudent[r.student_id] = s;
        if (String(r.date).slice(0, 10) === today) {
          totalToday += 1;
          if (r.status === "present") present += 1;
          else if (r.status === "late") late += 1;
          else absent += 1;
          if (r.class_id) {
            const c = perClass[r.class_id] ?? { p: 0, t: 0 };
            c.t += 1;
            if (ok) c.p += 1;
            perClass[r.class_id] = c;
          }
        }
      });
      const atRisk = Object.values(perStudent).filter((s) => s.t >= 3 && s.p / s.t < 0.7).length;
      const worstClasses = Object.entries(perClass)
        .map(([id, v]) => ({ id, pct: v.t ? Math.round((v.p / v.t) * 100) : 0 }))
        .sort((a, b) => a.pct - b.pct)
        .slice(0, 2);
      const pct = (n: number) => (totalToday ? Math.round((n / totalToday) * 100) : 0);
      return {
        atRisk,
        totalToday,
        presentPct: pct(present),
        absentPct: pct(absent),
        latePct: pct(late),
        todayRate: totalToday ? Math.round(((present + late) / totalToday) * 100) : 0,
        worstClasses,
      };
    },
  });

  const worstClassIds = useMemo(
    () => (attendance.data?.worstClasses ?? []).map((c) => c.id),
    [attendance.data],
  );
  const classNames = useQuery({
    queryKey: ["exec-class-names", worstClassIds.slice().sort().join(",")],
    enabled: worstClassIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("classes").select("id, name").in("id", worstClassIds);
      return Object.fromEntries((data ?? []).map((c) => [c.id, c.name])) as Record<string, string>;
    },
  });

  /* --------------------------- teacher presence ---------------------------- */
  const presence = useQuery({
    queryKey: ["exec-presence", schoolId, today],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("id, teacher_id, type, timestamp")
        .eq("school_id", schoolId!)
        .gte("timestamp", `${today}T00:00:00.000Z`)
        .order("timestamp", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []).filter((r) => r.type === "sign_in");
      const seen = new Set<string>();
      const unique = rows.filter((r) =>
        seen.has(r.teacher_id) ? false : (seen.add(r.teacher_id), true),
      );
      return { signedIn: seen.size, last: unique.slice(0, 5) };
    },
  });

  const presenceIds = useMemo(
    () => (presence.data?.last ?? []).map((r) => r.teacher_id),
    [presence.data],
  );
  const teacherNames = useQuery({
    queryKey: ["exec-teacher-names", presenceIds.slice().sort().join(",")],
    enabled: presenceIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("users").select("id, full_name").in("id", presenceIds);
      return Object.fromEntries((data ?? []).map((u) => [u.id, u.full_name])) as Record<
        string,
        string
      >;
    },
  });

  /* ------------------------- staff without leave --------------------------- */
  const staffAbsence = useQuery({
    queryKey: ["exec-staff-absence", schoolId, today, counts.data?.teachers ?? 0],
    enabled: !!schoolId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("staff_leave")
        .select("user_id, start_date, end_date, status")
        .eq("school_id", schoolId!)
        .eq("status", "approved")
        .lte("start_date", today)
        .gte("end_date", today);
      const onLeave = new Set((data ?? []).map((l) => l.user_id).filter(Boolean) as string[]);
      const signedIn = presence.data?.signedIn ?? 0;
      const total = counts.data?.teachers ?? 0;
      return { count: Math.max(0, total - signedIn - onLeave.size), total, signedIn };
    },
  });

  /* --------------------------------- buses --------------------------------- */
  const buses = useQuery({
    queryKey: ["exec-buses", schoolId],
    enabled: !!schoolId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_buses")
        .select("id, bus_number, route_name, is_active, current_status, last_location_update")
        .eq("school_id", schoolId!);
      if (error) throw error;
      const rows = data ?? [];
      const active = rows.filter((b) => b.is_active);
      const stale = active.filter(
        (b) =>
          !b.last_location_update ||
          Date.now() - new Date(b.last_location_update).getTime() > 2 * 3600_000,
      );
      const lastPing = active
        .map((b) => b.last_location_update)
        .filter(Boolean)
        .sort()
        .pop() as string | undefined;
      return {
        total: rows.length,
        active: active.length,
        stale,
        lastPing,
        rows: active.slice(0, 3),
      };
    },
  });

  /* -------------------------------- activity ------------------------------- */
  const activity = useQuery({
    queryKey: ["exec-activity", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action, table_name, created_at, user_id")
        .eq("school_id", schoolId!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  /* ------------------------------- realtime -------------------------------- */
  useEffect(() => {
    if (!schoolId) return;
    const ch = supabase
      .channel(`exec-presence-${schoolId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendance_logs",
          filter: `school_id=eq.${schoolId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["exec-presence", schoolId, today] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [schoolId, today, qc]);

  useEffect(() => {
    if (!schoolId) return;
    const ch = supabase
      .channel(`exec-audit-${schoolId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_logs",
          filter: `school_id=eq.${schoolId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["exec-activity", schoolId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [schoolId, qc]);

  /* ------------------------------- insights -------------------------------- */
  const insights = useMemo(() => {
    const list: { tone: "good" | "warn"; text: string }[] = [];
    const atRisk = attendance.data?.atRisk ?? 0;
    list.push(
      atRisk > 0
        ? {
            tone: "warn",
            text: `⚠️ ${atRisk} students have attendance below 70% this week — review recommended`,
          }
        : { tone: "good", text: "✅ All students have healthy attendance this week" },
    );

    const tw = fees.data?.thisWeek ?? 0;
    const lw = fees.data?.lastWeek ?? 0;
    if (lw === 0 && tw === 0) {
      list.push({
        tone: "warn",
        text: "📉 No fee payments recorded in the last two weeks — consider follow-up",
      });
    } else if (lw === 0) {
      list.push({
        tone: "good",
        text: `📈 ${naira(tw)} collected this week after a quiet week — strong payment momentum`,
      });
    } else {
      const delta = Math.round(((tw - lw) / lw) * 100);
      list.push(
        delta >= 0
          ? {
              tone: "good",
              text: `📈 Fee collection up ${delta}% this week — strong payment momentum`,
            }
          : {
              tone: "warn",
              text: `📉 Fee collection slowed ${Math.abs(delta)}% vs last week — consider follow-up`,
            },
      );
    }

    const absent = staffAbsence.data?.count ?? 0;
    list.push(
      absent > 0
        ? { tone: "warn", text: `🔔 ${absent} staff members absent without recorded leave today` }
        : { tone: "good", text: "✅ Full teaching staff present today" },
    );
    return list;
  }, [attendance.data, fees.data, staffAbsence.data]);

  /* ---------------------------- announcement ------------------------------- */
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const announce = useMutation({
    mutationFn: async () => {
      if (!schoolId) throw new Error("No school context");
      if (!annTitle.trim() || !annBody.trim()) throw new Error("Title and message are required");
      const { error } = await supabase.from("news").insert({
        school_id: schoolId,
        title: annTitle.trim(),
        content: annBody.trim(),
        is_published: true,
        published_at: new Date().toISOString(),
        author_id: profile?.id ?? null,
        category: "announcement",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Announcement published");
      setAnnTitle("");
      setAnnBody("");
      setAnnounceOpen(false);
      qc.invalidateQueries({ queryKey: ["exec-activity", schoolId] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not publish announcement"),
  });

  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const greeting =
    now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <PortalPage
      title="Executive Command Center"
      subtitle={school ? `Live operations for ${school.name}` : "Live school operations"}
    >
      {/* 1 — Morning briefing */}
      <div className="uos-glass mb-6 rounded-[20px] p-5 sm:p-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg font-bold sm:text-2xl">
              {greeting}, {school?.name ?? "there"}. Here is today's overview.
            </h2>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{dateLabel}</p>
          </div>
          <span className="shrink-0 rounded-full bg-primary/15 px-3 py-1 text-[11px] font-semibold text-primary">
            Live
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <AlertTile
            icon={TrendingDown}
            label="Students at risk"
            value={attendance.data?.atRisk ?? 0}
            desc="Attendance under 70% (14 days)"
            to="/admin/students"
          />
          <AlertTile
            icon={AlertTriangle}
            label="Fees overdue 14+ days"
            value={fees.data?.overdueCount ?? 0}
            desc={naira(fees.data?.overdueAmount ?? 0)}
            to="/admin/fees-defaulters"
          />
          <AlertTile
            icon={Clock}
            label="Teachers not signed in"
            value={Math.max(0, (counts.data?.teachers ?? 0) - (presence.data?.signedIn ?? 0))}
            desc="Yet to clock in today"
            to="/admin/attendance"
          />
        </div>
      </div>

      <PreviewPublicSiteCard />

      {/* 2 — Stats row */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Active students"
          value={counts.data?.students ?? 0}
          hint="Enrolled & active"
          isLoading={counts.isLoading}
        />
        <StatCard
          label="Teaching staff"
          value={counts.data?.teachers ?? 0}
          hint="Active teachers"
          isLoading={counts.isLoading}
        />
        <StatCard
          label="Fee collection"
          value={`${fees.data?.rate ?? 0}%`}
          hint="Collected vs billed"
          isLoading={fees.isLoading}
        />
        <StatCard
          label="Attendance today"
          value={`${attendance.data?.todayRate ?? 0}%`}
          hint="Present or late"
          isLoading={attendance.isLoading}
        />
        <button
          type="button"
          onClick={() => setScoreOpen(true)}
          className="text-left transition hover:opacity-80"
        >
          <StatCard
            label="Economy score"
            value={economy.data?.overall ?? 0}
            hint="Tap for full breakdown"
            isLoading={economy.isLoading}
          />
        </button>
        <StatCard
          label="Open tickets"
          value={counts.data?.tickets ?? 0}
          hint="Support requests"
          isLoading={counts.isLoading}
        />
      </div>

      {/* 3 — AI insights strip */}
      <div className="mt-6 -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {insights.map((i, idx) => (
          <div
            key={idx}
            className={`uos-card min-w-[260px] flex-1 snap-start p-4 sm:min-w-[280px] ${
              i.tone === "warn" ? "border-amber-500/30" : "border-emerald-500/30"
            }`}
          >
            <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" /> Insight {idx + 1}
            </div>
            <p className="text-sm leading-relaxed">{i.text}</p>
          </div>
        ))}
      </div>

      {/* 4 — Operations grid */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Panel 1 — teacher presence */}
        <PanelShell
          icon={Users}
          title="Live teacher presence"
          subtitle="Realtime staff sign-ins"
          action={
            <Link to="/admin/attendance" className="shrink-0 text-xs text-primary hover:underline">
              QR station →
            </Link>
          }
        >
          {presence.isLoading ? (
            <Bars />
          ) : presence.isError ? (
            <PanelError onRetry={() => presence.refetch()} />
          ) : (
            <>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold">
                  {presence.data?.signedIn ?? 0} of {counts.data?.teachers ?? 0} teachers signed in
                </span>
                <span className="text-xs text-muted-foreground">
                  {counts.data?.teachers
                    ? Math.round(((presence.data?.signedIn ?? 0) / counts.data.teachers) * 100)
                    : 0}
                  %
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted/40">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-700"
                  style={{
                    width: `${counts.data?.teachers ? Math.min(100, ((presence.data?.signedIn ?? 0) / counts.data.teachers) * 100) : 0}%`,
                  }}
                />
              </div>
              <ul className="mt-4 space-y-2">
                {(presence.data?.last ?? []).length === 0 ? (
                  <li className="py-4 text-center text-xs text-muted-foreground">
                    No sign-ins recorded yet today.
                  </li>
                ) : (
                  presence.data!.last.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <UserCheck className="h-4 w-4 shrink-0 text-emerald-400" />
                        <span className="truncate">
                          {teacherNames.data?.[r.teacher_id] ?? "Staff member"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {clockTime(r.timestamp)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </PanelShell>

        {/* Panel 2 — fee activity */}
        <PanelShell
          icon={Wallet}
          title="Today's fee activity"
          subtitle="Payments recorded today"
          action={
            <Link to="/admin/fees" className="shrink-0 text-xs text-primary hover:underline">
              Fees →
            </Link>
          }
        >
          {fees.isLoading ? (
            <Bars />
          ) : fees.isError ? (
            <PanelError onRetry={() => fees.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <MiniStat label="Collected" value={naira(fees.data?.todayTotal ?? 0)} />
                <MiniStat label="Daily avg" value={naira(fees.data?.dailyAverage ?? 0)} />
                <MiniStat label="Payments" value={String(fees.data?.todayCount ?? 0)} />
              </div>
              <ul className="mt-4 space-y-2">
                {(fees.data?.recent ?? []).length === 0 ? (
                  <li className="py-4 text-center text-xs text-muted-foreground">
                    No payments recorded today.
                  </li>
                ) : (
                  fees.data!.recent.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate">
                        {payerNames.data?.[f.student_id] ?? "Student"}
                      </span>
                      <span className="shrink-0 text-xs">
                        <span className="font-semibold text-emerald-400">
                          {naira(Number(f.paid_amount ?? 0))}
                        </span>
                        <span className="ml-2 text-muted-foreground">{clockTime(f.paid_at)}</span>
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </PanelShell>

        {/* Panel 3 — bus status */}
        <PanelShell
          icon={Bus}
          title="Bus status"
          subtitle="Fleet telemetry"
          action={
            <Link to="/admin/buses" className="shrink-0 text-xs text-primary hover:underline">
              Fleet →
            </Link>
          }
        >
          {buses.isLoading ? (
            <Bars n={2} />
          ) : buses.isError ? (
            <PanelError onRetry={() => buses.refetch()} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <MiniStat label="Active buses" value={String(buses.data?.active ?? 0)} />
                <MiniStat label="Last ping" value={timeAgo(buses.data?.lastPing)} />
              </div>
              <div
                className={`mt-4 rounded-xl border p-3 text-xs ${
                  (buses.data?.stale.length ?? 0) > 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                }`}
              >
                {(buses.data?.stale.length ?? 0) > 0
                  ? `⚠️ ${buses.data!.stale.length} bus(es) have not reported location in over 2 hours.`
                  : buses.data?.active
                    ? "✅ All active buses are reporting normally."
                    : "No active buses configured."}
              </div>
              <ul className="mt-3 space-y-2">
                {(buses.data?.rows ?? []).map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">
                      {b.bus_number}
                      {b.route_name ? ` · ${b.route_name}` : ""}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {timeAgo(b.last_location_update)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </PanelShell>

        {/* Panel 4 — attendance summary */}
        <PanelShell
          icon={CheckSquare}
          title="Attendance summary"
          subtitle="Today across the school"
          action={
            <Link to="/admin/attendance" className="shrink-0 text-xs text-primary hover:underline">
              Details →
            </Link>
          }
        >
          {attendance.isLoading ? (
            <Bars n={2} />
          ) : attendance.isError ? (
            <PanelError onRetry={() => attendance.refetch()} />
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <AttendanceDonut
                present={attendance.data?.presentPct ?? 0}
                late={attendance.data?.latePct ?? 0}
                absent={attendance.data?.absentPct ?? 0}
              />
              <div className="w-full flex-1 space-y-2 text-sm">
                <Legend
                  color="#10b981"
                  label="Present"
                  value={`${attendance.data?.presentPct ?? 0}%`}
                />
                <Legend color="#f59e0b" label="Late" value={`${attendance.data?.latePct ?? 0}%`} />
                <Legend
                  color="#ef4444"
                  label="Absent"
                  value={`${attendance.data?.absentPct ?? 0}%`}
                />
                <div className="pt-2 text-xs text-muted-foreground">
                  {(attendance.data?.worstClasses ?? []).length === 0
                    ? "No class-level records today."
                    : "Lowest attendance:"}
                  <ul className="mt-1 space-y-1">
                    {(attendance.data?.worstClasses ?? []).map((c) => (
                      <li key={c.id} className="flex justify-between">
                        <span className="truncate">{classNames.data?.[c.id] ?? "Class"}</span>
                        <span className="shrink-0 font-medium text-amber-400">{c.pct}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </PanelShell>
      </div>

      {/* 5 — Quick actions */}
      <div className="mt-10">
        <h3 className="mb-3 font-display text-base font-semibold">Quick actions</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <QuickAction
            to="/admin/students"
            icon={UserPlus}
            label="Add Student"
            desc="Enroll a new student"
          />
          <QuickAction
            to="/admin/fees"
            icon={CreditCard}
            label="Record Fee"
            desc="Billing & payments"
          />
          <QuickAction
            to="/admin/attendance"
            icon={CheckSquare}
            label="Mark Attendance"
            desc="Open QR station"
          />
          <QuickAction
            to="/admin/student-intelligence"
            icon={Brain}
            label="AI Intelligence"
            desc="Student insights"
          />
          <QuickActionButton
            onClick={() => setAnnounceOpen(true)}
            icon={Megaphone}
            label="Send Announcement"
            desc="Publish to the school"
          />
          <QuickAction
            to="/admin/timetable"
            icon={Calendar}
            label="View Timetable"
            desc="Class schedule"
          />
          <QuickAction
            to="/admin/cms"
            icon={Globe}
            label="Public Website"
            desc="Edit school site"
          />
          <QuickAction
            to="/admin/operations"
            icon={Activity}
            label="Operations Center"
            desc="Live operations"
          />
        </div>
      </div>

      {/* 6 — Recent activity */}
      <div className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold">Recent activity</h3>
          <span className="text-xs text-muted-foreground">Live feed</span>
        </div>
        <div className="uos-card p-2 sm:p-4">
          {activity.isLoading ? (
            <Bars n={5} />
          ) : activity.isError ? (
            <PanelError onRetry={() => activity.refetch()} />
          ) : (activity.data ?? []).length === 0 ? (
            <EmptyState
              icon={<Activity className="h-5 w-5" />}
              title="No activity yet"
              description="Actions across the school will appear here in real time."
            />
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {activity.data!.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-2 py-3">
                  <span className="shrink-0 rounded-md border border-border bg-muted/30 p-2">
                    <ActivityIcon table={a.table_name ?? ""} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {prettyAction(a.action)}
                    {a.table_name ? ` · ${a.table_name.replace(/_/g, " ")}` : ""}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeAgo(a.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Economy score sheet */}
      <Sheet open={scoreOpen} onOpenChange={setScoreOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>School Economy Score</SheetTitle>
            <SheetDescription>Composite institutional health index</SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            <SchoolEconomyScore />
          </div>
        </SheetContent>
      </Sheet>

      {/* Announcement dialog */}
      <Dialog open={announceOpen} onOpenChange={setAnnounceOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send announcement</DialogTitle>
            <DialogDescription>Publishes immediately to your school news feed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Announcement title"
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
            />
            <Textarea
              rows={5}
              placeholder="Write your message…"
              value={annBody}
              onChange={(e) => setAnnBody(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnounceOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => announce.mutate()} disabled={announce.isPending}>
              {announce.isPending ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalPage>
  );
}

/* ------------------------------ subcomponents ----------------------------- */

function AlertTile({
  icon: Icon,
  label,
  value,
  desc,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  desc: string;
  to: string;
}) {
  const shown = useCountUp(value);
  const alert = value > 0;
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-2xl border p-3 transition hover:border-primary/50 ${
        alert ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/10"
      }`}
    >
      <span
        className={`shrink-0 rounded-lg p-2 ${alert ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">
          {shown} · {label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{desc}</span>
      </span>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/10 p-2.5">
      <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-sm">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function AttendanceDonut({
  present,
  late,
  absent,
}: {
  present: number;
  late: number;
  absent: number;
}) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const segs = [
    { v: present, color: "#10b981" },
    { v: late, color: "#f59e0b" },
    { v: absent, color: "#ef4444" },
  ];
  let offset = 0;
  return (
    <svg width="128" height="128" viewBox="0 0 128 128" className="shrink-0">
      <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" />
      {segs.map((s, i) => {
        const len = (Math.max(0, Math.min(100, s.v)) / 100) * c;
        const el = (
          <circle
            key={i}
            cx="64"
            cy="64"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="14"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 64 64)"
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          />
        );
        offset += len;
        return el;
      })}
      <text
        x="64"
        y="60"
        textAnchor="middle"
        className="fill-foreground"
        style={{ fontSize: 22, fontWeight: 800 }}
      >
        {present}%
      </text>
      <text
        x="64"
        y="78"
        textAnchor="middle"
        className="fill-muted-foreground"
        style={{ fontSize: 10 }}
      >
        present
      </text>
    </svg>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
  desc,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="uos-card group flex min-h-[88px] flex-col gap-2 p-4 transition hover:border-primary/60 hover:bg-primary/5"
    >
      <span className="w-fit rounded-md border border-border bg-muted/30 p-2 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{desc}</div>
      </div>
    </Link>
  );
}

function QuickActionButton({
  onClick,
  icon: Icon,
  label,
  desc,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="uos-card group flex min-h-[88px] flex-col gap-2 p-4 text-left transition hover:border-primary/60 hover:bg-primary/5"
    >
      <span className="w-fit rounded-md border border-border bg-muted/30 p-2 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{desc}</div>
      </div>
    </button>
  );
}

function ActivityIcon({ table }: { table: string }) {
  const cls = "h-4 w-4 text-primary";
  if (table === "students") return <GraduationCap className={cls} />;
  if (table === "fees") return <DollarSign className={cls} />;
  if (table === "attendance_logs" || table === "attendance") return <UserCheck className={cls} />;
  if (table === "grades") return <FileBarChart className={cls} />;
  if (table === "news") return <Newspaper className={cls} />;
  if (table === "users" || table === "school_staff") return <Users className={cls} />;
  if (table === "platform_complaints") return <LifeBuoy className={cls} />;
  return <Sparkles className={cls} />;
}

function prettyAction(a: string) {
  return a.replace(/[_-]/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}
