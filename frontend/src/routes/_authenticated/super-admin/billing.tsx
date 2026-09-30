/**
 * Super Admin billing.
 * Subscription history + Monthly Invoice Calculator computing
 * platform_fee + (live student count × per-student fee) per school.
 * Per-student fees come from SUBSCRIPTION_TIERS, with per-tier
 * overrides via the platform_config.per_student_fees jsonb entry.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PortalPage, EmptyCard, StatCard, SectionGrid } from "@/components/portal-shell";
import { SUBSCRIPTION_TIERS, getTier, type TierName } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/super-admin/billing")({
  ssr: false,
  component: SuperAdminBillingPage,
});

type Row = {
  id: string;
  school_id: string;
  plan: string;
  status: string | null;
  amount_paid: number | null;
  expires_at: string | null;
  school_name: string;
};

type SchoolRow = {
  id: string;
  name: string;
  subscription_tier: string | null;
};

function SuperAdminBillingPage() {
  const qc = useQueryClient();
  const subs = useQuery<Row[]>({
    queryKey: ["sa-subscriptions"],
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("id, school_id, plan, status, amount_paid, expires_at")
        .order("expires_at", { ascending: true, nullsFirst: false })
        .limit(500);
      const list = (data ?? []) as Array<{
        id: string;
        school_id: string;
        plan: string;
        status: string | null;
        amount_paid: number | null;
        expires_at: string | null;
      }>;
      const schoolIds = Array.from(new Set(list.map((s) => s.school_id)));
      const { data: schools } = schoolIds.length
        ? await supabase.from("schools").select("id, name").in("id", schoolIds)
        : { data: [] as { id: string; name: string }[] };
      const nameOf = new Map((schools ?? []).map((s) => [s.id, s.name as string]));
      return list.map((s) => ({ ...s, school_name: nameOf.get(s.school_id) ?? "—" }));
    },
  });

  const renewalsQ = useQuery({
    queryKey: ["sa-renewals"],
    queryFn: async () => {
      const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const { data } = await supabase
        .from("schools")
        .select(
          "id, name, subscription_tier, subscription_expires_at, monthly_fee, subscription_status",
        )
        .not("subscription_expires_at", "is", null)
        .lte("subscription_expires_at", in30)
        .order("subscription_expires_at", { ascending: true });
      return (data ?? []) as Array<{
        id: string;
        name: string;
        subscription_tier: string | null;
        subscription_expires_at: string | null;
        monthly_fee: number | null;
        subscription_status: string | null;
      }>;
    },
  });

  const feeCfg = useQuery<Record<string, number>>({
    queryKey: ["per-student-fees-cfg"],
    queryFn: async () => {
      const { data } = await supabase
        .from("platform_config")
        .select("value")
        .eq("key", "per_student_fees")
        .maybeSingle();
      return (data?.value ?? {}) as Record<string, number>;
    },
  });

  const schools = useQuery<SchoolRow[]>({
    queryKey: ["sa-schools-billing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schools")
        .select("id, name, subscription_tier")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as SchoolRow[];
    },
  });

  const counts = useQuery<Map<string, number>>({
    queryKey: ["sa-student-counts", schools.data?.map((s) => s.id).join(",")],
    enabled: !!schools.data && schools.data.length > 0,
    queryFn: async () => {
      const map = new Map<string, number>();
      await Promise.all(
        (schools.data ?? []).map(async (s) => {
          const { count } = await supabase
            .from("students")
            .select("id", { count: "exact", head: true })
            .eq("school_id", s.id);
          map.set(s.id, count ?? 0);
        }),
      );
      return map;
    },
  });

  const invoiceRows = useMemo(() => {
    const list = schools.data ?? [];
    const overrides = feeCfg.data ?? {};
    return list.map((s) => {
      const tier = getTier(s.subscription_tier) as TierName;
      const tierDef = SUBSCRIPTION_TIERS[tier];
      const platformFee = tierDef.price_monthly;
      const perStudent =
        overrides[tier] != null ? Number(overrides[tier]) : tierDef.per_student_fee_monthly;
      const students = counts.data?.get(s.id) ?? 0;
      const perStudentTotal = students * perStudent;
      const total = platformFee + perStudentTotal;
      return {
        id: s.id,
        name: s.name,
        tierLabel: tierDef.name,
        students,
        platformFee,
        perStudent,
        perStudentTotal,
        total,
      };
    });
  }, [schools.data, counts.data, feeCfg.data]);

  const monthlyTotal = invoiceRows.reduce((a, r) => a + r.total, 0);

  const rows = subs.data ?? [];
  const active = rows.filter((r) => r.status === "active").length;
  const totalPaid = rows.reduce((a, r) => a + Number(r.amount_paid ?? 0), 0);

  const revenueTrend = useMemo(() => {
    const buckets: { label: string; v: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const v = rows
        .filter((r) => {
          if (!r.expires_at) return false;
          const t = new Date(r.expires_at).getTime();
          return t >= start.getTime() && t < end.getTime();
        })
        .reduce((a, r) => a + Number(r.amount_paid ?? 0), 0);
      buckets.push({ label: start.toLocaleString("default", { month: "short" }), v });
    }
    return buckets;
  }, [rows]);

  const overdue = useMemo(() => {
    const now = Date.now();
    return (renewalsQ.data ?? []).filter(
      (s) => s.subscription_expires_at && new Date(s.subscription_expires_at).getTime() < now,
    );
  }, [renewalsQ.data]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return (renewalsQ.data ?? []).filter(
      (s) => s.subscription_expires_at && new Date(s.subscription_expires_at).getTime() >= now,
    );
  }, [renewalsQ.data]);

  const [pay, setPay] = useState<{
    schoolId: string;
    plan: string;
    amount: number;
    reference: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function recordPayment() {
    if (!pay) return;
    setBusy(true);
    const started = new Date().toISOString();
    const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { error } = await supabase.from("subscriptions").insert({
      school_id: pay.schoolId,
      plan: pay.plan,
      status: "active",
      amount_paid: pay.amount,
      started_at: started,
      expires_at: expires,
      paystack_reference: pay.reference || `manual-${Date.now()}`,
    });
    if (!error) {
      await supabase
        .from("schools")
        .update({
          subscription_status: "active",
          subscription_expires_at: expires,
          subscription_tier: pay.plan,
        })
        .eq("id", pay.schoolId);
    }
    setBusy(false);
    if (error) return alert(error.message);
    setPay(null);
    void qc.invalidateQueries({ queryKey: ["sa-subscriptions"] });
    void qc.invalidateQueries({ queryKey: ["sa-renewals"] });
  }

  return (
    <PortalPage
      title="Billing"
      subtitle="Subscriptions and monthly invoices across all tenant schools."
    >
      <SectionGrid>
        <StatCard label="Total subscriptions" value={rows.length} />
        <StatCard label="Active" value={active} />
        <StatCard label="Total collected (₦)" value={totalPaid.toLocaleString()} />
        <StatCard label="Projected monthly (₦)" value={monthlyTotal.toLocaleString()} />
      </SectionGrid>

      {/* Revenue trend */}
      <section className="uos-card mt-6 p-5">
        <h2 className="font-display text-lg font-semibold">Revenue collected — last 6 months</h2>
        <div className="mt-4 grid grid-cols-6 gap-2">
          {revenueTrend.map((m) => {
            const max = Math.max(1, ...revenueTrend.map((x) => x.v));
            const h = Math.max(4, Math.round((m.v / max) * 90));
            return (
              <div key={m.label} className="flex flex-col items-center gap-1">
                <div
                  title={`₦${m.v.toLocaleString()}`}
                  className="w-full rounded-t bg-emerald-500"
                  style={{ height: `${h}px` }}
                />
                <div className="text-[10px] text-muted-foreground">{m.label}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Renewals */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="uos-card">
          <header className="border-b border-border p-4">
            <h2 className="font-display text-base font-semibold">Overdue</h2>
            <p className="text-xs text-muted-foreground">
              Expired subscriptions requiring follow-up.
            </p>
          </header>
          {overdue.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No overdue schools.</p>
          ) : (
            <ul className="divide-y divide-border">
              {overdue.map((s) => (
                <li key={s.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.subscription_tier} · expired{" "}
                      {new Date(s.subscription_expires_at!).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setPay({
                        schoolId: s.id,
                        plan: s.subscription_tier ?? "starter",
                        amount: Number(s.monthly_fee ?? 0),
                        reference: "",
                      })
                    }
                    className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground"
                  >
                    Record payment
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="uos-card">
          <header className="border-b border-border p-4">
            <h2 className="font-display text-base font-semibold">Upcoming renewals (30 days)</h2>
          </header>
          {upcoming.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No renewals in the next 30 days.</p>
          ) : (
            <ul className="divide-y divide-border">
              {upcoming.map((s) => (
                <li key={s.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.subscription_tier} · renews{" "}
                      {new Date(s.subscription_expires_at!).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setPay({
                        schoolId: s.id,
                        plan: s.subscription_tier ?? "starter",
                        amount: Number(s.monthly_fee ?? 0),
                        reference: "",
                      })
                    }
                    className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    Record payment
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="uos-card mt-6 overflow-x-auto">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Monthly Invoice Calculator</h2>
            <p className="text-xs text-muted-foreground">
              Platform fee + (live student count × per-student fee) per school.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              All schools this month
            </div>
            <div className="font-mono text-xl font-bold">₦{monthlyTotal.toLocaleString()}</div>
          </div>
        </div>
        {invoiceRows.length === 0 ? (
          <EmptyCard
            title="No active schools yet"
            body="Schools will appear here once provisioned."
          />
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-3">School</th>
                  <th className="p-3">Plan</th>
                  <th className="p-3 text-right">Students</th>
                  <th className="p-3 text-right">Platform fee</th>
                  <th className="p-3 text-right">Per-student fee</th>
                  <th className="p-3 text-right">Per-student total</th>
                  <th className="p-3 text-right">Invoice total</th>
                </tr>
              </thead>
              <tbody>
                {invoiceRows.map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3">{r.tierLabel}</td>
                    <td className="p-3 text-right font-mono">{r.students.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">₦{r.platformFee.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">₦{r.perStudent.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">
                      ₦{r.perStudentTotal.toLocaleString()}
                    </td>
                    <td className="p-3 text-right font-mono font-bold">
                      ₦{r.total.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td
                    colSpan={6}
                    className="p-3 text-right text-xs uppercase tracking-widest text-muted-foreground"
                  >
                    Combined monthly invoice
                  </td>
                  <td className="p-3 text-right font-mono text-base font-bold">
                    ₦{monthlyTotal.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <div className="uos-card mt-6 overflow-x-auto">
        <h2 className="mb-3 text-lg font-semibold">Subscription history</h2>
        {rows.length === 0 ? (
          <EmptyCard
            title="No subscriptions yet"
            body="When schools subscribe to a plan they will appear here."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3">School</th>
                <th className="p-3">Plan</th>
                <th className="p-3">Status</th>
                <th className="p-3">Amount paid</th>
                <th className="p-3">Expires</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/40">
                  <td className="p-3 font-medium">{r.school_name}</td>
                  <td className="p-3">{r.plan}</td>
                  <td className="p-3">{r.status ?? "—"}</td>
                  <td className="p-3 font-mono">
                    {r.amount_paid != null ? `₦${Number(r.amount_paid).toLocaleString()}` : "—"}
                  </td>
                  <td className="p-3 text-muted-foreground">{r.expires_at ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Manual payment modal */}
      {pay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !busy && setPay(null)}
        >
          <div className="uos-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold">Record manual payment</h3>
            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="block text-[11px] uppercase tracking-widest text-muted-foreground">
                  Plan
                </span>
                <select
                  value={pay.plan}
                  onChange={(e) => setPay({ ...pay, plan: e.target.value })}
                  className="uos-input mt-1"
                >
                  {(["trial", "starter", "growth", "professional", "enterprise"] as const).map(
                    (p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="block">
                <span className="block text-[11px] uppercase tracking-widest text-muted-foreground">
                  Amount (₦)
                </span>
                <input
                  type="number"
                  value={pay.amount}
                  onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })}
                  className="uos-input mt-1"
                />
              </label>
              <label className="block">
                <span className="block text-[11px] uppercase tracking-widest text-muted-foreground">
                  Reference (optional)
                </span>
                <input
                  value={pay.reference}
                  onChange={(e) => setPay({ ...pay, reference: e.target.value })}
                  placeholder="Bank transfer receipt no."
                  className="uos-input mt-1"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPay(null)}
                disabled={busy}
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={recordPayment}
                disabled={busy}
                className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Recording…" : "Record payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalPage>
  );
}
