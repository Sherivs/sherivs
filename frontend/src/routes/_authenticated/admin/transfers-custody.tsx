/** Class moves, transfers (with parent consent), guardian rights, custody orders and gate pickup checks (SHERIVS-A06). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/transfers-custody")({ ssr: false, component: TransfersCustodyPage });
type Transfer = { id: string; student_id: string; to_school_name: string; code: string; status: string; expires_at: string };
type Order = { id: string; student_id: string; restricted_name: string; kind: string; reference: string; valid_until: string | null; revoked_at: string | null };
type Pickup = { id: string; student_id: string; collector_name: string | null; allowed: boolean; reason: string; checked_at: string };
type Claim = { name: string; admission_number: string; from_school: string; last_class: string | null; academic: { subjects_graded: number; results: number } };

function TransfersCustodyPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const students = useQuery({ queryKey: ["students-min", org], enabled: !!org, queryFn: () => rows<{ id: string; admission_number: string | null }>(sdb.from("students").select("id,admission_number").eq("school_id", org).eq("is_active", true)) });
  const classes = useQuery({ queryKey: ["classes-min", org], enabled: !!org, queryFn: () => rows<{ id: string; name: string }>(sdb.from("classes").select("id,name").eq("school_id", org)) });
  const transfers = useQuery({ queryKey: ["transfers", org], enabled: !!org, queryFn: () => rows<Transfer>(sdb.from("student_transfers").select("id,student_id,to_school_name,code,status,expires_at").eq("school_id", org).order("created_at", { ascending: false }).limit(100)) });
  const orders = useQuery({ queryKey: ["custody", org], enabled: !!org, queryFn: () => rows<Order>(sdb.from("custody_orders").select("id,student_id,restricted_name,kind,reference,valid_until,revoked_at").eq("school_id", org).order("created_at", { ascending: false })) });
  const pickups = useQuery({ queryKey: ["pickups", org], enabled: !!org, queryFn: () => rows<Pickup>(sdb.from("pickup_events").select("id,student_id,collector_name,allowed,reason,checked_at").eq("school_id", org).order("checked_at", { ascending: false }).limit(50)) });
  const [student, setStudent] = useState("");
  const [mv, setMv] = useState({ cls: "", reason: "" });
  const [tr, setTr] = useState({ to: "", reason: "", consent: false });
  const [code, setCode] = useState("");
  const [claim, setClaim] = useState<Claim | null>(null);
  const [co, setCo] = useState({ name: "", phone: "", ref: "", until: "" });
  const [pk, setPk] = useState({ name: "", phone: "" });
  const adm = (id: string) => students.data?.find((x) => x.id === id)?.admission_number ?? id.slice(0, 8);
  async function go<T>(fn: string, args: Record<string, unknown>, ok: string) {
    try { const r = await rpc<T>(fn, args); toast.success(ok); await qc.invalidateQueries(); return r; } catch (e) { toast.error((e as Error).message); return null; }
  }
  const s = "rounded-md border bg-background p-2 text-sm";
  return (
    <PortalPage title="Transfers, guardians & pickup" subtitle="Move learners between classes, transfer them with parent consent, record court orders, and check who may collect a child.">
      <select className={s} aria-label="Student" value={student} onChange={(e) => setStudent(e.target.value)}><option value="">Choose a student</option>{(students.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.admission_number ?? x.id.slice(0, 8)}</option>)}</select>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Move class</h3>
          <select className={s} aria-label="New class" value={mv.cls} onChange={(e) => setMv({ ...mv, cls: e.target.value })}><option value="">Choose a class</option>{(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <Input placeholder="Reason" value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} />
          <Button disabled={!student || !mv.cls} onClick={() => go("student_move_class", { p_student: student, p_class: mv.cls, p_reason: mv.reason }, "Moved")}>Move</Button></div>
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Transfer out</h3>
          <Input placeholder="Destination school" value={tr.to} onChange={(e) => setTr({ ...tr, to: e.target.value })} />
          <Input placeholder="Reason" value={tr.reason} onChange={(e) => setTr({ ...tr, reason: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tr.consent} onChange={(e) => setTr({ ...tr, consent: e.target.checked })} /> Parent consent recorded</label>
          <Button disabled={!student} onClick={() => go("transfer_out_issue", { p_student: student, p_to_school: tr.to, p_reason: tr.reason, p_parent_consent: tr.consent }, "Transfer code issued")}>Issue transfer code</Button></div>
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Receive a transfer</h3>
          <Input placeholder="Transfer code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button onClick={async () => setClaim(await go<Claim>("transfer_in_claim", { p_code: code }, "Transfer received"))}>Claim</Button>
          {claim && <p className="text-sm">{claim.name} · {claim.admission_number} from {claim.from_school}{claim.last_class ? ` (${claim.last_class})` : ""} · {claim.academic.results} published results in {claim.academic.subjects_graded} subjects</p>}</div>
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Court / custody order</h3>
          <Input placeholder="Restricted person's name" value={co.name} onChange={(e) => setCo({ ...co, name: e.target.value })} />
          <Input placeholder="Their phone (optional)" value={co.phone} onChange={(e) => setCo({ ...co, phone: e.target.value })} />
          <Input placeholder="Order reference" value={co.ref} onChange={(e) => setCo({ ...co, ref: e.target.value })} />
          <Input type="date" aria-label="Valid until" value={co.until} onChange={(e) => setCo({ ...co, until: e.target.value })} />
          <Button disabled={!student} onClick={() => go("custody_order_add", { p_student: student, p_name: co.name, p_phone: co.phone || null, p_user: null, p_kind: "no_pickup", p_reference: co.ref, p_until: co.until || null }, "Order recorded")}>Record order</Button></div>
      </div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Gate check</h3>
        <div className="grid gap-2 md:grid-cols-3"><Input placeholder="Collector's name" value={pk.name} onChange={(e) => setPk({ ...pk, name: e.target.value })} /><Input placeholder="Collector's phone" value={pk.phone} onChange={(e) => setPk({ ...pk, phone: e.target.value })} />
          <Button disabled={!student} onClick={async () => { const r = await go<{ allowed: boolean; reason: string }>("pickup_verify", { p_student: student, p_name: pk.name, p_phone: pk.phone || null, p_user: null }, "Checked"); if (r) toast[r.allowed ? "success" : "error"](r.allowed ? "Allowed to collect" : `Do not release: ${r.reason.replace(/_/g, " ")}`); }}>Check</Button></div>
        <ul className="text-sm">{(pickups.data ?? []).map((p) => <li key={p.id}>{new Date(p.checked_at).toLocaleString()} · {adm(p.student_id)} · {p.collector_name ?? "—"} · {p.allowed ? "allowed" : "refused"} ({p.reason.replace(/_/g, " ")})</li>)}</ul></div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border p-3"><h3 className="font-medium">Transfers</h3><ul className="text-sm">{(transfers.data ?? []).map((t) => <li key={t.id} className="flex justify-between"><span>{adm(t.student_id)} → {t.to_school_name} · <code>{t.code}</code> · {t.status}</span>{t.status === "issued" && <button className="underline" onClick={() => go("transfer_cancel", { p_id: t.id }, "Cancelled")}>Cancel</button>}</li>)}</ul></div>
        <div className="rounded-lg border p-3"><h3 className="font-medium">Custody orders</h3><ul className="text-sm">{(orders.data ?? []).map((o) => <li key={o.id} className="flex justify-between"><span>{adm(o.student_id)} · {o.restricted_name} · {o.reference}{o.valid_until ? ` until ${o.valid_until}` : ""}{o.revoked_at ? " · revoked" : ""}</span>{!o.revoked_at && <button className="text-destructive underline" onClick={() => go("custody_order_revoke", { p_id: o.id }, "Revoked")}>Revoke</button>}</li>)}</ul></div>
      </div>
    </PortalPage>
  );
}
