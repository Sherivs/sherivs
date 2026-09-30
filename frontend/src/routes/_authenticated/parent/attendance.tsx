import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, EmptyCard, StatCard, SectionGrid } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/parent/attendance")({
  ssr: false,
  component: ParentAttendancePage,
});

type Child = { student_id: string; full_name: string };
type Row = { id: string; date: string; status: string; note: string | null };

function ParentAttendancePage() {
  const { profile } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState<30 | 60 | 90 | 180>(60);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "present" | "absent" | "late" | "excused"
  >("all");

  const children = useQuery<Child[]>({
    queryKey: ["parent-children-att", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data: map } = await supabase
        .from("parent_student_map")
        .select("student_id")
        .eq("parent_id", profile!.id);
      const ids = (map ?? []).map((r) => r.student_id as string);
      if (ids.length === 0) return [];
      const { data: students } = await supabase
        .from("students")
        .select("id, user_id")
        .in("id", ids);
      const uids = (students ?? []).map((s) => s.user_id).filter(Boolean) as string[];
      const { data: users } = uids.length
        ? await supabase.from("users").select("id, full_name").in("id", uids)
        : { data: [] as { id: string; full_name: string }[] };
      const nameOf = new Map((users ?? []).map((u) => [u.id, u.full_name as string]));
      return (students ?? []).map((s) => ({
        student_id: s.id as string,
        full_name: s.user_id ? (nameOf.get(s.user_id as string) ?? "Child") : "Child",
      }));
    },
  });

  useEffect(() => {
    if (!selected && children.data?.[0]) setSelected(children.data[0].student_id);
  }, [children.data, selected]);

  const since = useMemo(
    () => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
    [days],
  );
  const records = useQuery<Row[]>({
    queryKey: ["parent-att-detail", selected, since],
    enabled: !!selected,
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance")
        .select("id, date, status, note")
        .eq("student_id", selected!)
        .gte("date", since)
        .order("date", { ascending: false });
      return (data ?? []) as Row[];
    },
  });

  const filtered = useMemo(
    () => (records.data ?? []).filter((r) => statusFilter === "all" || r.status === statusFilter),
    [records.data, statusFilter],
  );

  const stats = useMemo(() => {
    const rows = records.data ?? [];
    const present = rows.filter((r) => r.status === "present").length;
    const absent = rows.filter((r) => r.status === "absent").length;
    const late = rows.filter((r) => r.status === "late").length;
    const total = rows.length;
    const rate = total ? Math.round(((present + late) / total) * 100) : null;
    return { present, absent, late, total, rate };
  }, [records.data]);

  if ((children.data?.length ?? 0) === 0) {
    return (
      <PortalPage title="Children's attendance">
        <EmptyCard
          title="No children linked"
          body="Once your child is linked, their attendance history will show here."
        />
      </PortalPage>
    );
  }

  return (
    <PortalPage
      title="Children's attendance"
      subtitle={`Last ${days} days of recorded attendance.`}
    >
      <div className="mb-6 flex flex-wrap gap-2">
        {(children.data ?? []).map((c) => (
          <button
            key={c.student_id}
            type="button"
            onClick={() => setSelected(c.student_id)}
            className={
              "rounded-md border px-3 py-1.5 text-sm " +
              (selected === c.student_id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/40")
            }
          >
            {c.full_name}
          </button>
        ))}
      </div>

      <SectionGrid>
        <StatCard label="Attendance rate" value={stats.rate == null ? "—" : `${stats.rate}%`} />
        <StatCard label="Present" value={stats.present} />
        <StatCard label="Absent" value={stats.absent} />
        <StatCard label="Late" value={stats.late} />
      </SectionGrid>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-xs uppercase tracking-widest text-muted-foreground">Range</label>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as 30 | 60 | 90 | 180)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
          <option value={180}>Last 180 days</option>
        </select>
        <label className="ml-2 text-xs uppercase tracking-widest text-muted-foreground">
          Status
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="present">Present</option>
          <option value="absent">Absent</option>
          <option value="late">Late</option>
          <option value="excused">Excused</option>
        </select>
        <span className="text-xs text-muted-foreground">
          Showing {filtered.length} of {records.data?.length ?? 0}
        </span>
      </div>

      <div className="uos-card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-3">Date</th>
              <th className="p-3">Day</th>
              <th className="p-3">Status</th>
              <th className="p-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">
                  No attendance records match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="p-3 font-mono text-xs">{r.date}</td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(r.date).toLocaleDateString(undefined, { weekday: "long" })}
                  </td>
                  <td className="p-3 capitalize">{r.status}</td>
                  <td className="p-3 text-muted-foreground">{r.note ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PortalPage>
  );
}
