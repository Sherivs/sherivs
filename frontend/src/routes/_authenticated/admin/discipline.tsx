import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Plus, CheckCircle2, AlertTriangle, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  GlassCard,
  StatCard,
  SectionGrid,
  PortalPageSkeleton,
  EmptyState,
} from "@/components/portal-shell";
import { StudentSelect } from "@/components/admin/student-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/discipline")({
  ssr: false,
  component: DisciplinePage,
});

type Incident = {
  id: string;
  student_id: string | null;
  incident_date: string;
  incident_type: string;
  description: string;
  severity: string;
  action_taken: string | null;
  parent_notified: boolean;
  follow_up_required: boolean;
  follow_up_date: string | null;
  resolved: boolean;
};

const SEVERITY = ["minor", "moderate", "serious", "critical"] as const;
const SEV_COLOR: Record<string, string> = {
  minor: "text-green-400",
  moderate: "text-yellow-400",
  serious: "text-orange-400",
  critical: "text-red-400",
} as any;

function DisciplinePage() {
  const { profile } = useApp();
  const schoolId = profile?.school_id ?? "";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fSev, setFSev] = useState<string>("all");
  const [fResolved, setFResolved] = useState<string>("all");
  const [fStudent, setFStudent] = useState<string>("");

  const recQ = useQuery({
    queryKey: ["discipline", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discipline_records")
        .select("*")
        .eq("school_id", schoolId)
        .order("incident_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Incident[];
    },
  });

  const namesQ = useQuery({
    queryKey: ["disc-names", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data: students } = await supabase
        .from("students")
        .select("id, user_id")
        .eq("school_id", schoolId);
      const ids = (students ?? []).map((s: any) => s.user_id).filter(Boolean);
      const map = new Map<string, string>();
      if (ids.length) {
        const { data: users } = await supabase.from("users").select("id, full_name").in("id", ids);
        const byUid = new Map((users ?? []).map((u: any) => [u.id, u.full_name as string]));
        (students ?? []).forEach((s: any) => map.set(s.id, byUid.get(s.user_id) ?? "Unnamed"));
      }
      return map;
    },
  });

  const records = recQ.data ?? [];
  const filtered = useMemo(
    () =>
      records.filter(
        (r) =>
          (fSev === "all" || r.severity === fSev) &&
          (fResolved === "all" || (fResolved === "yes" ? r.resolved : !r.resolved)) &&
          (!fStudent || r.student_id === fStudent),
      ),
    [records, fSev, fResolved, fStudent],
  );

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const total = records.length;
  const open_ = records.filter((r) => !r.resolved).length;
  const seriousOpen = records.filter(
    (r) => !r.resolved && (r.severity === "serious" || r.severity === "critical"),
  ).length;
  const resolvedThisMonth = records.filter(
    (r) => r.resolved && r.incident_date >= monthStartStr,
  ).length;

  const repeat = useMemo(() => {
    const termCutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    records
      .filter((r) => r.incident_date >= termCutoff && r.student_id)
      .forEach((r) => {
        counts.set(r.student_id!, (counts.get(r.student_id!) ?? 0) + 1);
      });
    return [...counts.entries()].filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]);
  }, [records]);

  const typeBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    records.forEach((r) => counts.set(r.incident_type, (counts.get(r.incident_type) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [records]);

  const monthlyTrend = useMemo(() => {
    const arr: { m: string; n: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      d.setDate(1);
      const key = d.toISOString().slice(0, 7);
      arr.push({ m: d.toLocaleString(undefined, { month: "short" }), n: 0 });
      records.forEach((r) => {
        if (r.incident_date.startsWith(key)) arr[arr.length - 1].n++;
      });
    }
    return arr;
  }, [records]);
  const maxTrend = Math.max(1, ...monthlyTrend.map((x) => x.n));

  const resolve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("discipline_records")
        .update({ resolved: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Resolved");
      qc.invalidateQueries({ queryKey: ["discipline"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (recQ.isLoading) return <PortalPageSkeleton />;

  return (
    <PortalPage
      title="Discipline & Behavior Management"
      subtitle="Track incidents, severity and follow-through"
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Record incident
        </Button>
      }
    >
      <SectionGrid>
        <StatCard label="Total incidents" value={total} />
        <StatCard label="Open" value={open_} />
        <StatCard label="Serious/Critical open" value={seriousOpen} />
        <StatCard label="Resolved this month" value={resolvedThisMonth} />
      </SectionGrid>

      {repeat.length > 0 && (
        <GlassCard>
          <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2 text-red-400">
            <AlertTriangle className="size-5" /> Repeat offenders (last 90 days)
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {repeat.map(([sid, n]) => (
              <li
                key={sid}
                className="border border-red-500/30 bg-red-500/10 rounded-lg p-3 text-sm flex justify-between"
              >
                <span>{namesQ.data?.get(sid) ?? "Unnamed"}</span>
                <span className="text-red-400 font-semibold">{n} incidents</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <GlassCard>
        <div className="flex flex-wrap gap-3 items-end mb-3">
          <h2 className="font-display text-lg font-semibold flex items-center gap-2 mr-auto">
            <ShieldAlert className="size-5 text-primary" /> Incidents
          </h2>
          <div className="min-w-[160px]">
            <Label>Severity</Label>
            <Select value={fSev} onValueChange={setFSev}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {SEVERITY.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <Label>Resolved</Label>
            <Select value={fResolved} onValueChange={setFResolved}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="yes">Resolved</SelectItem>
                <SelectItem value="no">Open</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[220px]">
            <Label>Student</Label>
            <StudentSelect value={fStudent} onChange={setFStudent} placeholder="All students" />
          </div>
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="size-6" />}
            title="No incidents"
            description="Record your first incident to start tracking behavior."
          />
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Student</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Severity</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Parent</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 align-top">
                    <td className="p-2 whitespace-nowrap">{r.incident_date}</td>
                    <td className="p-2">
                      {r.student_id ? (namesQ.data?.get(r.student_id) ?? "—") : "—"}
                    </td>
                    <td className="p-2">
                      {r.incident_type}
                      <div className="text-xs text-muted-foreground max-w-[240px] truncate">
                        {r.description}
                      </div>
                    </td>
                    <td className={cn("p-2 capitalize font-medium", SEV_COLOR[r.severity])}>
                      {r.severity}
                    </td>
                    <td className="p-2 max-w-[200px] truncate">{r.action_taken ?? "—"}</td>
                    <td className="p-2">{r.parent_notified ? "Yes" : "No"}</td>
                    <td className="p-2">{r.resolved ? "Resolved" : "Open"}</td>
                    <td className="p-2 text-right">
                      {!r.resolved && (
                        <Button size="sm" variant="outline" onClick={() => resolve.mutate(r.id)}>
                          <CheckCircle2 className="size-3.5 mr-1" /> Resolve
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard>
          <h2 className="font-display text-lg font-semibold mb-3">Incident type breakdown</h2>
          {typeBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data.</p>
          ) : (
            <div className="space-y-2">
              {typeBreakdown.map(([type, n]) => (
                <div key={type}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{type}</span>
                    <span className="font-mono">{n}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${(n / typeBreakdown[0][1]) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
        <GlassCard>
          <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" /> Monthly trend
          </h2>
          <svg viewBox="0 0 300 120" className="w-full h-32">
            {monthlyTrend.map((d, i) => {
              const h = (d.n / maxTrend) * 90;
              return (
                <g key={i}>
                  <rect
                    x={i * 50 + 10}
                    y={100 - h}
                    width={30}
                    height={h}
                    rx={4}
                    className="fill-primary/70"
                  />
                  <text
                    x={i * 50 + 25}
                    y={115}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {d.m}
                  </text>
                  <text
                    x={i * 50 + 25}
                    y={95 - h}
                    textAnchor="middle"
                    className="fill-foreground text-[10px]"
                  >
                    {d.n || ""}
                  </text>
                </g>
              );
            })}
          </svg>
        </GlassCard>
      </div>

      {open && (
        <IncidentDialog
          schoolId={schoolId}
          recordedBy={profile?.id ?? ""}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ["discipline"] });
          }}
        />
      )}
    </PortalPage>
  );
}

function IncidentDialog({
  schoolId,
  recordedBy,
  onClose,
  onSaved,
}: {
  schoolId: string;
  recordedBy: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    student_id: "",
    incident_date: new Date().toISOString().slice(0, 10),
    incident_type: "",
    description: "",
    severity: "minor" as string,
    action_taken: "",
    parent_notified: false,
    follow_up_required: false,
    follow_up_date: "",
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("discipline_records").insert({
        school_id: schoolId,
        recorded_by: recordedBy || null,
        student_id: form.student_id || null,
        incident_date: form.incident_date,
        incident_type: form.incident_type,
        description: form.description,
        severity: form.severity,
        action_taken: form.action_taken || null,
        parent_notified: form.parent_notified,
        parent_notified_at: form.parent_notified ? new Date().toISOString() : null,
        follow_up_required: form.follow_up_required,
        follow_up_date: form.follow_up_date || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Incident recorded");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record incident</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Student</Label>
            <StudentSelect
              value={form.student_id}
              onChange={(id) => setForm({ ...form, student_id: id })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={form.incident_date}
                onChange={(e) => setForm({ ...form, incident_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Input
                placeholder="e.g. Fighting, Bullying"
                value={form.incident_type}
                onChange={(e) => setForm({ ...form, incident_type: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Severity</Label>
              <Select
                value={form.severity}
                onValueChange={(v) => setForm({ ...form, severity: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Follow-up date</Label>
              <Input
                type="date"
                value={form.follow_up_date}
                onChange={(e) =>
                  setForm({
                    ...form,
                    follow_up_date: e.target.value,
                    follow_up_required: !!e.target.value,
                  })
                }
              />
            </div>
          </div>
          <div>
            <Label>Action taken</Label>
            <Textarea
              rows={2}
              value={form.action_taken}
              onChange={(e) => setForm({ ...form, action_taken: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.parent_notified}
              onChange={(e) => setForm({ ...form, parent_notified: e.target.checked })}
            />
            Parent notified
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={
              !form.student_id || !form.incident_type || !form.description || save.isPending
            }
          >
            {save.isPending ? "Saving…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
