/** HR: salary profiles, loans, payroll run (PAYE per Nigeria Tax Act 2025 bands, pension 8%/10%, NHF), appraisals (SHERIVS-024). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { naira, rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/hr-payroll")({ ssr: false, component: HrPayroll });
type Line = { id: string; user_id: string; gross_salary: number; tax_deduction: number; pension_deduction: number; loan_deduction: number; net_salary: number; status: string };

function HrPayroll() {
  const { school } = useApp(); const org = school?.id ?? ""; const qc = useQueryClient();
  const now = new Date(); const [month, setMonth] = useState(now.getMonth() + 1); const [year, setYear] = useState(now.getFullYear());
  const [p, setP] = useState({ user: "", basic: "", housing: "", transport: "", other: "", rent: "" });
  const staff = useQuery({ queryKey: ["staff-all", org], enabled: !!org, queryFn: () => rows<{ id: string; full_name: string }>(sdb.from("users").select("id,full_name").eq("school_id", org).eq("role", "teacher")) });
  const lines = useQuery({ queryKey: ["payroll", org, month, year], enabled: !!org, queryFn: () => rows<Line>(sdb.from("staff_payroll").select("id,user_id,gross_salary,tax_deduction,pension_deduction,loan_deduction,net_salary,status").eq("school_id", org).eq("month", month).eq("year", year)) });
  const loans = useQuery({ queryKey: ["loans", org], enabled: !!org, queryFn: () => rows<{ id: string; user_id: string; principal: number; monthly_deduction: number; status: string }>(sdb.from("staff_loans").select("id,user_id,principal,monthly_deduction,status").eq("school_id", org)) });
  const name = (id: string) => (staff.data ?? []).find((s) => s.id === id)?.full_name ?? id.slice(0, 8);
  async function go(fn: string, args: Record<string, unknown>, ok: string) { try { const r = await rpc(fn, args); toast.success(`${ok}${typeof r === "object" && r ? `: ${JSON.stringify(r)}` : ""}`); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  const n = (x: string) => Number(x || 0);
  return (
    <PortalPage title="HR & payroll" subtitle="Preparer and approver must be different people. PAYE uses the Nigeria Tax Act 2025 bands (confirm with your tax adviser).">
      <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Salary profile (monthly)</h3>
        <select className="rounded-md border bg-background p-2 text-sm" value={p.user} onChange={(e) => setP({ ...p, user: e.target.value })} aria-label="Staff"><option value="">Staff</option>{(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
        <div className="grid gap-2 md:grid-cols-5">{(["basic", "housing", "transport", "other", "rent"] as const).map((k) => <Input key={k} placeholder={k === "rent" ? "annual rent" : k} value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} />)}</div>
        <Button onClick={() => go("salary_profile_set", { p_user: p.user, p_basic: n(p.basic), p_housing: n(p.housing), p_transport: n(p.transport), p_other: n(p.other), p_rent: n(p.rent) }, "Saved")}>Save profile</Button></div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Payroll run</h3>
        <div className="flex gap-2"><Input type="number" value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month" /><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year" />
          <Button onClick={() => go("payroll_compute", { p_school: org, p_month: month, p_year: year }, "Computed")}>Compute (preparer)</Button>
          <Button variant="outline" onClick={() => go("payroll_approve", { p_school: org, p_month: month, p_year: year }, "Approved lines")}>Approve (approver)</Button></div>
        <table className="w-full text-sm"><thead><tr className="text-left"><th>Staff</th><th>Gross</th><th>PAYE</th><th>Pension</th><th>Loan</th><th>Net</th><th>Status</th></tr></thead>
          <tbody>{(lines.data ?? []).map((l) => <tr key={l.id} className="border-t"><td>{name(l.user_id)}</td><td>{naira(l.gross_salary)}</td><td>{naira(l.tax_deduction)}</td><td>{naira(l.pension_deduction)}</td><td>{naira(l.loan_deduction)}</td><td>{naira(l.net_salary)}</td><td>{l.status}</td></tr>)}</tbody></table></div>
      <div className="mt-4 rounded-lg border p-3"><h3 className="font-medium">Loan requests</h3>
        <ul className="text-sm">{(loans.data ?? []).filter((l) => l.status === "requested").map((l) => <li key={l.id} className="flex items-center justify-between py-1"><span>{name(l.user_id)} · {naira(l.principal)} at {naira(l.monthly_deduction)}/month</span>
          <span className="flex gap-1"><Button size="sm" onClick={() => go("loan_decide", { p_loan: l.id, p_approve: true }, "Approved")}>Approve</Button><Button size="sm" variant="outline" onClick={() => go("loan_decide", { p_loan: l.id, p_approve: false }, "Rejected")}>Reject</Button></span></li>)}</ul></div>
    </PortalPage>);
}
