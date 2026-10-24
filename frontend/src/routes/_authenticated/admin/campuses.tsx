/** Campuses, sections, arms (A–Z generator) and houses/clubs (SHERIVS-019). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/campuses")({ ssr: false, component: CampusPage });
const KINDS = ["early_years", "nursery", "primary", "junior_secondary", "senior_secondary", "technical", "tertiary", "day", "boarding", "other"];

function CampusPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const [campus, setCampus] = useState(""); const [section, setSection] = useState(""); const [kind, setKind] = useState("senior_secondary");
  const [level, setLevel] = useState("JSS1"); const [from, setFrom] = useState("A"); const [to, setTo] = useState("D"); const [names, setNames] = useState("");
  const [stream, setStream] = useState(""); const [campusId, setCampusId] = useState(""); const [sectionId, setSectionId] = useState("");
  const [group, setGroup] = useState(""); const [gkind, setGkind] = useState("house");
  const campuses = useQuery({ queryKey: ["campuses", org], enabled: !!org, queryFn: () => rows<{ id: string; name: string }>(sdb.from("campuses").select("id,name").eq("school_id", org)) });
  const sections = useQuery({ queryKey: ["sections", org], enabled: !!org, queryFn: () => rows<{ id: string; name: string; kind: string }>(sdb.from("school_sections").select("id,name,kind").eq("school_id", org)) });
  const groups = useQuery({ queryKey: ["groups", org], enabled: !!org, queryFn: () => rows<{ id: string; name: string; kind: string }>(sdb.from("student_groups").select("id,name,kind").eq("school_id", org)) });
  async function go(fn: string, args: Record<string, unknown>, ok: string) {
    try { const r = await rpc(fn, args); toast.success(typeof r === "number" ? `${ok}: ${r}` : ok); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); }
  }
  const sel = "rounded-md border bg-background p-2 text-sm";
  return (
    <PortalPage title="Campuses, sections & arms" subtitle="Group → Campus → Section → Level → Arm. Houses and clubs sit alongside a student's arm.">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Campus</h3>
          <Input placeholder="Campus name" value={campus} onChange={(e) => setCampus(e.target.value)} />
          <Button onClick={() => go("campus_upsert", { p_school: org, p_name: campus }, "Campus saved")}>Save campus</Button>
          <p className="text-sm text-muted-foreground">{(campuses.data ?? []).map((c) => c.name).join(" · ")}</p></div>
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Section</h3>
          <Input placeholder="Section name" value={section} onChange={(e) => setSection(e.target.value)} />
          <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Section kind">{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <select className={sel} value={campusId} onChange={(e) => setCampusId(e.target.value)} aria-label="Campus"><option value="">No campus</option>{(campuses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <Button onClick={() => go("section_upsert", { p_school: org, p_campus: campusId || null, p_name: section, p_kind: kind }, "Section saved")}>Save section</Button></div>
      </div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Generate arms</h3>
        <div className="grid gap-2 md:grid-cols-6">
          <Input placeholder="Level (e.g. JSS1, SS2, Primary 4)" value={level} onChange={(e) => setLevel(e.target.value)} />
          <Input placeholder="From" value={from} maxLength={1} onChange={(e) => setFrom(e.target.value.toUpperCase())} />
          <Input placeholder="To" value={to} maxLength={1} onChange={(e) => setTo(e.target.value.toUpperCase())} />
          <Input placeholder="or names: Gold, Diamond" value={names} onChange={(e) => setNames(e.target.value)} />
          <select className={sel} value={stream} onChange={(e) => setStream(e.target.value)} aria-label="Stream"><option value="">No stream</option>{["science", "arts", "commercial", "technical", "general"].map((s) => <option key={s}>{s}</option>)}</select>
          <select className={sel} value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Section"><option value="">No section</option>{(sections.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
        <Button onClick={() => go("generate_class_arms", { p_school: org, p_level: level, p_from: from, p_to: to,
          p_names: names.trim() ? names.split(",").map((x) => x.trim()).filter(Boolean) : null, p_section: sectionId || null, p_campus: campusId || null, p_stream: stream || null }, "Arms created")}>Generate A–Z arms</Button></div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Houses, clubs and groups</h3>
        <div className="flex gap-2"><Input placeholder="Name" value={group} onChange={(e) => setGroup(e.target.value)} />
          <select className={sel} value={gkind} onChange={(e) => setGkind(e.target.value)} aria-label="Group kind">{["house", "club", "tutorial_group", "society", "team"].map((k) => <option key={k}>{k}</option>)}</select>
          <Button onClick={() => go("group_upsert", { p_school: org, p_name: group, p_kind: gkind }, "Group saved")}>Save</Button></div>
        <p className="text-sm text-muted-foreground">{(groups.data ?? []).map((g) => `${g.name} (${g.kind})`).join(" · ")}</p></div>
    </PortalPage>
  );
}
