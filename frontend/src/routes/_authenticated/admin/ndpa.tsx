/** NDPA 2023 compliance pack (SHERIVS-019): DPO, NDPC registration, DPIA, retention, annual audit return. */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle } from "lucide-react";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/ndpa")({ ssr: false, component: NdpaPage });

function NdpaPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const [p, setP] = useState({ dpo_name: "", dpo_email: "", dpo_phone: "", ndpc_registration_no: "", privacy_notice_url: "" });
  const [dpia, setDpia] = useState({ title: "", activity: "", risk: "medium", mitigations: "" });
  const status = useQuery({ queryKey: ["ndpa", org], enabled: !!org, queryFn: () => rpc<{ item: string; ok: boolean; detail?: string }[]>("ndpa_compliance_status", { p_school: org }) });
  const dpias = useQuery({ queryKey: ["dpia", org], enabled: !!org, queryFn: () => rows<{ id: string; title: string; risk_level: string; status: string }>(sdb.from("dpia_records").select("id,title,risk_level,status").eq("school_id", org)) });
  async function go(fn: string, args: Record<string, unknown>, ok: string) {
    try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <PortalPage title="Data protection (NDPA 2023)" subtitle="Your school is a data controller. This checklist tracks what the NDPC expects.">
      <ul className="space-y-2">{(status.data ?? []).map((s) => (
        <li key={s.item} className="flex items-center gap-2">{s.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-amber-600" />}
          <span>{s.item}</span>{s.detail && <span className="text-sm text-muted-foreground">({s.detail})</span>}</li>))}</ul>
      <h3 className="mt-6 font-medium">Controller profile</h3>
      <div className="mt-2 grid gap-2 md:grid-cols-3">{(Object.keys(p) as (keyof typeof p)[]).map((k) => (
        <Input key={k} placeholder={k.replaceAll("_", " ")} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />))}</div>
      <div className="mt-2 flex gap-2">
        <Button onClick={() => go("ndpa_upsert_profile", { p_school: org, p }, "Profile saved")}>Save profile</Button>
        <Button variant="outline" onClick={() => go("ndpa_seed_retention", { p_school: org }, "Default retention schedule added")}>Add default retention schedule</Button>
      </div>
      <h3 className="mt-6 font-medium">DPIAs</h3>
      <div className="mt-2 grid gap-2 md:grid-cols-4">
        <Input placeholder="Title" value={dpia.title} onChange={(e) => setDpia({ ...dpia, title: e.target.value })} />
        <Input placeholder="Processing activity" value={dpia.activity} onChange={(e) => setDpia({ ...dpia, activity: e.target.value })} />
        <select className="rounded-md border bg-background p-2 text-sm" value={dpia.risk} onChange={(e) => setDpia({ ...dpia, risk: e.target.value })} aria-label="Risk">
          <option>low</option><option>medium</option><option>high</option></select>
        <Button onClick={() => go("dpia_save", { p_school: org, p_title: dpia.title, p_activity: dpia.activity, p_categories: [], p_risk: dpia.risk, p_mitigations: dpia.mitigations }, "DPIA saved")}>Save DPIA</Button>
      </div>
      <ul className="mt-2 divide-y rounded-md border">{(dpias.data ?? []).map((d) => (
        <li key={d.id} className="flex items-center justify-between px-3 py-2"><span>{d.title} · {d.risk_level} · {d.status}</span>
          {d.status === "draft" && <Button size="sm" variant="outline" onClick={() => go("dpia_approve", { p_dpia: d.id }, "DPIA approved")}>Approve (not the preparer)</Button>}</li>))}</ul>
    </PortalPage>
  );
}
