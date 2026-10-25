/** Fee relief (discounts, scholarships, waivers) with maker-checker, sibling rule, levies and statements (SHERIVS-A05). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/fee-relief")({ ssr: false, component: FeeReliefPage });
type Adj = { id: string; student_id: string; kind: string; mode: string; value: number; term: string; academic_year: string; fee_type: string | null; sponsor: string | null; reason: string; status: string; rule: string | null };
type Statement = { gross: number; relief: number; net: number; paid: number; balance: number; items: { id: string; kind: string; reason: string; amount: number }[] };

function FeeReliefPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const students = useQuery({ queryKey: ["students-min", org], enabled: !!org, queryFn: () => rows<{ id: string; admission_number: string | null }>(sdb.from("students").select("id,admission_number").eq("school_id", org).eq("is_active", true)) });
  const adjs = useQuery({ queryKey: ["fee-adj", org], enabled: !!org, queryFn: () => rows<Adj>(sdb.from("fee_adjustments").select("id,student_id,kind,mode,value,term,academic_year,fee_type,sponsor,reason,status,rule").eq("school_id", org).order("created_at", { ascending: false }).limit(200)) });
  const [f, setF] = useState({ student: "", kind: "discount", mode: "percent", value: "10", term: "first", year: "", feeType: "", sponsor: "", reason: "" });
  const [lv, setLv] = useState({ name: "", amount: "", term: "first", year: "" });
  const [sib, setSib] = useState({ from: "2", pct: "10", term: "first", year: "" });
  const [st, setSt] = useState<Statement | null>(null);
  const adm = (id: string) => students.data?.find((x) => x.id === id)?.admission_number ?? id.slice(0, 8);
  async function go<T>(fn: string, args: Record<string, unknown>, ok: string) {
    try { const r = await rpc<T>(fn, args); toast.success(ok); await qc.invalidateQueries(); return r; } catch (e) { toast.error((e as Error).message); return null; }
  }
  const s = "rounded-md border bg-background p-2 text-sm";
  return (
    <PortalPage title="Fee relief & levies" subtitle="Discounts, scholarships and waivers need a second approver. Levies and sibling discounts apply once, never twice.">
      <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Request relief</h3>
        <div className="grid gap-2 md:grid-cols-5">
          <select className={s} aria-label="Student" value={f.student} onChange={(e) => setF({ ...f, student: e.target.value })}><option value="">Choose a student</option>{(students.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.admission_number ?? x.id.slice(0, 8)}</option>)}</select>
          <select className={s} aria-label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="discount">Discount</option><option value="scholarship">Scholarship</option><option value="waiver">Waiver</option></select>
          <select className={s} aria-label="Mode" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="percent">Percent</option><option value="fixed">Fixed ₦</option></select>
          <Input aria-label="Value" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          <Input placeholder="Fee type (blank = all)" value={f.feeType} onChange={(e) => setF({ ...f, feeType: e.target.value })} />
          <Input placeholder="Term" value={f.term} onChange={(e) => setF({ ...f, term: e.target.value })} />
          <Input placeholder="Session e.g. 2026/2027" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
          <Input placeholder="Sponsor (scholarships)" value={f.sponsor} onChange={(e) => setF({ ...f, sponsor: e.target.value })} />
          <Input className="md:col-span-2" placeholder="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <Button disabled={!f.student} onClick={() => go("fee_relief_request", { p_student: f.student, p_kind: f.kind, p_mode: f.mode, p_value: Number(f.value), p_term: f.term, p_year: f.year, p_reason: f.reason, p_fee_type: f.feeType || null, p_sponsor: f.sponsor || null }, "Sent for approval")}>Request</Button>
          <Button variant="outline" disabled={!f.student} onClick={async () => setSt(await go<Statement>("fee_statement", { p_student: f.student, p_term: f.term, p_year: f.year }, "Statement loaded"))}>Show statement</Button>
        </div>
        {st && <p className="text-sm">Gross ₦{st.gross} · relief ₦{st.relief} · net ₦{st.net} · paid ₦{st.paid} · balance ₦{st.balance}</p>}</div>
      <div className="mt-4 rounded-lg border p-3"><h3 className="font-medium">Relief requests</h3>
        <ul className="text-sm">{(adjs.data ?? []).map((a) => <li key={a.id} className="flex justify-between gap-2"><span>{adm(a.student_id)} · {a.kind} {a.mode === "percent" ? `${a.value}%` : `₦${a.value}`}{a.fee_type ? ` on ${a.fee_type}` : ""}{a.sponsor ? ` (${a.sponsor})` : ""} · {a.term} {a.academic_year} · {a.reason} · <b>{a.status}</b></span>
          <span className="flex gap-2">{a.status === "pending" && <><button className="underline" onClick={() => go("fee_relief_decide", { p_id: a.id, p_approve: true }, "Approved")}>Approve</button><button className="underline" onClick={() => go("fee_relief_decide", { p_id: a.id, p_approve: false }, "Rejected")}>Reject</button></>}
            {(a.status === "approved" || a.status === "pending") && <button className="text-destructive underline" onClick={() => go("fee_relief_revoke", { p_id: a.id }, "Revoked")}>Revoke</button>}</span></li>)}</ul></div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Levy (whole school)</h3>
          <Input placeholder="Levy name" value={lv.name} onChange={(e) => setLv({ ...lv, name: e.target.value })} />
          <Input placeholder="Amount ₦" value={lv.amount} onChange={(e) => setLv({ ...lv, amount: e.target.value })} />
          <Input placeholder="Term" value={lv.term} onChange={(e) => setLv({ ...lv, term: e.target.value })} />
          <Input placeholder="Session" value={lv.year} onChange={(e) => setLv({ ...lv, year: e.target.value })} />
          <Button onClick={() => go("fee_levy_create", { p_org: org, p_name: lv.name, p_amount: Number(lv.amount), p_term: lv.term, p_year: lv.year, p_classes: null }, "Levy charged")}>Charge levy</Button></div>
        <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Sibling discount</h3>
          <Input aria-label="From child number" value={sib.from} onChange={(e) => setSib({ ...sib, from: e.target.value })} />
          <Input aria-label="Percent" value={sib.pct} onChange={(e) => setSib({ ...sib, pct: e.target.value })} />
          <Input placeholder="Term" value={sib.term} onChange={(e) => setSib({ ...sib, term: e.target.value })} />
          <Input placeholder="Session" value={sib.year} onChange={(e) => setSib({ ...sib, year: e.target.value })} />
          <div className="flex gap-2"><Button variant="outline" onClick={() => go("fee_sibling_rule_set", { p_org: org, p_from_child: Number(sib.from), p_percent: Number(sib.pct) }, "Rule saved")}>Save rule</Button>
            <Button onClick={() => go("fee_sibling_apply", { p_org: org, p_term: sib.term, p_year: sib.year }, "Sibling discounts applied")}>Apply for term</Button></div></div>
      </div>
    </PortalPage>
  );
}
