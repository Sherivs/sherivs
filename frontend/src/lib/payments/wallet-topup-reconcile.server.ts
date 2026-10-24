/**
 * SHERIVS-028 — background reconciliation of pending wallet top-ups (Paystack TEST key only).
 *
 * 1. Expire: pending intents older than the timeout (default 24h) become failed ("expired").
 * 2. Verify: pending intents older than 5 minutes, not checked in the last 5 minutes, are
 *    verified with Paystack /transaction/verify and fed to the same idempotent settlement the
 *    webhook uses (wallet_topup_settle). Each check is counted on the intent.
 * Safe to run repeatedly or concurrently: settlement is compare-and-set on the reference.
 * Dependencies are injected so the sim can drive it against the Sim Lab DB.
 */
import { settleWalletTopup } from "@/lib/runtime/scholar/wallet-topup.functions";

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
export type ReconcileDeps = {
  admin: { rpc: Rpc };
  secret: string;
  fetchImpl?: typeof fetch;
  expireAfterHours?: number;
  limit?: number;
};
export type ReconcileReport = { expired: number; checked: number; settled: number; stillPending: number; errors: number };

export async function reconcileWalletTopups(deps: ReconcileDeps): Promise<ReconcileReport> {
  if (!deps.secret.startsWith("sk_test_")) throw new Error("Reconciliation is limited to the Paystack test key");
  const f = deps.fetchImpl ?? fetch;
  const hours = Math.max(1, Math.min(deps.expireAfterHours ?? 24, 24 * 14));
  const report: ReconcileReport = { expired: 0, checked: 0, settled: 0, stillPending: 0, errors: 0 };

  const ex = await deps.admin.rpc("wallet_topup_expire_stale", { p_after: `${hours} hours` });
  if (ex.error) throw new Error(ex.error.message);
  report.expired = Number(ex.data ?? 0);

  const list = await deps.admin.rpc("wallet_topup_pending_for_check", { p_min_age: "5 minutes", p_limit: deps.limit ?? 50 });
  if (list.error) throw new Error(list.error.message);
  const refs = ((list.data as unknown[]) ?? []).map((r) => (typeof r === "string" ? r : String((r as Record<string, unknown>).wallet_topup_pending_for_check ?? "")));

  for (const reference of refs.filter((r) => /^wtp_[0-9a-f]{32}$/.test(r))) {
    report.checked += 1;
    try {
      const res = await f(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${deps.secret}` } });
      const body = (await res.json().catch(() => ({}))) as { status?: boolean; data?: { status?: string; amount?: number; currency?: string } };
      if (res.ok && body.status && body.data) {
        const r = await settleWalletTopup(deps.admin, { reference, status: body.data.status, amountKobo: body.data.amount, currency: body.data.currency });
        if (r.outcome === "settled") report.settled += 1;
        else report.stillPending += 1;
      } else {
        report.stillPending += 1; // not found yet / abandoned checkout: try again next run, expire after the timeout
      }
    } catch {
      report.errors += 1;
    } finally {
      await deps.admin.rpc("wallet_topup_mark_checked", { p_reference: reference });
    }
  }
  return report;
}
