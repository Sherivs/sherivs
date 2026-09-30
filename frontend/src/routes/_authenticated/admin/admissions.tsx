/**
 * Admin: admissions inbox + decision flow.
 * Real-time via Supabase channel + TanStack Query invalidation.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  SectionGrid,
  StatCard,
  PortalPagination,
  usePagination,
  GlassCard,
} from "@/components/portal-shell";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/admissions")({
  ssr: false,
  component: AdmissionsAdmin,
});

type App = {
  id: string;
  school_id: string;
  application_number: string;
  status: string;
  submitted_at: string;
  student_first_name: string;
  student_last_name: string;
  student_date_of_birth: string;
  student_gender: string | null;
  student_nationality: string | null;
  student_religion: string | null;
  student_blood_group: string | null;
  student_genotype: string | null;
  student_address: string | null;
  applying_for_class: string;
  academic_year_applying: string;
  previous_school_name: string | null;
  previous_class_completed: string | null;
  reason_for_leaving: string | null;
  academic_achievements: string | null;
  was_disciplined: boolean | null;
  discipline_explanation: string | null;
  parent_one_name: string;
  parent_one_relationship: string;
  parent_one_phone: string;
  parent_one_email: string;
  parent_one_occupation: string | null;
  parent_two_name: string | null;
  parent_two_phone: string | null;
  parent_two_email: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_conditions: string | null;
  disabilities_or_special_needs: string | null;
  allergies_detail: string | null;
  documents_uploaded: Record<string, { url: string; name: string }> | null;
  interview_responses: Record<string, string> | null;
  interview_date: string | null;
  decision_notes: string | null;
};

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "interview_scheduled", label: "Reviewing" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "accepted", label: "Admitted" },
  { key: "rejected", label: "Rejected" },
  { key: "waitlist", label: "Waitlist" },
  { key: "withdrawn", label: "Withdrawn" },
] as const;

const PIPELINE_COLUMNS: { key: string; label: string; tone: string }[] = [
  { key: "pending", label: "Pending", tone: "border-amber-500/30 bg-amber-500/5" },
  { key: "interview_scheduled", label: "Reviewing", tone: "border-sky-500/30 bg-sky-500/5" },
  { key: "shortlisted", label: "Shortlisted", tone: "border-violet-500/30 bg-violet-500/5" },
  { key: "accepted", label: "Admitted", tone: "border-emerald-500/30 bg-emerald-500/5" },
  { key: "rejected", label: "Rejected", tone: "border-rose-500/30 bg-rose-500/5" },
  { key: "waitlist", label: "Waitlist", tone: "border-orange-500/30 bg-orange-500/5" },
];

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  interview_scheduled: "Reviewing",
  shortlisted: "Shortlisted",
  accepted: "Admitted",
  rejected: "Rejected",
  waitlist: "Waitlist",
  withdrawn: "Withdrawn",
};

function statusBadge(s: string) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    interview_scheduled: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    shortlisted: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    accepted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    rejected: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    waitlist: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    withdrawn: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  };
  return map[s] ?? "bg-white/5 text-white/60 border-white/10";
}

function AdmissionsAdmin() {
  const { school } = useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sid = school?.id;

  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]["key"]>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const q = useQuery<App[]>({
    queryKey: ["adm-apps", sid],
    enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admission_applications")
        .select("*")
        .eq("school_id", sid!)
        .order("submitted_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as App[];
    },
  });

  // Realtime
  useEffect(() => {
    if (!sid) return;
    const channel = supabase
      .channel(`adm-apps-${sid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "admission_applications",
          filter: `school_id=eq.${sid}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["adm-apps", sid] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sid, qc]);

  const apps = q.data ?? [];

  const classOptions = useMemo(
    () => Array.from(new Set(apps.map((a) => a.applying_for_class).filter(Boolean))).sort(),
    [apps],
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate).getTime() : null;
    const to = toDate ? new Date(toDate).getTime() + 86_400_000 : null;
    return apps.filter((a) => {
      if (filter !== "all" && a.status !== filter) return false;
      if (classFilter !== "all" && a.applying_for_class !== classFilter) return false;
      if (s) {
        const hay =
          `${a.student_first_name} ${a.student_last_name} ${a.parent_one_name} ${a.application_number}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      const t = new Date(a.submitted_at).getTime();
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });
  }, [apps, filter, classFilter, search, fromDate, toDate]);

  const nowDate = new Date();
  const startOfMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  const counts = useMemo(() => {
    const thisMonth = apps.filter((a) => new Date(a.submitted_at).getTime() >= startOfMonth).length;
    const pending = apps.filter((a) => a.status === "pending").length;
    const reviewing = apps.filter((a) => a.status === "interview_scheduled").length;
    const shortlisted = apps.filter((a) => a.status === "shortlisted").length;
    const accepted = apps.filter((a) => a.status === "accepted").length;
    const rejected = apps.filter((a) => a.status === "rejected").length;
    const waitlist = apps.filter((a) => a.status === "waitlist").length;
    const decided = accepted + rejected;
    const conversion = decided > 0 ? Math.round((accepted / decided) * 100) : 0;
    return {
      total: apps.length,
      thisMonth,
      pending,
      reviewing,
      shortlisted,
      accepted,
      rejected,
      waitlist,
      conversion,
    };
  }, [apps, startOfMonth]);

  const pipelineGroups = useMemo(() => {
    const groups: Record<string, App[]> = {};
    for (const col of PIPELINE_COLUMNS) groups[col.key] = [];
    for (const a of apps) if (groups[a.status]) groups[a.status].push(a);
    return groups;
  }, [apps]);

  const monthly = useMemo(() => {
    const buckets: { label: string; count: number; key: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString(undefined, { month: "short" }),
        count: 0,
      });
    }
    for (const a of apps) {
      const d = new Date(a.submitted_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const b = buckets.find((x) => x.key === key);
      if (b) b.count += 1;
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps]);

  const classDemand = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of apps) map.set(a.applying_for_class, (map.get(a.applying_for_class) ?? 0) + 1);
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [apps]);

  const sourceBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of apps) {
      const src = (a as unknown as { source?: string }).source ?? "online";
      map.set(src, (map.get(src) ?? 0) + 1);
    }
    return Array.from(map.entries());
  }, [apps]);

  const funnel = [
    { label: "Applied", value: counts.total },
    {
      label: "Reviewed",
      value: counts.reviewing + counts.shortlisted + counts.accepted + counts.rejected,
    },
    { label: "Shortlisted", value: counts.shortlisted + counts.accepted },
    { label: "Admitted", value: counts.accepted },
  ];

  const selected = apps.find((a) => a.id === openId) ?? null;
  const { page, pageCount, pageItems } = usePagination(filtered, 20);

  const moveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("admission_applications")
        .update({ status })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Moved");
      qc.invalidateQueries({ queryKey: ["adm-apps", sid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <PortalPage
      title="Admissions Intelligence"
      subtitle="AI-powered enrollment management and applicant tracking"
    >
      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          ← Dashboard
        </Link>
        <a
          href="/admissions"
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          Public admissions form ↗
        </a>
      </div>

      <SectionGrid>
        <StatCard label="This month" value={counts.thisMonth} />
        <StatCard label="Pending review" value={counts.pending + counts.reviewing} />
        <StatCard label="Shortlisted" value={counts.shortlisted} />
        <StatCard label="Admitted" value={counts.accepted} />
        <StatCard label="Waitlist" value={counts.waitlist} />
        <StatCard label="Conversion" value={`${counts.conversion}%`} />
      </SectionGrid>

      {/* Pipeline Kanban */}
      <div className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Admissions pipeline</h2>
          <span className="text-xs text-muted-foreground">Use the "Move to…" menu on any card</span>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-3 sm:grid sm:min-w-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {PIPELINE_COLUMNS.map((col) => {
              const items = pipelineGroups[col.key] ?? [];
              return (
                <div
                  key={col.key}
                  className={`w-72 shrink-0 rounded-xl border p-3 sm:w-auto ${col.tone}`}
                >
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-widest text-foreground/80">
                    <span>{col.label}</span>
                    <span className="rounded-full bg-background/60 px-2 py-0.5">
                      {items.length}
                    </span>
                  </div>
                  <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                    {items.length === 0 && (
                      <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-[11px] text-muted-foreground">
                        Empty
                      </p>
                    )}
                    {items.slice(0, 30).map((a) => (
                      <div
                        key={a.id}
                        className="rounded-md border border-border/60 bg-background/70 p-2 text-xs shadow-sm"
                      >
                        <button
                          onClick={() => setOpenId(a.id)}
                          className="block w-full text-left font-medium hover:underline"
                        >
                          {a.student_first_name} {a.student_last_name}
                        </button>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {a.applying_for_class} · {new Date(a.submitted_at).toLocaleDateString()}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-muted-foreground">
                          {a.parent_one_name} · {a.parent_one_phone}
                        </div>
                        <select
                          className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]"
                          value={a.status}
                          onChange={(e) =>
                            moveMutation.mutate({ id: a.id, status: e.target.value })
                          }
                        >
                          {PIPELINE_COLUMNS.map((c) => (
                            <option key={c.key} value={c.key}>
                              Move to {c.label}
                            </option>
                          ))}
                          <option value="withdrawn">Move to Withdrawn</option>
                        </select>
                      </div>
                    ))}
                    {items.length > 30 && (
                      <p className="pt-1 text-center text-[11px] text-muted-foreground">
                        +{items.length - 30} more
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-10 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input
          type="search"
          placeholder="Search name, parent, app #"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm lg:col-span-2"
        />
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="all">All classes</option>
          {classOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              "rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest transition " +
              (filter === f.key
                ? "bg-foreground text-background"
                : "border border-border text-muted-foreground hover:bg-muted/40")
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">App No.</th>
              <th className="px-4 py-3 text-left">Student</th>
              <th className="px-4 py-3 text-left">Parent</th>
              <th className="px-4 py-3 text-left">Class</th>
              <th className="px-4 py-3 text-left">Submitted</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  {q.isLoading ? "Loading…" : "No applications match this filter."}
                </td>
              </tr>
            )}
            {pageItems.map((a) => (
              <tr
                key={a.id}
                className="cursor-pointer hover:bg-muted/20"
                onClick={() => setOpenId(a.id)}
              >
                <td className="px-4 py-3 font-mono text-xs">{a.application_number}</td>
                <td className="px-4 py-3 font-medium">
                  {a.student_first_name} {a.student_last_name}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  <div className="text-xs">{a.parent_one_name}</div>
                  <div className="text-[11px]">{a.parent_one_phone}</div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{a.applying_for_class}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(a.submitted_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      "inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest " +
                      statusBadge(a.status)
                    }
                  >
                    {STATUS_LABEL[a.status] ?? a.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setOpenId(a.id)}
                    className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted/40"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <PortalPagination page={page} pageCount={pageCount} />
      </div>

      {/* Analytics + forecast */}
      <div className="mt-10 grid gap-4 lg:grid-cols-3">
        <GlassCard className="lg:col-span-2">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Monthly applications
          </h3>
          <MonthlyChart data={monthly} />
        </GlassCard>
        <GlassCard>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Conversion funnel
          </h3>
          <div className="mt-4 space-y-2">
            {funnel.map((f, i) => {
              const max = funnel[0].value || 1;
              const pct = Math.max(4, Math.round((f.value / max) * 100));
              return (
                <div key={f.label}>
                  <div className="flex justify-between text-xs">
                    <span>{f.label}</span>
                    <span className="font-mono">{f.value}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted/30">
                    <div
                      className={
                        "h-full " +
                        ["bg-sky-400", "bg-violet-400", "bg-amber-400", "bg-emerald-400"][i]
                      }
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Source breakdown
          </h3>
          <div className="mt-4 space-y-1 text-sm">
            {sourceBreakdown.length === 0 && (
              <p className="text-xs text-muted-foreground">No data yet.</p>
            )}
            {sourceBreakdown.map(([src, n]) => (
              <div key={src} className="flex justify-between border-b border-border/40 py-1.5">
                <span className="capitalize">{src.replace("_", " ")}</span>
                <span className="font-mono text-xs">{n}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Top class demand
          </h3>
          <div className="mt-4 space-y-2">
            {classDemand.length === 0 && (
              <p className="text-xs text-muted-foreground">No data yet.</p>
            )}
            {classDemand.map(([cls, n]) => {
              const max = classDemand[0]?.[1] ?? 1;
              const pct = Math.max(6, Math.round((n / max) * 100));
              return (
                <div key={cls}>
                  <div className="flex justify-between text-xs">
                    <span>{cls}</span>
                    <span className="font-mono">{n}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted/30">
                    <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Enrollment forecast
          </h3>
          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="text-xs text-muted-foreground">If all shortlisted are admitted</div>
              <div className="mt-1 text-2xl font-semibold text-emerald-300">
                +{counts.shortlisted + counts.accepted} new students
              </div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">
                Expected intake (pipeline × conversion)
              </div>
              <div className="mt-1 text-2xl font-semibold">
                ~
                {Math.round(
                  ((counts.pending + counts.reviewing + counts.shortlisted) *
                    (counts.conversion || 50)) /
                    100,
                ) + counts.accepted}{" "}
                students
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Forecast uses current pipeline × historical conversion rate (
              {counts.conversion || "—"}%).
            </p>
          </div>
        </GlassCard>
      </div>

      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
          {selected && (
            <DetailSheet
              app={selected}
              onChanged={() => qc.invalidateQueries({ queryKey: ["adm-apps", sid] })}
              onClose={() => setOpenId(null)}
              onEnroll={(app) => {
                setOpenId(null);
                navigate({
                  to: "/admin/students",
                  search: {
                    prefill: app.id,
                  } as never,
                });
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </PortalPage>
  );
}

/* ------------------------------------------------------------------ */

function DetailSheet({
  app,
  onChanged,
  onClose,
  onEnroll,
}: {
  app: App;
  onChanged: () => void;
  onClose: () => void;
  onEnroll: (a: App) => void;
}) {
  const [status, setStatus] = useState(app.status);
  const [interviewDate, setInterviewDate] = useState(
    app.interview_date ? app.interview_date.slice(0, 16) : "",
  );
  const [notes, setNotes] = useState(app.decision_notes ?? "");
  const [saving, setSaving] = useState(false);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("admission_applications")
        .update({
          status,
          interview_date:
            status === "interview_scheduled" && interviewDate
              ? new Date(interviewDate).toISOString()
              : null,
          decision_notes: notes || null,
        })
        .eq("id", app.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Application updated");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setSaving(false),
  });

  async function signedUrlFor(path: string) {
    const { data } = await supabase.storage
      .from("student-documents")
      .createSignedUrl(path, 60 * 10);
    return data?.signedUrl;
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {app.student_first_name} {app.student_last_name}
        </SheetTitle>
        <SheetDescription>
          App #{app.application_number} · Applying for {app.applying_for_class} ·{" "}
          {app.academic_year_applying}
        </SheetDescription>
      </SheetHeader>

      <Tabs defaultValue="student" className="mt-6">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="student">Student</TabsTrigger>
          <TabsTrigger value="academic">Academic</TabsTrigger>
          <TabsTrigger value="family">Family</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="interview">Interview</TabsTrigger>
          <TabsTrigger value="decision">Decision</TabsTrigger>
        </TabsList>

        <TabsContent value="student" className="space-y-2 pt-4 text-sm">
          <Field k="Date of Birth" v={app.student_date_of_birth} />
          <Field k="Gender" v={app.student_gender} />
          <Field k="Nationality" v={app.student_nationality} />
          <Field k="Religion" v={app.student_religion} />
          <Field k="Blood Group" v={app.student_blood_group} />
          <Field k="Genotype" v={app.student_genotype} />
          <Field k="Address" v={app.student_address} />
          <Field k="Medical Conditions" v={app.medical_conditions} />
          <Field k="Special Needs" v={app.disabilities_or_special_needs} />
          <Field k="Allergies" v={app.allergies_detail} />
        </TabsContent>

        <TabsContent value="academic" className="space-y-2 pt-4 text-sm">
          <Field k="Previous School" v={app.previous_school_name} />
          <Field k="Class Completed" v={app.previous_class_completed} />
          <Field k="Reason for Leaving" v={app.reason_for_leaving} />
          <Field k="Achievements" v={app.academic_achievements} />
          <Field k="Ever Disciplined" v={app.was_disciplined ? "Yes" : "No"} />
          {app.was_disciplined && <Field k="Explanation" v={app.discipline_explanation} />}
        </TabsContent>

        <TabsContent value="family" className="space-y-2 pt-4 text-sm">
          <Field k="Parent 1" v={`${app.parent_one_name} (${app.parent_one_relationship})`} />
          <Field k="Phone" v={app.parent_one_phone} />
          <Field k="Email" v={app.parent_one_email} />
          <Field k="Occupation" v={app.parent_one_occupation} />
          {app.parent_two_name && (
            <>
              <Field k="Parent 2" v={app.parent_two_name} />
              <Field k="Phone" v={app.parent_two_phone} />
              <Field k="Email" v={app.parent_two_email} />
            </>
          )}
          <Field k="Emergency Contact" v={app.emergency_contact_name} />
          <Field k="Emergency Phone" v={app.emergency_contact_phone} />
        </TabsContent>

        <TabsContent value="documents" className="space-y-3 pt-4">
          {app.documents_uploaded && Object.keys(app.documents_uploaded).length > 0 ? (
            Object.entries(app.documents_uploaded).map(([k, v]) => (
              <button
                key={k}
                onClick={async () => {
                  const url = await signedUrlFor(v.url);
                  if (url) window.open(url, "_blank");
                  else toast.error("Could not open file");
                }}
                className="flex w-full items-center justify-between rounded-md border border-border px-4 py-2 text-left text-sm hover:bg-muted/40"
              >
                <span className="font-medium">{k.replace("_", " ")}</span>
                <span className="text-xs text-muted-foreground">{v.name} →</span>
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No documents uploaded.</p>
          )}
        </TabsContent>

        <TabsContent value="interview" className="space-y-4 pt-4 text-sm">
          {app.interview_responses && Object.keys(app.interview_responses).length > 0 ? (
            Object.entries(app.interview_responses).map(([qid, ans]) => (
              <div key={qid} className="rounded-md border border-border p-3">
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {qid}
                </div>
                <p className="mt-2 whitespace-pre-line">{ans}</p>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground">Applicant has not completed the pre-screening.</p>
          )}
        </TabsContent>

        <TabsContent value="decision" className="space-y-4 pt-4 text-sm">
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Status
            </label>
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="interview_scheduled">Interview Scheduled</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="withdrawn">Withdrawn</option>
            </select>
          </div>
          {status === "interview_scheduled" && (
            <div>
              <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Interview Date
              </label>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={interviewDate}
                onChange={(e) => setInterviewDate(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Decision Notes
            </label>
            <textarea
              rows={4}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                setSaving(true);
                updateMutation.mutate();
              }}
              disabled={saving || updateMutation.isPending}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-60"
            >
              {updateMutation.isPending ? "Saving…" : "Update Status"}
            </button>
            {status === "accepted" && (
              <button
                onClick={() => onEnroll(app)}
                className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20"
              >
                Enroll Student →
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted/40"
            >
              Close
            </button>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Field({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v?.toString().trim() || "—"}</span>
    </div>
  );
}

function MonthlyChart({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const W = 560;
  const H = 180;
  const pad = 24;
  const bw = (W - pad * 2) / data.length;
  return (
    <div className="mt-4 w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[420px] w-full">
        <line
          x1={pad}
          y1={H - pad}
          x2={W - pad}
          y2={H - pad}
          className="stroke-border"
          strokeWidth={1}
        />
        {data.map((d, i) => {
          const h = ((H - pad * 2) * d.count) / max;
          const x = pad + i * bw + bw * 0.15;
          const y = H - pad - h;
          const w = bw * 0.7;
          return (
            <g key={d.label + i}>
              <rect x={x} y={y} width={w} height={h} rx={4} className="fill-primary/70" />
              <text
                x={x + w / 2}
                y={y - 4}
                textAnchor="middle"
                className="fill-foreground text-[10px]"
              >
                {d.count || ""}
              </text>
              <text
                x={x + w / 2}
                y={H - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
