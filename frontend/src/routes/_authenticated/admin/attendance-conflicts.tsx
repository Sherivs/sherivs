/** Offline attendance conflict queue: marks synced from devices that disagree with an existing mark (SHERIVS-A07). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/attendance-conflicts")({ ssr: false, component: AttendanceConflictsPage });
type Conflict = { id: string; student_id: string; date: string; yours: string; server: string | null; captured_at: string | null; skew_seconds: number; status: string; batch: string };

function AttendanceConflictsPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const [status, setStatus] = useState("open");
  const list = useQuery({ queryKey: ["att-conflicts", org, status], enabled: !!org, queryFn: () => rpc<Conflict[]>("attendance_conflicts_list", { p_org: org, p_status: status || null }) });
  const students = useQuery({ queryKey: ["students-min", org], enabled: !!org, queryFn: () => rows<{ id: string; admission_number: string | null }>(sdb.from("students").select("id,admission_number").eq("school_id", org)) });
  const adm = (id: string) => students.data?.find((x) => x.id === id)?.admission_number ?? id.slice(0, 8);
  async function resolve(id: string, action: string) {
    try { await rpc("attendance_conflict_resolve", { p_id: id, p_action: action, p_note: null }); toast.success("Resolved"); await qc.invalidateQueries({ queryKey: ["att-conflicts"] }); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <PortalPage title="Offline attendance conflicts" subtitle="Marks synced from a device that disagree with one already saved. Keep the saved mark, accept the device's, or dismiss.">
      <select className="rounded-md border bg-background p-2 text-sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="open">Open</option><option value="accepted_device">Accepted device</option><option value="kept_server">Kept saved mark</option><option value="dismissed">Dismissed</option><option value="">All</option></select>
      <ul className="mt-4 space-y-1 text-sm">{(list.data ?? []).map((c) => (
        <li key={c.id} className="flex justify-between gap-2 rounded border p-2"><span>{c.date} · {adm(c.student_id)} · saved <b>{c.server ?? "—"}</b>, device <b>{c.yours}</b>{c.captured_at ? ` · captured ${new Date(c.captured_at).toLocaleTimeString()}` : ""}{Math.abs(c.skew_seconds) > 300 ? ` · device clock off ${Math.round(c.skew_seconds / 60)} min` : ""} · {c.status}</span>
          {c.status === "open" && <span className="flex gap-2"><button className="underline" onClick={() => resolve(c.id, "keep_server")}>Keep saved</button><button className="underline" onClick={() => resolve(c.id, "accept_device")}>Accept device</button><button className="underline" onClick={() => resolve(c.id, "dismiss")}>Dismiss</button></span>}</li>))}
        {list.data?.length === 0 && <li className="text-muted-foreground">Nothing here.</li>}</ul>
    </PortalPage>
  );
}
