import { createFileRoute, Link } from "@tanstack/react-router";
import { SkeletonDashboard } from "@/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bus, Wallet, GraduationCap, CalendarCheck, Bot, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { PreviewPublicSiteCard } from "@/components/preview-public-site";
import { AnnouncementsFeed } from "@/components/announcements-feed";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { initFeePayment, verifyFeePayment } from "@/lib/runtime/scholar/paystack.functions";
import { openPaystackInline } from "@/lib/paystack-inline";

export const Route = createFileRoute("/_authenticated/parent/dashboard")({
  ssr: false,
  component: ParentDashboard,
});

type Fee = {
  id: string;
  fee_type: string;
  amount: number;
  paid_amount: number | null;
  status: string | null;
  due_date: string | null;
  term: string | null;
  academic_year: string | null;
  student_id: string;
};
type ChildEntry = {
  student_id: string;
  full_name: string;
  admission_number: string | null;
  class_id: string | null;
};
type Bus = {
  id: string;
  bus_number: string;
  route_name: string | null;
  current_status: string | null;
  last_location_update: string | null;
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function ParentDashboard() {
  const { profile } = useApp();
  const parentId = profile?.id;
  const qc = useQueryClient();
  const init = useServerFn(initFeePayment);
  const verify = useServerFn(verifyFeePayment);
  const [paying, setPaying] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);

  const children = useQuery<ChildEntry[]>({
    queryKey: ["parent-children-detail", parentId],
    enabled: !!parentId,
    queryFn: async () => {
      const { data: links } = await supabase
        .from("parent_student_map")
        .select("student_id")
        .eq("parent_id", parentId!);
      const ids = (links ?? []).map((r) => r.student_id as string);
      if (ids.length === 0) return [];
      const { data: students } = await supabase
        .from("students")
        .select("id, admission_number, user_id, class_id")
        .in("id", ids);
      const userIds = (students ?? []).map((s) => s.user_id as string).filter(Boolean);
      const nameMap = new Map<string, string>();
      if (userIds.length) {
        const { data: users } = await supabase
          .from("users")
          .select("id, full_name")
          .in("id", userIds);
        (users ?? []).forEach((u) => nameMap.set(u.id as string, (u.full_name as string) ?? ""));
      }
      return (students ?? []).map((s) => ({
        student_id: s.id as string,
        full_name: nameMap.get(s.user_id as string) ?? "Child",
        admission_number: (s.admission_number as string) ?? null,
        class_id: (s.class_id as string) ?? null,
      }));
    },
  });

  useEffect(() => {
    if (children.data && children.data.length > 0 && !selectedChild) {
      setSelectedChild(children.data[0].student_id);
    }
  }, [children.data, selectedChild]);

  const childIds = (children.data ?? []).map((c) => c.student_id);
  const activeChild = children.data?.find((c) => c.student_id === selectedChild) ?? null;
  const activeId = activeChild?.student_id;

  const fees = useQuery<Fee[]>({
    queryKey: ["parent-fees", parentId, childIds.join(",")],
    enabled: childIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fees")
        .select(
          "id, fee_type, amount, paid_amount, status, due_date, term, academic_year, student_id",
        )
        .in("student_id", childIds)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as Fee[];
    },
  });

  const gradesQ = useQuery({
    queryKey: ["parent-grades-recent", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const { data } = await supabase
        .from("grades")
        .select("id, subject, total_score, grade, created_at, is_published")
        .eq("student_id", activeId!)
        .eq("is_published", true)
        .order("created_at", { ascending: false })
        .limit(5);
      return (data ?? []) as {
        id: string;
        subject: string;
        total_score: number | null;
        grade: string | null;
        created_at: string;
      }[];
    },
  });

  const attendance = useQuery({
    queryKey: ["parent-att-56", activeId],
    enabled: !!activeId,
    queryFn: async () => {
      const from = daysAgoISO(56);
      const { data } = await supabase
        .from("attendance")
        .select("date, status")
        .eq("student_id", activeId!)
        .gte("date", from);
      return (data ?? []) as { date: string; status: string }[];
    },
  });

  const busQ = useQuery<Bus | null>({
    queryKey: ["parent-bus", activeId, profile?.school_id],
    enabled: !!activeId && !!profile?.school_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("transport_buses")
        .select(
          "id, bus_number, route_name, current_status, last_location_update, assigned_students",
        )
        .eq("school_id", profile!.school_id!)
        .eq("is_active", true);
      const found = (data ?? []).find((b) => {
        const arr = Array.isArray(b.assigned_students) ? (b.assigned_students as unknown[]) : [];
        return arr.some((v) => typeof v === "string" && v === activeId);
      });
      if (!found) return null;
      return {
        id: found.id as string,
        bus_number: found.bus_number as string,
        route_name: (found.route_name as string) ?? null,
        current_status: (found.current_status as string) ?? null,
        last_location_update: (found.last_location_update as string) ?? null,
      };
    },
  });

  // Realtime bus updates
  useEffect(() => {
    if (!profile?.school_id) return;
    const ch = supabase
      .channel(`parent-bus-${profile.school_id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "transport_buses",
          filter: `school_id=eq.${profile.school_id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["parent-bus"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [profile?.school_id, qc]);

  const todayAttendance = useMemo(() => {
    const t = todayISO();
    return (attendance.data ?? []).find((a) => a.date === t)?.status ?? "not marked";
  }, [attendance.data]);

  const upcomingFee = useMemo(() => {
    if (!activeId) return null;
    const soon = daysAgoISO(-7);
    return (
      (fees.data ?? [])
        .filter(
          (f) =>
            f.student_id === activeId && f.status !== "paid" && f.due_date && f.due_date <= soon,
        )
        .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0] ?? null
    );
  }, [fees.data, activeId]);

  const outstanding = useMemo(
    () =>
      (fees.data ?? [])
        .filter((f) => f.status !== "paid" && (!activeId || f.student_id === activeId))
        .reduce((a, f) => a + Number(f.amount) - Number(f.paid_amount ?? 0), 0),
    [fees.data, activeId],
  );

  const gradeAvg = useMemo(() => {
    const rows = gradesQ.data ?? [];
    if (rows.length === 0) return null;
    return rows.reduce((a, r) => a + Number(r.total_score ?? 0), 0) / rows.length;
  }, [gradesQ.data]);

  const pay = async (fee: Fee) => {
    if (!profile?.email) return toast.error("No email on file");
    setPaying(fee.id);
    try {
      const r = await init({ data: { fee_id: fee.id, email: profile.email } });
      await openPaystackInline(r.access_code, {
        onSuccess: async (tx) => {
          try {
            await verify({ data: { reference: tx.reference } });
          } catch {
            /* webhook */
          }
          toast.success("Payment received — confirming…");
          qc.invalidateQueries({ queryKey: ["parent-fees"] });
          setPaying(null);
        },
        onCancel: () => {
          toast.message("Payment cancelled");
          setPaying(null);
        },
        onError: (err) => {
          toast.error(err.message ?? "Checkout error");
          setPaying(null);
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start payment");
      setPaying(null);
    }
  };

  const childList = children.data ?? [];
  if (children.isLoading) return <SkeletonDashboard />;

  const firstName = profile?.full_name?.split(" ")[0] ?? "Parent";
  const hours = new Date().getHours();
  const salute = hours < 12 ? "Good morning" : hours < 18 ? "Good afternoon" : "Good evening";

  return (
    <PortalPage
      title={`${salute}, ${firstName}`}
      subtitle="Everything happening with your children today"
    >
      <PreviewPublicSiteCard />

      {childList.length === 0 ? (
        <div className="uos-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No children linked to this parent account yet. Ask the school admin to link your child.
          </p>
        </div>
      ) : (
        <>
          {childList.length > 1 && (
            <Tabs
              value={selectedChild ?? childList[0].student_id}
              onValueChange={(v) => setSelectedChild(v)}
              className="mb-6"
            >
              <TabsList className="w-full max-w-full justify-start overflow-x-auto">
                {childList.map((c) => (
                  <TabsTrigger
                    key={c.student_id}
                    value={c.student_id}
                    className="min-h-11 shrink-0"
                  >
                    {c.full_name.split(" ")[0]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {/* Morning Briefing */}
          <div className="uos-card mb-6 p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Today's briefing
            </p>
            <h2 className="mt-1 font-display text-lg">
              Here's what's happening with{" "}
              <span className="text-primary">{activeChild?.full_name ?? "your child"}</span>
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <BriefItem
                icon={<CalendarCheck className="h-4 w-4" />}
                label="Attendance today"
                value={todayAttendance}
                tone={
                  todayAttendance === "present"
                    ? "green"
                    : todayAttendance === "absent"
                      ? "red"
                      : "slate"
                }
              />
              <BriefItem
                icon={<Wallet className="h-4 w-4" />}
                label="Fee due (7 days)"
                value={
                  upcomingFee
                    ? `₦${(Number(upcomingFee.amount) - Number(upcomingFee.paid_amount ?? 0)).toLocaleString()}`
                    : "None"
                }
                tone={upcomingFee ? "amber" : "green"}
              />
              <BriefItem
                icon={<Bus className="h-4 w-4" />}
                label="Bus status"
                value={busQ.data ? (busQ.data.current_status ?? "assigned") : "not assigned"}
                tone={busQ.data ? "blue" : "slate"}
              />
              <BriefItem
                icon={<GraduationCap className="h-4 w-4" />}
                label="Latest grade"
                value={
                  gradesQ.data?.[0]
                    ? `${gradesQ.data[0].subject}: ${gradesQ.data[0].grade ?? gradesQ.data[0].total_score ?? "—"}`
                    : "—"
                }
                tone="slate"
              />
            </ul>
          </div>

          <SectionGrid>
            <StatCard
              label="Grade average"
              value={gradeAvg == null ? "—" : `${gradeAvg.toFixed(1)}%`}
              hint={`${gradesQ.data?.length ?? 0} recent`}
            />
            <StatCard label="Attendance (56d)" value={attRate(attendance.data ?? [])} />
            <StatCard label="Outstanding" value={`₦${outstanding.toLocaleString()}`} />
            <StatCard
              label="Invoices"
              value={(fees.data ?? []).filter((f) => !activeId || f.student_id === activeId).length}
            />
          </SectionGrid>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* Attendance heatmap */}
            <div className="uos-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base">Attendance — last 8 weeks</h3>
                <Link to="/parent/attendance" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </div>
              <AttendanceHeatmap records={attendance.data ?? []} />
              <div className="mt-3 flex gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <i className="h-2 w-2 rounded-sm bg-emerald-500" /> Present
                </span>
                <span className="inline-flex items-center gap-1">
                  <i className="h-2 w-2 rounded-sm bg-rose-500" /> Absent
                </span>
                <span className="inline-flex items-center gap-1">
                  <i className="h-2 w-2 rounded-sm bg-muted" /> No school
                </span>
              </div>
            </div>

            {/* Grade summary */}
            <div className="uos-card p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base">Recent grades</h3>
                <GradeArc value={gradeAvg} />
              </div>
              {(gradesQ.data ?? []).length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No published grades yet.</p>
              ) : (
                <ul className="mt-4 divide-y divide-border/60">
                  {gradesQ.data!.map((g) => (
                    <li key={g.id} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <p className="font-medium">{g.subject}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(g.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="font-mono">
                        {g.total_score ?? "—"}
                        {g.grade ? ` · ${g.grade}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Bus mini */}
          <div className="mt-6 uos-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-3 text-primary">
                  <Bus className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-base">Bus tracking</h3>
                  {busQ.data ? (
                    <p className="text-sm text-muted-foreground">
                      Bus {busQ.data.bus_number}
                      {busQ.data.route_name ? ` · ${busQ.data.route_name}` : ""} —{" "}
                      <span className="text-foreground">
                        {busQ.data.current_status ?? "in service"}
                      </span>
                      {busQ.data.last_location_update ? (
                        <>
                          {" "}
                          · updated {new Date(busQ.data.last_location_update).toLocaleTimeString()}
                        </>
                      ) : null}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No bus assigned to this child yet.
                    </p>
                  )}
                </div>
              </div>
              <Link
                to="/parent/bus-tracking"
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                Live map <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* Fee Status Widget */}
          {outstanding > 0 && (
            <div className="mt-6 uos-card p-5 border-amber-500/30">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-amber-400">
                    Outstanding balance
                  </p>
                  <p className="mt-1 text-2xl font-display">₦{outstanding.toLocaleString()}</p>
                  {upcomingFee && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Next: {upcomingFee.fee_type} · due {upcomingFee.due_date}
                    </p>
                  )}
                </div>
                <Link to="/parent/fees">
                  <Button>Pay now</Button>
                </Link>
              </div>
            </div>
          )}

          {/* Fees list (kept) */}
          <div className="mt-6 uos-card">
            <header className="border-b border-border p-4">
              <h2 className="font-display text-lg font-semibold">Fees & payments</h2>
            </header>
            {(fees.data ?? []).filter((f) => !activeId || f.student_id === activeId).length ===
            0 ? (
              <p className="p-6 text-sm text-muted-foreground">No invoices to display.</p>
            ) : (
              <ul className="divide-y divide-border">
                {(fees.data ?? [])
                  .filter((f) => !activeId || f.student_id === activeId)
                  .map((f) => {
                    const due = Number(f.amount) - Number(f.paid_amount ?? 0);
                    return (
                      <li key={f.id} className="p-4">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold" title={f.fee_type}>
                              {f.fee_type}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[f.term, f.academic_year, f.due_date ? `due ${f.due_date}` : null]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-sm">
                              ₦{Number(f.amount).toLocaleString()}
                            </p>
                            <span className="mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide">
                              {f.status ?? "unpaid"}
                            </span>
                          </div>
                        </div>
                        {f.status !== "paid" && (
                          <Button
                            size="sm"
                            className="mt-3 min-h-11 w-full sm:w-auto"
                            disabled={paying === f.id}
                            onClick={() => pay(f)}
                          >
                            {paying === f.id ? "Opening…" : `Pay ₦${due.toLocaleString()}`}
                          </Button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>

          {/* AI Assistant quick card */}
          <div className="mt-6 uos-card p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-primary/10 p-3 text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="font-display text-base">
                  Ask about {activeChild?.full_name?.split(" ")[0] ?? "your child"}'s school life
                </h3>
                <p className="text-xs text-muted-foreground">
                  Quick answers from live school data.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[
                    "What homework is due this week?",
                    "What is my child's attendance rate?",
                    "Are there any upcoming fees?",
                    "How is my child performing?",
                  ].map((q) => (
                    <Link
                      key={q}
                      to="/parent/ai-assistant"
                      search={{ q } as never}
                      className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted/40"
                    >
                      {q}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <AnnouncementsFeed seeAllHref="/parent/news" />
          </div>
        </>
      )}
    </PortalPage>
  );
}

function attRate(rows: { status: string }[]) {
  if (rows.length === 0) return "—";
  const p = rows.filter((r) => r.status === "present" || r.status === "late").length;
  return `${Math.round((p / rows.length) * 100)}%`;
}

function BriefItem({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "green" | "amber" | "red" | "blue" | "slate";
}) {
  const toneCls = {
    green: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    red: "bg-rose-500/10 text-rose-300 border-rose-500/20",
    blue: "bg-blue-500/10 text-blue-300 border-blue-500/20",
    slate: "bg-muted/30 text-muted-foreground border-border",
  }[tone];
  return (
    <li className={`rounded-lg border p-3 ${toneCls}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-80">
        {icon} {label}
      </div>
      <p className="mt-1 text-sm font-medium capitalize">{value}</p>
    </li>
  );
}

function AttendanceHeatmap({ records }: { records: { date: string; status: string }[] }) {
  const map = new Map(records.map((r) => [r.date, r.status]));
  // 8 weeks × 5 weekdays, most recent Monday on the right
  const cells: { date: string; status: string | null; isSchool: boolean }[] = [];
  const today = new Date();
  // start 56 days ago, walk forward, keep only Mon-Fri
  for (let i = 55; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    cells.push({ date: iso, status: map.get(iso) ?? null, isSchool: true });
  }
  // Trim to last 40 (5x8)
  const trimmed = cells.slice(-40);
  return (
    <div className="mt-4 grid grid-cols-8 gap-1">
      {trimmed.map((c) => {
        let cls = "bg-muted/50";
        if (c.status === "present" || c.status === "late") cls = "bg-emerald-500";
        else if (c.status === "absent") cls = "bg-rose-500";
        return (
          <div
            key={c.date}
            title={`${c.date}: ${c.status ?? "—"}`}
            className={`h-6 rounded-sm ${cls}`}
          />
        );
      })}
    </div>
  );
}

function GradeArc({ value }: { value: number | null }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const r = 22;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c;
  const color = v >= 70 ? "hsl(var(--primary))" : v >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <svg width="60" height="60" viewBox="0 0 60 60">
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeWidth="6"
      />
      {value != null && (
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
        />
      )}
      <text
        x="30"
        y="34"
        textAnchor="middle"
        className="fill-foreground"
        fontSize="12"
        fontWeight="600"
      >
        {value == null ? "—" : `${Math.round(v)}`}
      </text>
    </svg>
  );
}
