/** Shifts, levels, section gender/residency, class placement and academic periods (SHERIVS-A02). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/structure")({ ssr: false, component: StructurePage });
const SHIFT_KINDS = ["morning", "afternoon", "evening", "weekend", "full_day"];
const BANDS = ["creche", "nursery", "primary", "jss", "sss", "technical", "tertiary"];
type Opt = { id: string; name: string };
type Shift = Opt & { kind: string; campus_id: string | null; starts_at: string | null; ends_at: string | null };
type Level = Opt & { band: string; ordinal: number };
type Section = Opt & { gender: string | null; residency: string | null };
type Klass = Opt & { shift_id: string | null; level_id: string | null; section_id: string | null };
type Period = { id: string; session: string; kind: string; ordinal: number; name: string; starts_on: string; ends_on: string; is_current: boolean; closed_at: string | null };

function StructurePage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const q = <T,>(k: string, f: () => Promise<T[]>) => useQuery({ queryKey: [k, org], enabled: !!org, queryFn: f });
  const campuses = q("campuses", () => rows<Opt>(sdb.from("campuses").select("id,name").eq("school_id", org)));
  const shifts = q("shifts", () => rows<Shift>(sdb.from("school_shifts").select("id,name,kind,campus_id,starts_at,ends_at").eq("school_id", org)));
  const levels = q("levels", () => rows<Level>(sdb.from("school_levels").select("id,name,band,ordinal").eq("school_id", org).order("ordinal")));
  const sections = q("sections", () => rows<Section>(sdb.from("school_sections").select("id,name,gender,residency").eq("school_id", org)));
  const classes = q("classes", () => rows<Klass>(sdb.from("classes").select("id,name,shift_id,level_id,section_id").eq("school_id", org).order("name")));
  const periods = q("periods", () => rows<Period>(sdb.from("academic_periods").select("id,session,kind,ordinal,name,starts_on,ends_on,is_current,closed_at").eq("school_id", org).order("starts_on", { ascending: false })));

  const [sh, setSh] = useState({ name: "", kind: "morning", campus: "", starts: "", ends: "" });
  const [lv, setLv] = useState({ name: "", band: "primary", ordinal: "1" });
  const [pl, setPl] = useState({ cls: "", shift: "", level: "", section: "" });
  const [pe, setPe] = useState({ session: "", kind: "term", ordinal: "1", name: "First term", starts: "", ends: "" });

  async function go(fn: string, args: Record<string, unknown>, ok: string) {
    try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); }
  }
  const sel = "rounded-md border bg-background p-2 text-sm";
  const nm = (list: Opt[] | undefined, id: string | null) => (id ? list?.find((x) => x.id === id)?.name ?? "?" : "–");

  return (
    <PortalPage title="School structure" subtitle="Shifts, levels, boys/girls sections, where each class sits, and the terms or semesters of each session.">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Shifts</h3>
          <div className="grid gap-2 md:grid-cols-2">
            <Input placeholder="Name (e.g. Morning)" value={sh.name} onChange={(e) => setSh({ ...sh, name: e.target.value })} />
            <select className={sel} aria-label="Shift kind" value={sh.kind} onChange={(e) => setSh({ ...sh, kind: e.target.value })}>{SHIFT_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            <select className={sel} aria-label="Campus" value={sh.campus} onChange={(e) => setSh({ ...sh, campus: e.target.value })}><option value="">All campuses</option>{(campuses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <div className="flex gap-1"><Input type="time" aria-label="Starts" value={sh.starts} onChange={(e) => setSh({ ...sh, starts: e.target.value })} /><Input type="time" aria-label="Ends" value={sh.ends} onChange={(e) => setSh({ ...sh, ends: e.target.value })} /></div>
          </div>
          <Button onClick={() => go("shift_upsert", { p_org: org, p_campus: sh.campus || null, p_name: sh.name, p_kind: sh.kind, p_starts: sh.starts || null, p_ends: sh.ends || null }, "Shift saved")}>Save shift</Button>
          <ul className="text-sm">{(shifts.data ?? []).map((s) => <li key={s.id} className="flex justify-between gap-2"><span>{s.name} · {s.kind} · {nm(campuses.data, s.campus_id)} {s.starts_at ? `${s.starts_at.slice(0, 5)}–${s.ends_at?.slice(0, 5)}` : ""}</span>
            <button className="text-destructive underline" onClick={() => go("shift_delete", { p_shift: s.id }, "Shift deleted")}>Delete</button></li>)}</ul></div>

        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Levels</h3>
          <div className="grid gap-2 md:grid-cols-3">
            <Input placeholder="Name (e.g. JSS 1)" value={lv.name} onChange={(e) => setLv({ ...lv, name: e.target.value })} />
            <select className={sel} aria-label="Band" value={lv.band} onChange={(e) => setLv({ ...lv, band: e.target.value })}>{BANDS.map((b) => <option key={b}>{b}</option>)}</select>
            <Input type="number" min={0} max={99} aria-label="Order" value={lv.ordinal} onChange={(e) => setLv({ ...lv, ordinal: e.target.value })} />
          </div>
          <Button onClick={() => go("level_upsert", { p_org: org, p_name: lv.name, p_band: lv.band, p_ordinal: Number(lv.ordinal) }, "Level saved")}>Save level</Button>
          <ul className="text-sm">{(levels.data ?? []).map((l) => <li key={l.id} className="flex justify-between gap-2"><span>{l.ordinal}. {l.name} · {l.band}</span>
            <button className="text-destructive underline" onClick={() => go("level_delete", { p_level: l.id }, "Level deleted")}>Delete</button></li>)}</ul></div>
      </div>

      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Sections: boys, girls or mixed; day or boarding</h3>
        <ul className="space-y-1 text-sm">{(sections.data ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2"><span className="min-w-40">{s.name}</span>
            <select className={sel} aria-label={`Gender for ${s.name}`} value={s.gender ?? ""} onChange={(e) => go("section_set_profile", { p_section: s.id, p_gender: e.target.value || null, p_residency: s.residency }, "Section updated")}>
              <option value="">Not set</option>{["boys", "girls", "mixed"].map((g) => <option key={g}>{g}</option>)}</select>
            <select className={sel} aria-label={`Residency for ${s.name}`} value={s.residency ?? ""} onChange={(e) => go("section_set_profile", { p_section: s.id, p_gender: s.gender, p_residency: e.target.value || null }, "Section updated")}>
              <option value="">Not set</option>{["day", "boarding", "both"].map((g) => <option key={g}>{g}</option>)}</select></li>))}
          {(sections.data ?? []).length === 0 && <li className="text-muted-foreground">Add sections under Campuses &amp; sections first.</li>}</ul></div>

      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Place a class</h3>
        <div className="grid gap-2 md:grid-cols-4">
          <select className={sel} aria-label="Class" value={pl.cls} onChange={(e) => { const c = classes.data?.find((x) => x.id === e.target.value); setPl({ cls: e.target.value, shift: c?.shift_id ?? "", level: c?.level_id ?? "", section: c?.section_id ?? "" }); }}>
            <option value="">Choose a class</option>{(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className={sel} aria-label="Shift" value={pl.shift} onChange={(e) => setPl({ ...pl, shift: e.target.value })}><option value="">No shift</option>{(shifts.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className={sel} aria-label="Level" value={pl.level} onChange={(e) => setPl({ ...pl, level: e.target.value })}><option value="">No level</option>{(levels.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className={sel} aria-label="Section" value={pl.section} onChange={(e) => setPl({ ...pl, section: e.target.value })}><option value="">Keep section</option>{(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
        <Button disabled={!pl.cls} onClick={() => go("class_set_structure", { p_class: pl.cls, p_shift: pl.shift || null, p_level: pl.level || null, p_section: pl.section || null }, "Class placed")}>Save placement</Button></div>

      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Academic periods</h3>
        <div className="grid gap-2 md:grid-cols-6">
          <Input placeholder="Session e.g. 2026/2027" value={pe.session} onChange={(e) => setPe({ ...pe, session: e.target.value })} />
          <select className={sel} aria-label="Kind" value={pe.kind} onChange={(e) => setPe({ ...pe, kind: e.target.value })}>{["term", "semester", "trimester"].map((k) => <option key={k}>{k}</option>)}</select>
          <select className={sel} aria-label="Number" value={pe.ordinal} onChange={(e) => setPe({ ...pe, ordinal: e.target.value })}>{["1", "2", "3"].map((k) => <option key={k}>{k}</option>)}</select>
          <Input placeholder="Name" value={pe.name} onChange={(e) => setPe({ ...pe, name: e.target.value })} />
          <Input type="date" aria-label="Starts" value={pe.starts} onChange={(e) => setPe({ ...pe, starts: e.target.value })} />
          <Input type="date" aria-label="Ends" value={pe.ends} onChange={(e) => setPe({ ...pe, ends: e.target.value })} />
        </div>
        <Button onClick={() => go("academic_period_upsert", { p_org: org, p_session: pe.session, p_kind: pe.kind, p_ordinal: Number(pe.ordinal), p_name: pe.name, p_starts: pe.starts, p_ends: pe.ends }, "Period saved")}>Save period</Button>
        <ul className="space-y-1 text-sm">{(periods.data ?? []).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2"><span>{p.session} · {p.name} ({p.kind} {p.ordinal}) · {p.starts_on} → {p.ends_on}
            {p.is_current && <b className="ml-2 text-emerald-600">current</b>}{p.closed_at && <span className="ml-2 text-muted-foreground">closed</span>}</span>
            {!p.closed_at && <span className="flex gap-2">
              {!p.is_current && <button className="underline" onClick={() => go("academic_period_set_current", { p_period: p.id }, "Current period set")}>Make current</button>}
              <button className="text-destructive underline" onClick={() => { if (confirm(`Close ${p.name} ${p.session}? Closed periods cannot be edited.`)) void go("academic_period_close", { p_period: p.id }, "Period closed"); }}>Close</button></span>}</li>))}</ul></div>
    </PortalPage>
  );
}
