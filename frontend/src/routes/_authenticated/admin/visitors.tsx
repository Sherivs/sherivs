/** Gate desk: visitor passes and authorised pick-ups (SHERIVS-024). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/visitors")({ ssr: false, component: Visitors });

function Visitors() {
  const { school } = useApp(); const org = school?.id ?? ""; const qc = useQueryClient();
  const [codes, setCodes] = useState<Record<string, string>>({}); const [v, setV] = useState({ name: "", phone: "", purpose: "meeting" });
  const passes = useQuery({ queryKey: ["passes", org], enabled: !!org, queryFn: () => rows<{ id: string; visitor_name: string; purpose: string; status: string; valid_on: string }>(sdb.from("visitor_passes").select("id,visitor_name,purpose,status,valid_on").eq("school_id", org).order("created_at", { ascending: false }).limit(100)) });
  async function pre() { try { const r = await rpc<{ ok: boolean; code?: string; error?: string }>("visitor_preregister", { p_name: v.name, p_phone: v.phone, p_purpose: v.purpose }); r.ok ? toast.success(`Gate code: ${r.code} (shown once)`) : toast.error(r.error ?? "refused"); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  async function checkIn(id: string) { const r = await rpc<{ ok: boolean; error?: string; name?: string }>("visitor_check_in", { p_pass: id, p_code: codes[id] ?? "" }).catch((e) => ({ ok: false, error: (e as Error).message })); r.ok ? toast.success(`Welcome ${"name" in r ? r.name : ""}`) : toast.error(r.error ?? "refused"); await qc.invalidateQueries(); }
  async function checkOut(id: string) { try { await rpc("visitor_check_out", { p_pass: id }); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  return (
    <PortalPage title="Gate & visitors" subtitle="Pick-ups are only released to people the parent has authorised.">
      <div className="flex flex-wrap gap-2 rounded-lg border p-3"><Input placeholder="Visitor name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <Input placeholder="Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        <select className="rounded-md border bg-background p-2 text-sm" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })} aria-label="Purpose">{["meeting", "delivery", "contractor", "other"].map((p) => <option key={p}>{p}</option>)}</select>
        <Button onClick={pre}>Pre-register</Button></div>
      <ul className="mt-4 space-y-1 text-sm">{(passes.data ?? []).map((p) => <li key={p.id} className="flex items-center justify-between border-t py-1"><span>{p.visitor_name} · {p.purpose} · {p.status} · {p.valid_on}</span>
        {p.status === "expected" && <span className="flex gap-1"><Input className="w-28" placeholder="code" value={codes[p.id] ?? ""} onChange={(e) => setCodes({ ...codes, [p.id]: e.target.value })} /><Button size="sm" onClick={() => checkIn(p.id)}>Check in</Button></span>}
        {p.status === "in" && <Button size="sm" variant="outline" onClick={() => checkOut(p.id)}>Check out</Button>}</li>)}</ul>
    </PortalPage>);
}
