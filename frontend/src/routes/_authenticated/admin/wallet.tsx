/**
 * School wallet, pay-as-you-go and cash tracker (SHERIVS-019).
 * Balance and ledger are read-only here: top-ups are credited by the verified Paystack webhook,
 * usage is metered pool-first then at the price book, and the Sherivs share is debited once per
 * student per term when the bursar records a cash payment.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { naira, rows, rpc, sdb } from "@/lib/scholar/rpc";
import { initWalletTopup } from "@/lib/runtime/scholar/wallet-topup.functions";

export const Route = createFileRoute("/_authenticated/admin/wallet")({ ssr: false, component: WalletPage });

type Ledger = { id: string; kind: string; amount: number; balance_after: number; reference: string; item: string | null; created_at: string };
type Pool = { item: string; allowance: number; used: number; term: string; academic_year: string };

function WalletPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const [year, setYear] = useState("2025/2026");
  const [term, setTerm] = useState("first");
  const [student, setStudent] = useState("");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState("");
  const [topAmount, setTopAmount] = useState("");
  const [topEmail, setTopEmail] = useState("");
  async function topUp() {
    try {
      const r = await initWalletTopup({ data: { school_id: org, amount: Number(topAmount), email: topEmail } });
      window.location.assign(r.authorization_url);
    } catch (e) { toast.error((e as Error).message); }
  }
  const wallet = useQuery({ queryKey: ["wallet", org], enabled: !!org, queryFn: () => rows<{ balance: number; low_balance_pct: number }>(sdb.from("school_wallets").select("balance,low_balance_pct").eq("school_id", org)) });
  const ledger = useQuery({ queryKey: ["ledger", org], enabled: !!org, queryFn: () => rows<Ledger>(sdb.from("wallet_ledger").select("*").eq("school_id", org).order("created_at", { ascending: false }).limit(50)) });
  const pools = useQuery({ queryKey: ["pools", org], enabled: !!org, queryFn: () => rows<Pool>(sdb.from("term_usage_pools").select("*").eq("school_id", org)) });
  const prices = useQuery({ queryKey: ["prices"], queryFn: () => rows<{ item: string; unit: string; price: number }>(sdb.from("usage_price_book").select("item,unit,price")) });
  const alerts = useQuery({ queryKey: ["walert", org], enabled: !!org, queryFn: () => rows<{ kind: string; created_at: string }>(sdb.from("wallet_alerts").select("kind,created_at").eq("school_id", org).order("created_at", { ascending: false }).limit(5)) });
  const leak = useQuery({ queryKey: ["leak", org, year, term], enabled: !!org, queryFn: () => rpc<{ students_paid: number; shares_collected: number; gap: number }>("platform_fee_leakage", { p_school: org, p_year: year, p_term: term }) });
  const refresh = () => qc.invalidateQueries();
  async function go(fn: string, args: Record<string, unknown>, ok: string) {
    try { await rpc(fn, args); toast.success(ok); await refresh(); } catch (e) { toast.error((e as Error).message); }
  }
  const bal = Number(wallet.data?.[0]?.balance ?? 0);
  return (
    <PortalPage title="Wallet & usage" subtitle="Prepaid balance, term allowances, pay-as-you-go and cash payments">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-4"><div className="text-sm text-muted-foreground">Balance</div>
          <div className={`text-3xl font-semibold ${bal < 0 ? "text-red-600" : ""}`}>{naira(bal)}</div>
          <div className="mt-2 flex gap-2"><Input value={topAmount} onChange={(e) => setTopAmount(e.target.value)} placeholder="Amount (₦)" aria-label="Top-up amount" inputMode="numeric" />
            <Input value={topEmail} onChange={(e) => setTopEmail(e.target.value)} placeholder="Receipt email" aria-label="Receipt email" type="email" /></div>
          <Button size="sm" className="mt-2" disabled={!org || Number(topAmount) < 100 || !topEmail} onClick={topUp}>Top up with Paystack</Button>
          <p className="mt-2 text-xs text-muted-foreground">Paystack test mode. The wallet is credited only after Paystack confirms. Safety messages and OTPs still go out at zero.</p></div>
        <div className="rounded-lg border p-4"><div className="text-sm text-muted-foreground">Leakage this term</div>
          <div className="text-3xl font-semibold">{leak.data?.gap ?? 0}</div>
          <p className="text-xs text-muted-foreground">{leak.data?.students_paid ?? 0} paid · {leak.data?.shares_collected ?? 0} Sherivs shares</p></div>
        <div className="rounded-lg border p-4"><div className="text-sm text-muted-foreground">Alerts</div>
          {(alerts.data ?? []).map((a, i) => <Badge key={i} variant="outline" className="mr-1">{a.kind.replace("_", " ")}</Badge>)}
          <div className="mt-2 flex gap-2"><Input value={year} onChange={(e) => setYear(e.target.value)} aria-label="Session" /><Input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term" /></div>
          <Button size="sm" className="mt-2" onClick={() => go("open_term_pools", { p_school: org, p_year: year, p_term: term }, "Term allowances opened")}>Open term allowances</Button></div>
      </div>
      <h3 className="mt-6 font-medium">Term allowances</h3>
      <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Item</th><th>Term</th><th>Used</th><th>Allowance</th><th>After limit</th></tr></thead>
        <tbody>{(pools.data ?? []).map((p) => (
          <tr key={p.item + p.term} className="border-t"><td>{p.item}</td><td>{p.academic_year} {p.term}</td><td>{Number(p.used).toLocaleString()}</td><td>{Number(p.allowance).toLocaleString()}</td>
            <td>{naira(prices.data?.find((x) => x.item === p.item)?.price)} / {prices.data?.find((x) => x.item === p.item)?.unit}</td></tr>))}</tbody></table>
      <h3 className="mt-6 font-medium">Record a cash / offline payment</h3>
      <div className="mt-2 grid gap-2 md:grid-cols-4">
        <Input placeholder="Student ID" value={student} onChange={(e) => setStudent(e.target.value)} />
        <Input placeholder="Amount (₦)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Input placeholder="Receipt no. or photo URL" value={receipt} onChange={(e) => setReceipt(e.target.value)} />
        <Button onClick={() => go("record_cash_payment", { p_school: org, p_student: student, p_year: year, p_term: term, p_amount: Number(amount),
          p_receipt_url: receipt.startsWith("http") ? receipt : null, p_receipt_no: receipt.startsWith("http") ? null : receipt }, "Payment recorded")}>Record</Button>
      </div>
      <h3 className="mt-6 font-medium">Ledger</h3>
      <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>When</th><th>Kind</th><th>Item</th><th>Amount</th><th>Balance</th></tr></thead>
        <tbody>{(ledger.data ?? []).map((l) => (
          <tr key={l.id} className="border-t"><td>{new Date(l.created_at).toLocaleString()}</td><td>{l.kind}</td><td>{l.item ?? "—"}</td>
            <td className={l.amount < 0 ? "text-red-600" : "text-emerald-600"}>{naira(l.amount)}</td><td>{naira(l.balance_after)}</td></tr>))}</tbody></table>
    </PortalPage>
  );
}
