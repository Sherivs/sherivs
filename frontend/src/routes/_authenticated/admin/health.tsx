import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartPulse, Plus, TrendingUp, AlertTriangle, Stethoscope, User } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/admin/health")({
  ssr: false,
  component: HealthPage,
});

type Visit = {
  id: string;
  student_id: string | null;
  visit_date: string;
  visit_time: string;
  complaint: string | null;
  diagnosis: string | null;
  treatment: string | null;
  medication_given: string | null;
  temperature: number | null;
  blood_pressure: string | null;
  outcome: string | null;
  parent_notified: boolean;
  attending_nurse: string | null;
  follow_up_date: string | null;
  notes: string | null;
};

const OUTCOMES = ["treated_released", "referred", "resting", "sent_home", "emergency"] as const;

function HealthPage() {
  const { profile } = useApp();
  const schoolId = profile?.school_id ?? "";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fOutcome, setFOutcome] = useState("all");
  const [fStudent, setFStudent] = useState("");

  const visitsQ = useQuery({
    queryKey: ["clinic-visits", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clinic_visits")
        .select("*")
        .eq("school_id", schoolId)
        .order("visit_date", { ascending: false })
        .order("visit_time", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Visit[];
    },
  });

  const studentsQ = useQuery({
    queryKey: ["health-students", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data: students } = await supabase
        .from("students")
        .select(
          "id, user_id, admission_number, blood_group, medical_conditions, parent_name, parent_phone",
        )
        .eq("school_id", schoolId)
        .eq("is_active", true);
      const ids = (students ?? []).map((s: any) => s.user_id).filter(Boolean);
      const nameMap = new Map<string, string>();
      if (ids.length) {
        const { data: users } = await supabase.from("users").select("id, full_name").in("id", ids);
        (users ?? []).forEach((u: any) => nameMap.set(u.id, u.full_name ?? "Unnamed"));
      }
      return (students ?? []).map((s: any) => ({
        ...s,
        full_name: s.user_id ? (nameMap.get(s.user_id) ?? "Unnamed") : "Unnamed",
      }));
    },
  });

  const visits = visitsQ.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const todayVisits = visits.filter((v) => v.visit_date === today);
  const resting = todayVisits.filter((v) => v.outcome === "resting").length;
  const referred = todayVisits.filter(
    (v) => v.outcome === "referred" || v.outcome === "emergency",
  ).length;
  const sentHome = todayVisits.filter((v) => v.outcome === "sent_home").length;

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    (studentsQ.data ?? []).forEach((s: any) => m.set(s.id, s.full_name));
    return m;
  }, [studentsQ.data]);

  const filtered = useMemo(
    () =>
      visits.filter(
        (v) =>
          (!fFrom || v.visit_date >= fFrom) &&
          (!fTo || v.visit_date <= fTo) &&
          (fOutcome === "all" || v.outcome === fOutcome) &&
          (!fStudent || v.student_id === fStudent),
      ),
    [visits, fFrom, fTo, fOutcome, fStudent],
  );

  const commonIllnesses = useMemo(() => {
    const counts = new Map<string, number>();
    visits.forEach((v) => {
      const d = (v.diagnosis ?? "").trim().toLowerCase();
      if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [visits]);

  const monthlyTrend = useMemo(() => {
    const arr: { m: string; n: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      d.setDate(1);
      const key = d.toISOString().slice(0, 7);
      arr.push({ m: d.toLocaleString(undefined, { month: "short" }), n: 0 });
      visits.forEach((v) => {
        if (v.visit_date.startsWith(key)) arr[arr.length - 1].n++;
      });
    }
    return arr;
  }, [visits]);
  const maxTrend = Math.max(1, ...monthlyTrend.map((x) => x.n));

  const repeat = useMemo(() => {
    const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    visits
      .filter((v) => v.visit_date >= cutoff && v.student_id)
      .forEach((v) => counts.set(v.student_id!, (counts.get(v.student_id!) ?? 0) + 1));
    return [...counts.entries()].filter(([, n]) => n > 3).sort((a, b) => b[1] - a[1]);
  }, [visits]);

  if (visitsQ.isLoading) return <PortalPageSkeleton />;

  return (
    <PortalPage
      title="Clinic & Health Management"
      subtitle="Nurse's log, medical records and health analytics"
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Record visit
        </Button>
      }
    >
      <SectionGrid>
        <StatCard label="Visits today" value={todayVisits.length} />
        <StatCard label="Currently resting" value={resting} />
        <StatCard label="Referred / Emergency" value={referred} />
        <StatCard label="Sent home" value={sentHome} />
      </SectionGrid>

      {repeat.length > 0 && (
        <GlassCard>
          <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2 text-orange-400">
            <AlertTriangle className="size-5" /> Repeat visitors (90 days · &gt;3 visits)
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {repeat.map(([sid, n]) => (
              <li
                key={sid}
                className="border border-orange-500/30 bg-orange-500/10 rounded-lg p-3 text-sm flex justify-between"
              >
                <span>{nameById.get(sid) ?? "Unnamed"}</span>
                <span className="text-orange-400 font-semibold">{n} visits</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}

      <GlassCard>
        <div className="flex flex-wrap items-end gap-3 mb-3">
          <h2 className="font-display text-lg font-semibold flex items-center gap-2 mr-auto">
            <Stethoscope className="size-5 text-primary" /> Visit history
          </h2>
          <div>
            <Label>From</Label>
            <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
          </div>
          <div className="min-w-[160px]">
            <Label>Outcome</Label>
            <Select value={fOutcome} onValueChange={setFOutcome}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o.replace(/_/g, " ")}
                  </SelectItem>
                ))}
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
            icon={<HeartPulse className="size-6" />}
            title="No visits"
            description="Record a visit to start building health analytics."
          />
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Student</th>
                  <th className="p-2">Complaint</th>
                  <th className="p-2">Diagnosis</th>
                  <th className="p-2">Outcome</th>
                  <th className="p-2">Parent</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((v) => (
                  <tr key={v.id} className="border-b border-border/50 align-top">
                    <td className="p-2 whitespace-nowrap">
                      {v.visit_date}
                      <div className="text-xs text-muted-foreground">
                        {v.visit_time?.slice(0, 5)}
                      </div>
                    </td>
                    <td className="p-2">
                      {v.student_id ? (nameById.get(v.student_id) ?? "—") : "—"}
                    </td>
                    <td className="p-2 max-w-[200px]">
                      <span className="truncate block">{v.complaint ?? "—"}</span>
                    </td>
                    <td className="p-2 max-w-[200px]">
                      <span className="truncate block">{v.diagnosis ?? "—"}</span>
                    </td>
                    <td className="p-2 capitalize">{v.outcome?.replace(/_/g, " ") ?? "—"}</td>
                    <td className="p-2">{v.parent_notified ? "Notified" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <User className="size-5 text-primary" /> Medical records
        </h2>
        {(studentsQ.data ?? []).filter((s: any) => s.blood_group || s.medical_conditions).length ===
        0 ? (
          <p className="text-sm text-muted-foreground">No medical profiles recorded yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(studentsQ.data ?? [])
              .filter((s: any) => s.blood_group || s.medical_conditions)
              .map((s: any) => (
                <div key={s.id} className="border border-border rounded-lg p-3 text-sm">
                  <div className="font-medium">
                    {s.full_name}{" "}
                    <span className="text-muted-foreground">· {s.admission_number ?? ""}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
                    <div>
                      <span className="text-muted-foreground">Blood:</span> {s.blood_group ?? "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Parent:</span> {s.parent_phone ?? "—"}
                    </div>
                  </div>
                  {s.medical_conditions && (
                    <div className="mt-1 text-xs text-orange-400">⚠ {s.medical_conditions}</div>
                  )}
                </div>
              ))}
          </div>
        )}
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard>
          <h2 className="font-display text-lg font-semibold mb-3">Common illnesses</h2>
          {commonIllnesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <div className="space-y-2">
              {commonIllnesses.map(([d, n]) => (
                <div key={d}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="capitalize">{d}</span>
                    <span className="font-mono">{n}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${(n / commonIllnesses[0][1]) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
        <GlassCard>
          <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" /> Monthly visit trend
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
        <VisitDialog
          schoolId={schoolId}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            qc.invalidateQueries({ queryKey: ["clinic-visits"] });
          }}
        />
      )}
    </PortalPage>
  );
}

function VisitDialog({
  schoolId,
  onClose,
  onSaved,
}: {
  schoolId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    student_id: "",
    visit_date: new Date().toISOString().slice(0, 10),
    visit_time: new Date().toTimeString().slice(0, 5),
    complaint: "",
    diagnosis: "",
    treatment: "",
    medication_given: "",
    temperature: "",
    blood_pressure: "",
    outcome: "treated_released" as string,
    parent_notified: false,
    attending_nurse: "",
    follow_up_date: "",
    notes: "",
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("clinic_visits").insert({
        school_id: schoolId,
        student_id: form.student_id || null,
        visit_date: form.visit_date,
        visit_time: form.visit_time,
        complaint: form.complaint || null,
        diagnosis: form.diagnosis || null,
        treatment: form.treatment || null,
        medication_given: form.medication_given || null,
        temperature: form.temperature ? Number(form.temperature) : null,
        blood_pressure: form.blood_pressure || null,
        outcome: form.outcome,
        parent_notified: form.parent_notified,
        parent_notified_at: form.parent_notified ? new Date().toISOString() : null,
        attending_nurse: form.attending_nurse || null,
        follow_up_date: form.follow_up_date || null,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Visit recorded");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record clinic visit</DialogTitle>
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
                value={form.visit_date}
                onChange={(e) => setForm({ ...form, visit_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Time</Label>
              <Input
                type="time"
                value={form.visit_time}
                onChange={(e) => setForm({ ...form, visit_time: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Complaint</Label>
            <Textarea
              rows={2}
              value={form.complaint}
              onChange={(e) => setForm({ ...form, complaint: e.target.value })}
            />
          </div>
          <div>
            <Label>Diagnosis</Label>
            <Input
              value={form.diagnosis}
              onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
            />
          </div>
          <div>
            <Label>Treatment</Label>
            <Textarea
              rows={2}
              value={form.treatment}
              onChange={(e) => setForm({ ...form, treatment: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Medication</Label>
              <Input
                value={form.medication_given}
                onChange={(e) => setForm({ ...form, medication_given: e.target.value })}
              />
            </div>
            <div>
              <Label>Temp (°C)</Label>
              <Input
                type="number"
                step="0.1"
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: e.target.value })}
              />
            </div>
            <div>
              <Label>BP</Label>
              <Input
                placeholder="120/80"
                value={form.blood_pressure}
                onChange={(e) => setForm({ ...form, blood_pressure: e.target.value })}
              />
            </div>
            <div>
              <Label>Nurse</Label>
              <Input
                value={form.attending_nurse}
                onChange={(e) => setForm({ ...form, attending_nurse: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Outcome</Label>
              <Select value={form.outcome} onValueChange={(v) => setForm({ ...form, outcome: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Follow-up</Label>
              <Input
                type="date"
                value={form.follow_up_date}
                onChange={(e) => setForm({ ...form, follow_up_date: e.target.value })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.parent_notified}
              onChange={(e) => setForm({ ...form, parent_notified: e.target.checked })}
            />
            Notify parent
          </label>
          {form.parent_notified && (
            <div className="text-xs bg-primary/10 border border-primary/30 rounded-lg p-2 text-primary-foreground/80">
              Preview: Parent will be marked as notified now.
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!form.student_id || save.isPending}>
            {save.isPending ? "Saving…" : "Save visit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
