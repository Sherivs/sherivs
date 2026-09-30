import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Activity,
  Users,
  Wallet,
  HeartPulse,
  Bus,
  GraduationCap,
  Server,
  Bell,
  Megaphone,
  Lock,
  Siren,
  FileBarChart,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Info,
  Calendar as CalendarIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/operations")({
  ssr: false,
  component: OperationsCommandCenter,
});

/* ---------- helpers ---------- */
const todayISO = () => new Date().toISOString().slice(0, 10);
const startOfDayISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(n || 0);
const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtRel = (iso?: string | null) => {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

type Tone = "green" | "amber" | "red" | "blue" | "slate";
const toneRing: Record<Tone, string> = {
  green: "ring-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "ring-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "ring-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  blue: "ring-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  slate: "ring-slate-500/30 bg-slate-500/10 text-slate-500",
};

/* ---------- Status Card ---------- */
function StatusCard({
  icon: Icon,
  title,
  primary,
  secondary,
  tone,
  hint,
}: {
  icon: any;
  title: string;
  primary: string;
  secondary?: string;
  tone: Tone;
  hint?: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={cn("h-9 w-9 rounded-lg grid place-items-center ring-1", toneRing[tone])}
            >
              <Icon className="h-4 w-4" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
          </div>
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full animate-pulse",
              tone === "green"
                ? "bg-emerald-500"
                : tone === "amber"
                  ? "bg-amber-500"
                  : tone === "red"
                    ? "bg-red-500"
                    : tone === "blue"
                      ? "bg-sky-500"
                      : "bg-slate-400",
            )}
          />
        </div>
        <div>
          <p className="text-2xl font-bold tracking-tight">{primary}</p>
          {secondary && <p className="text-xs text-muted-foreground mt-1">{secondary}</p>}
        </div>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/* ---------- Feed event ---------- */
type FeedEvent = {
  id: string;
  kind: "attendance" | "fee" | "clinic" | "grade";
  label: string;
  at: string;
};

function feedIcon(kind: FeedEvent["kind"]) {
  if (kind === "attendance") return <Users className="h-4 w-4 text-sky-500" />;
  if (kind === "fee") return <Wallet className="h-4 w-4 text-emerald-500" />;
  if (kind === "clinic") return <HeartPulse className="h-4 w-4 text-rose-500" />;
  return <GraduationCap className="h-4 w-4 text-violet-500" />;
}

/* =============================================================
   MAIN
   ============================================================= */
function OperationsCommandCenter() {
  const { school } = useApp();
  const schoolId = school?.id;
  const qc = useQueryClient();
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [nowTick, setNowTick] = useState(Date.now());

  /* auto refresh status every 30s */
  useEffect(() => {
    const t = setInterval(() => {
      setNowTick(Date.now());
      qc.invalidateQueries({ queryKey: ["ops"] });
    }, 30_000);
    return () => clearInterval(t);
  }, [qc]);

  /* ============ Queries ============ */
  const teachers = useQuery({
    queryKey: ["ops", "teachers", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("id, full_name")
        .eq("school_id", schoolId!)
        .eq("role", "teacher")
        .eq("is_active", true);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const attToday = useQuery({
    queryKey: ["ops", "attToday", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance_logs")
        .select("id, teacher_id, type, timestamp")
        .eq("school_id", schoolId!)
        .gte("timestamp", startOfDayISO())
        .order("timestamp", { ascending: false });
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const feesToday = useQuery({
    queryKey: ["ops", "feesToday", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("fees")
        .select("id, amount, paid_amount, status, paid_at, student_id, due_date")
        .eq("school_id", schoolId!);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const buses = useQuery({
    queryKey: ["ops", "buses", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("transport_buses")
        .select("id, bus_number, current_status, last_location_update, is_active")
        .eq("school_id", schoolId!);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const academic = useQuery({
    queryKey: ["ops", "academic", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const dow = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
        new Date().getDay()
      ];
      const [slots, plans, grades] = await Promise.all([
        supabase
          .from("timetable_slots")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId!)
          .ilike("day_of_week", dow),
        supabase
          .from("lesson_plans")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId!)
          .gte("created_at", startOfDayISO()),
        supabase
          .from("grades")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId!)
          .gte("created_at", startOfDayISO()),
      ]);
      return { slots: slots.count ?? 0, plans: plans.count ?? 0, grades: grades.count ?? 0 };
    },
    staleTime: 60_000,
  });

  const events = useQuery({
    queryKey: ["ops", "events", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const in7 = new Date();
      in7.setDate(in7.getDate() + 7);
      const { data } = await supabase
        .from("events")
        .select("id, title, event_date, event_time, event_type")
        .eq("school_id", schoolId!)
        .gte("event_date", todayISO())
        .lte("event_date", in7.toISOString().slice(0, 10))
        .order("event_date", { ascending: true })
        .limit(10);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const notifs = useQuery({
    queryKey: ["ops", "notifs", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, title, message, type, is_read, created_at, action_url")
        .eq("school_id", schoolId!)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
    staleTime: 30_000,
  });

  const students = useQuery({
    queryKey: ["ops", "studentsLite", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("students")
        .select("id, full_name")
        .eq("school_id", schoolId!);
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const teacherName = useMemo(() => {
    const m = new Map<string, string>();
    (teachers.data ?? []).forEach((t: any) => m.set(t.id, t.full_name));
    return m;
  }, [teachers.data]);
  const studentName = useMemo(() => {
    const m = new Map<string, string>();
    (students.data ?? []).forEach((s: any) => m.set(s.id, s.full_name));
    return m;
  }, [students.data]);

  /* ============ Derived status ============ */
  const totalTeachers = teachers.data?.length ?? 0;
  const signedInIds = new Set(
    (attToday.data ?? []).filter((r: any) => r.type === "sign_in").map((r: any) => r.teacher_id),
  );
  (attToday.data ?? []).forEach((r: any) => {
    if (r.type === "sign_out") signedInIds.delete(r.teacher_id);
  });
  const presentNow = signedInIds.size;
  const attRate = totalTeachers ? Math.round((presentNow / totalTeachers) * 100) : 0;
  const attTone: Tone = attRate >= 80 ? "green" : attRate >= 60 ? "amber" : "red";

  const paidToday = (feesToday.data ?? []).filter(
    (f: any) => f.paid_at && new Date(f.paid_at).toISOString().slice(0, 10) === todayISO(),
  );
  const collectedToday = paidToday.reduce((s: number, f: any) => s + Number(f.paid_amount || 0), 0);
  const overdue30 = (feesToday.data ?? []).filter((f: any) => {
    if (f.status === "paid" || !f.due_date) return false;
    const days = (Date.now() - new Date(f.due_date).getTime()) / 86400000;
    return days > 30;
  });
  const outstanding = (feesToday.data ?? [])
    .filter((f: any) => f.status !== "paid")
    .reduce((s: number, f: any) => s + (Number(f.amount) - Number(f.paid_amount || 0)), 0);
  const feeTone: Tone = collectedToday > 0 ? "green" : "amber";

  const activeBuses = (buses.data ?? []).filter((b: any) => b.is_active);
  const lastPing = activeBuses
    .map((b: any) => b.last_location_update)
    .filter(Boolean)
    .sort()
    .reverse()[0] as string | undefined;
  const staleBuses = activeBuses.filter((b: any) => {
    if (!b.last_location_update) return true;
    return Date.now() - new Date(b.last_location_update).getTime() > 30 * 60_000;
  });
  const busTone: Tone = activeBuses.length === 0 ? "slate" : staleBuses.length ? "amber" : "green";

  const acad = academic.data ?? { slots: 0, plans: 0, grades: 0 };
  const acadTone: Tone = acad.slots > 0 ? "blue" : "slate";

  const activeSessions = new Set(
    (attToday.data ?? [])
      .filter((r: any) => Date.now() - new Date(r.timestamp).getTime() < 60 * 60_000)
      .map((r: any) => r.teacher_id),
  ).size;

  /* ============ Realtime feed ============ */
  useEffect(() => {
    if (!schoolId) return;
    const push = (e: FeedEvent) => setFeed((prev) => [e, ...prev].slice(0, 50));

    const ch = supabase
      .channel(`ops-feed-${schoolId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attendance_logs",
          filter: `school_id=eq.${schoolId}`,
        },
        (payload) => {
          const r: any = payload.new;
          push({
            id: r.id,
            kind: "attendance",
            at: r.timestamp ?? new Date().toISOString(),
            label: `Teacher ${teacherName.get(r.teacher_id) ?? ""} signed ${r.type === "sign_in" ? "in" : "out"}`,
          });
          qc.invalidateQueries({ queryKey: ["ops", "attToday"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "fees", filter: `school_id=eq.${schoolId}` },
        (payload) => {
          const r: any = payload.new;
          const o: any = payload.old;
          if (r.status !== o.status || Number(r.paid_amount) !== Number(o.paid_amount)) {
            push({
              id: `${r.id}-${Date.now()}`,
              kind: "fee",
              at: r.paid_at ?? new Date().toISOString(),
              label: `Fee payment recorded for ${studentName.get(r.student_id) ?? "student"} — ${fmtMoney(Number(r.paid_amount || 0))}`,
            });
            qc.invalidateQueries({ queryKey: ["ops", "feesToday"] });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "grades", filter: `school_id=eq.${schoolId}` },
        (payload) => {
          const r: any = payload.new;
          push({
            id: r.id,
            kind: "grade",
            at: r.created_at ?? new Date().toISOString(),
            label: `Grade entered — ${r.subject} (${r.term})`,
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [schoolId, teacherName, studentName, qc]);

  /* ============ Actions ============ */
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);

  return (
    <PortalPage
      title="Operations Command Center"
      subtitle="Real-time monitoring of every department across your institution"
    >
      {/* Quick Commands */}
      <div className="flex flex-wrap gap-2">
        <Dialog open={announceOpen} onOpenChange={setAnnounceOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="default">
              <Megaphone className="h-4 w-4 mr-1.5" />
              Send Announcement
            </Button>
          </DialogTrigger>
          <ComposeDialog
            kind="announcement"
            schoolId={schoolId}
            onClose={() => setAnnounceOpen(false)}
          />
        </Dialog>
        <Button size="sm" variant="outline" asChild>
          <Link to="/admin/locked-accounts">
            <Lock className="h-4 w-4 mr-1.5" />
            Locked Accounts
          </Link>
        </Button>
        <Dialog open={emergencyOpen} onOpenChange={setEmergencyOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive">
              <Siren className="h-4 w-4 mr-1.5" />
              Emergency Alert
            </Button>
          </DialogTrigger>
          <ComposeDialog
            kind="emergency"
            schoolId={schoolId}
            onClose={() => setEmergencyOpen(false)}
          />
        </Dialog>
        <Button size="sm" variant="outline" asChild>
          <Link to="/admin/report-cards">
            <FileBarChart className="h-4 w-4 mr-1.5" />
            Generate Report
          </Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to="/admin/intelligence">
            <Sparkles className="h-4 w-4 mr-1.5" />
            Intelligence
          </Link>
        </Button>
      </div>

      {/* 6 Live Status */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatusCard
          icon={Users}
          title="Attendance"
          tone={attTone}
          primary={`${presentNow} / ${totalTeachers}`}
          secondary={`${attRate}% teachers present now`}
          hint="Live via attendance logs"
        />
        <StatusCard
          icon={Wallet}
          title="Fee Collection"
          tone={feeTone}
          primary={fmtMoney(collectedToday)}
          secondary={`${paidToday.length} payments today`}
          hint={`Outstanding this term: ${fmtMoney(outstanding)}`}
        />
        <StatusCard
          icon={HeartPulse}
          title="Clinic"
          tone="slate"
          primary="0 active"
          secondary="No students currently in clinic"
          hint="Health module not tracked"
        />
        <StatusCard
          icon={Bus}
          title="Transport"
          tone={busTone}
          primary={`${activeBuses.length} active`}
          secondary={
            staleBuses.length ? `${staleBuses.length} late / stale GPS` : "All buses on schedule"
          }
          hint={`Last ping ${fmtRel(lastPing)}`}
        />
        <StatusCard
          icon={GraduationCap}
          title="Academic"
          tone={acadTone}
          primary={`${acad.slots} classes today`}
          secondary={`${acad.plans} lesson plans · ${acad.grades} grades entered`}
        />
        <StatusCard
          icon={Server}
          title="System"
          tone="green"
          primary="Operational"
          secondary={`${activeSessions} active sessions`}
          hint={`Last sync ${new Date(nowTick).toLocaleTimeString()}`}
        />
      </div>

      {/* Feed + Departments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Feed */}
        <Card className="lg:col-span-1 order-2 lg:order-1">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> Live Event Feed
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[520px] overflow-y-auto divide-y">
              {feed.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">Waiting for live events…</p>
              )}
              {feed.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="mt-0.5">{feedIcon(e.kind)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{e.label}</p>
                    <p className="text-[11px] text-muted-foreground">{fmtRel(e.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Department Health */}
        <div className="lg:col-span-2 order-1 lg:order-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DeptCard
            title="Academic"
            icon={GraduationCap}
            to="/admin/intelligence-teachers"
            rows={[
              ["Teacher attendance", `${attRate}%`],
              ["Lesson plans today", `${acad.plans}`],
              ["Grades entered today", `${acad.grades}`],
            ]}
          />
          <DeptCard
            title="Finance"
            icon={Wallet}
            to="/admin/fees"
            rows={[
              ["Collected today", fmtMoney(collectedToday)],
              ["Outstanding", fmtMoney(outstanding)],
              ["Overdue > 30d", `${overdue30.length}`],
            ]}
          />
          <DeptCard
            title="Student Services"
            icon={HeartPulse}
            to="/admin/student-intelligence"
            rows={[
              ["At-risk students", "See Intelligence"],
              ["Clinic visits today", "0"],
              ["Behavioral incidents", "0"],
            ]}
          />
          <DeptCard
            title="Staff Management"
            icon={Users}
            to="/admin/teacher-intelligence"
            rows={[
              ["Teachers present", `${presentNow} / ${totalTeachers}`],
              ["Active sessions (1h)", `${activeSessions}`],
              ["On leave", "—"],
            ]}
          />
        </div>
      </div>

      {/* Alerts + Calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="h-4 w-4" /> Alerts & Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(notifs.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No unread notifications 🎉</p>
            )}
            {(notifs.data ?? []).map((n: any) => {
              const sev = (n.type || "info").toLowerCase();
              const tone: Tone =
                sev.includes("critical") || sev.includes("error")
                  ? "red"
                  : sev.includes("warn")
                    ? "amber"
                    : "blue";
              const Icon = tone === "red" ? AlertTriangle : tone === "amber" ? AlertTriangle : Info;
              return (
                <div
                  key={n.id}
                  className={cn("flex items-start gap-3 rounded-lg border p-3", toneRing[tone])}
                >
                  <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{n.title || "Notification"}</p>
                    {n.message && <p className="text-xs opacity-80 line-clamp-2">{n.message}</p>}
                    <p className="text-[11px] opacity-70 mt-1">{fmtRel(n.created_at)}</p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={async () => {
                      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
                      qc.invalidateQueries({ queryKey: ["ops", "notifs"] });
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarIcon className="h-4 w-4" /> Next 7 Days
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(events.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No upcoming events</p>
            )}
            {(events.data ?? []).map((e: any) => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                <div className="h-10 w-10 rounded-md grid place-items-center bg-primary/10 text-primary shrink-0">
                  <span className="text-xs font-bold">
                    {new Date(e.event_date).toLocaleDateString([], { day: "2-digit" })}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{e.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(e.event_date).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                    {e.event_time ? ` · ${e.event_time.slice(0, 5)}` : ""}
                    {e.event_type ? ` · ${e.event_type}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PortalPage>
  );
}

/* ---------- Department Card ---------- */
function DeptCard({
  title,
  icon: Icon,
  rows,
  to,
}: {
  title: string;
  icon: any;
  rows: [string, string][];
  to: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-medium">{v}</span>
          </div>
        ))}
        <Button size="sm" variant="ghost" className="w-full mt-2" asChild>
          <Link to={to}>View details →</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ---------- Compose Dialog ---------- */
function ComposeDialog({
  kind,
  schoolId,
  onClose,
}: {
  kind: "announcement" | "emergency";
  schoolId?: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(kind === "emergency" ? "Emergency Alert" : "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!schoolId || !message.trim()) return;
    setSending(true);
    const { data: users } = await supabase
      .from("users")
      .select("id")
      .eq("school_id", schoolId)
      .eq("is_active", true);
    const rows = (users ?? []).map((u: any) => ({
      school_id: schoolId,
      user_id: u.id,
      title: title || (kind === "emergency" ? "Emergency Alert" : "School Announcement"),
      message,
      type: kind === "emergency" ? "critical" : "info",
    }));
    if (rows.length) {
      const { error } = await supabase.from("notifications").insert(rows);
      if (error) {
        toast.error(error.message);
        setSending(false);
        return;
      }
    }
    toast.success(
      `${kind === "emergency" ? "Emergency alert" : "Announcement"} sent to ${rows.length} users`,
    );
    setSending(false);
    onClose();
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {kind === "emergency" ? (
            <Siren className="h-4 w-4 text-red-500" />
          ) : (
            <Megaphone className="h-4 w-4" />
          )}
          {kind === "emergency" ? "Send Emergency Alert" : "Send School Announcement"}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          rows={5}
          placeholder="Message to broadcast to all users"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        {kind === "emergency" && (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            Will notify every active user immediately
          </Badge>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={send}
          disabled={sending || !message.trim()}
          variant={kind === "emergency" ? "destructive" : "default"}
        >
          <CheckCircle2 className="h-4 w-4 mr-1.5" />
          {sending ? "Sending…" : "Send"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
