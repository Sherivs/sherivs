/** Role scope sets (multi-select operating areas), access explainer and shadow report (SHERIVS-021). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/role-scopes")({ ssr: false, component: RoleScopesPage });
type Opt = { id: string; name: string };
type ScopeSet = { set_id: string; label: string | null; assignment_id: string; role: string; user_id: string; user_name: string | null; dims: Record<string, string[]> };
const DIMS = ["campus", "shift", "section", "gender", "level", "class", "subject", "house", "hostel"] as const;
type Dim = (typeof DIMS)[number];

function Multi({ label, opts, value, onChange }: { label: string; opts: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="rounded-md border p-2"><legend className="px-1 text-sm font-medium capitalize">{label}</legend>
      <div className="flex max-h-32 flex-wrap gap-2 overflow-auto">
        {opts.map((o) => (
          <label key={o.id} className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />{o.name}
          </label>))}
        {opts.length === 0 && <span className="text-xs text-muted-foreground">None set up</span>}
      </div>
    </fieldset>);
}

function RoleScopesPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const [assignment, setAssignment] = useState("");
  const [pick, setPick] = useState<Record<Dim, string[]>>(Object.fromEntries(DIMS.map((d) => [d, []])) as unknown as Record<Dim, string[]>);
  const [subject, setSubject] = useState("");
  const [who, setWho] = useState(""); const [action, setAction] = useState("students.view"); const [student, setStudent] = useState("");
  const [why, setWhy] = useState<string>("");
  const q = <T,>(k: string, f: () => Promise<T[]>) => useQuery({ queryKey: [k, org], enabled: !!org, queryFn: f });
  const assignments = q("ura", () => rows<{ id: string; user_id: string; role_code: string }>(sdb.from("user_role_assignments").select("id,user_id,role_code").eq("org_id", org).eq("status", "active")));
  const campuses = q("campuses", () => rows<Opt>(sdb.from("campuses").select("id,name").eq("school_id", org)));
  const all = { campus: campuses.data ?? [] } as Record<Dim, Opt[]>;
  // cascading: shifts/sections/classes narrow to the chosen campuses
  const inCampus = <T extends Opt & { campus_id?: string | null }>(rowsIn: T[]): T[] => (pick.campus.length ? rowsIn.filter((r) => !r.campus_id || pick.campus.includes(r.campus_id)) : rowsIn);
  const shifts = q("shifts", () => rows<Opt & { campus_id: string | null }>(sdb.from("school_shifts").select("id,name,campus_id").eq("school_id", org)));
  const sections = q("sections", () => rows<Opt & { campus_id: string | null }>(sdb.from("school_sections").select("id,name,campus_id").eq("school_id", org)));
  const levels = q("levels", () => rows<Opt>(sdb.from("school_levels").select("id,name").eq("school_id", org).order("ordinal")));
  const classes = q("classes", () => rows<Opt & { campus_id: string | null; level_id: string | null }>(sdb.from("classes").select("id,name,campus_id,level_id").eq("school_id", org)));
  const houses = q("houses", () => rows<Opt>(sdb.from("student_groups").select("id,name").eq("school_id", org).eq("kind", "house")));
  all.shift = inCampus(shifts.data ?? []); all.section = inCampus(sections.data ?? []); all.level = levels.data ?? [];
  all.class = inCampus(classes.data ?? []).filter((c) => !pick.level.length || c.level_id == null || pick.level.includes(c.level_id));
  const hostels = q("hostels", () => rows<{ id: string; block: string | null; room_number?: string | null }>(sdb.from("hostel_rooms").select("id,block").eq("school_id", org)));
  const subjects = q("subjects", () => rows<{ subject: string | null }>(sdb.from("timetable_slots").select("subject").eq("school_id", org)));
  all.house = houses.data ?? []; all.gender = ["boys", "girls", "mixed"].map((g) => ({ id: g, name: g }));
  all.hostel = [...new Set((hostels.data ?? []).map((h) => h.block).filter((b): b is string => !!b))].map((b) => ({ id: b, name: `Block ${b}` }));
  all.subject = [...new Set((subjects.data ?? []).map((x) => x.subject).filter((b): b is string => !!b))].sort().map((b) => ({ id: b, name: b }));
  const sets = useQuery({ queryKey: ["scope-sets", org], enabled: !!org, queryFn: () => rpc<ScopeSet[]>("role_scope_sets_list", { p_org: org }).catch(() => [] as ScopeSet[]) });
  const audit = q("scope-audit", () => rows<{ id: number; action: string; at: string; label: string | null; dims: Record<string, string[]> | null }>(sdb.from("role_scope_audit").select("id,action,at,label,dims").eq("org_id", org).order("at", { ascending: false }).limit(30)));
  const nameOf = (d: string, ref: string) => (all[d as Dim] ?? []).find((o) => o.id === ref)?.name ?? ref;
  const report = useQuery({ queryKey: ["shadow", org], enabled: !!org, queryFn: () => rpc<Record<string, unknown>>("authz_shadow_report", { p_org: org }).catch(() => null) });

  async function save() {
    const dims: Record<string, string[]> = {};
    for (const d of DIMS) if (pick[d].length) dims[d] = pick[d];
    const extra = subject.split(",").map((s) => s.trim()).filter(Boolean);
    if (extra.length) dims.subject = [...new Set([...(dims.subject ?? []), ...extra])];
    try { await rpc("role_scope_set_add", { p_assignment: assignment, p_dims: dims }); toast.success("Scope set saved"); await qc.invalidateQueries(); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function remove(id: string) {
    if (!confirm("Remove this scope set?")) return;
    try { await rpc("role_scope_set_remove", { p_set: id }); toast.success("Scope set removed"); await qc.invalidateQueries(); }
    catch (e) { toast.error((e as Error).message); }
  }
  async function explain() {
    try { const r = await rpc("authz_check", { p_user: who, p_action: action, p_kind: "student", p_id: student }); setWhy(JSON.stringify(r, null, 2)); }
    catch (e) { setWhy((e as Error).message); }
  }
  const sel = "rounded-md border bg-background p-2 text-sm";
  return (
    <PortalPage title="Role operating areas" subtitle="Pick any mix of campuses, shifts, sections, levels, classes, subjects, houses and hostels. Within a box: any of them. Across boxes: all of them.">
      <div className="space-y-3 rounded-lg border p-3">
        <select className={sel} value={assignment} onChange={(e) => setAssignment(e.target.value)} aria-label="Role assignment">
          <option value="">Choose a role assignment</option>
          {(assignments.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.role_code} · {a.user_id.slice(0, 8)}</option>)}</select>
        <div className="grid gap-2 md:grid-cols-3">
          {DIMS.map((d) => <Multi key={d} label={d} opts={all[d] ?? []} value={pick[d]} onChange={(v) => setPick({ ...pick, [d]: v })} />)}
          <Input placeholder="Other subjects (comma separated)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <Button disabled={!assignment} onClick={save}>Add scope set</Button>
        <p className="text-xs text-muted-foreground">You can never grant a wider area than your own.</p>
      </div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Current scope sets</h3>
        {(sets.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No scope sets yet: every role is organisation-wide.</p>}
        <ul className="space-y-2 text-sm">
          {(sets.data ?? []).map((s) => (
            <li key={s.set_id} className="flex flex-wrap items-start justify-between gap-2 rounded border p-2">
              <div><div className="font-medium">{s.user_name ?? s.user_id.slice(0, 8)} · {s.role}{s.label ? ` · ${s.label}` : ""}</div>
                <div className="text-xs text-muted-foreground">{Object.entries(s.dims ?? {}).map(([d, refs]) => `${d}: ${refs.map((r) => nameOf(d, r)).join(" or ")}`).join("  AND  ")}</div></div>
              <Button size="sm" variant="outline" onClick={() => remove(s.set_id)}>Remove</Button>
            </li>))}
        </ul>
        <p className="text-xs text-muted-foreground">Several sets on one role: any of them. Removing the last set makes the role organisation-wide, so only administrators can do that.</p>
      </div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Scope changes (audit)</h3>
        <ul className="space-y-1 font-mono text-xs">
          {(audit.data ?? []).map((a) => <li key={a.id}>{a.at.slice(0, 16).replace("T", " ")} {a.action} {a.label ?? ""} {a.dims ? Object.keys(a.dims).join("+") : ""}</li>)}
          {(audit.data ?? []).length === 0 && <li className="text-muted-foreground">No changes yet.</li>}
        </ul>
      </div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Why can or can't someone see this? (shadow check)</h3>
        <div className="grid gap-2 md:grid-cols-3">
          <Input placeholder="User id" value={who} onChange={(e) => setWho(e.target.value)} />
          <Input placeholder="Action e.g. students.view" value={action} onChange={(e) => setAction(e.target.value)} />
          <Input placeholder="Student id" value={student} onChange={(e) => setStudent(e.target.value)} /></div>
        <Button variant="outline" onClick={explain}>Explain</Button>
        {why && <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{why}</pre>}
      </div>
      <div className="mt-4 rounded-lg border p-3"><h3 className="font-medium">Shadow mode, last 7 days</h3>
        <pre className="text-xs">{report.data ? JSON.stringify(report.data, null, 2) : "Admin or audit permission needed"}</pre>
        <p className="text-xs text-muted-foreground">The current checks still decide. This shows where the new layered check would disagree.</p></div>
    </PortalPage>);
}
