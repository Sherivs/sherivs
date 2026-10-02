import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PortalPage, SectionGrid, StatCard } from "@/components/portal-shell";
import { PaginationBar } from "@/components/pagination-bar";
import { usePagination, PAGE_SIZE } from "@/hooks/use-pagination";
import { Input } from "@/components/ui/input";
import { AddSchoolForm } from "@/components/super-admin/add-school-form";
import { updateSchoolPlan, resetSchoolAdminPassword } from "@/lib/runtime/scholar/provisioning.functions";
import { ALL_TIERS } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/super-admin/schools")({
  ssr: false,
  component: SuperAdminSchools,
});

type SchoolRow = {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  is_active: boolean;
  created_at: string;
  monthly_fee: number | null;
};

function SuperAdminSchools() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [editing, setEditing] = useState<SchoolRow | null>(null);
  const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null);
  const { page, from, to, nextPage, prevPage, goToPage, reset } = usePagination();
  const updatePlan = useServerFn(updateSchoolPlan);
  const resetPw = useServerFn(resetSchoolAdminPassword);

  // Reset to page 0 when the search term changes.
  useEffect(() => {
    reset();
  }, [q, reset]);

  const schools = useQuery<{
    rows: SchoolRow[];
    count: number;
    stats: { total: number; active: number; paying: number; expiring: number };
  }>({
    queryKey: ["all-schools", q, page],
    queryFn: async () => {
      // Stats query: small projection, no range — counts use head:true to skip rows.
      const term = q.trim();
      const pattern = `%${term}%`;

      let listQuery = supabase
        .from("schools")
        .select(
          "id, name, slug, subscription_tier, subscription_status, subscription_expires_at, is_active, created_at, monthly_fee",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range(from, to);
      if (term) listQuery = listQuery.or(`name.ilike.${pattern},slug.ilike.${pattern}`);

      const [{ data, error, count }, statsRes] = await Promise.all([
        listQuery,
        supabase.from("schools").select("is_active, subscription_tier, subscription_expires_at"),
      ]);
      if (error) throw new Error(error.message);
      if (statsRes.error) throw new Error(statsRes.error.message);

      const all = (statsRes.data ?? []) as Array<{
        is_active: boolean;
        subscription_tier: string | null;
        subscription_expires_at: string | null;
      }>;
      const in30 = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const stats = {
        total: all.length,
        active: all.filter((s) => s.is_active).length,
        paying: all.filter((s) => s.subscription_tier && s.subscription_tier !== "trial").length,
        expiring: all.filter((s) => {
          if (!s.subscription_expires_at) return false;
          const d = new Date(s.subscription_expires_at).getTime();
          return d > Date.now() && d < in30;
        }).length,
      };

      return { rows: (data ?? []) as SchoolRow[], count: count ?? 0, stats };
    },
  });

  async function toggle(s: SchoolRow) {
    setBusy(s.id);
    try {
      await updatePlan({ data: { schoolId: s.id, isActive: !s.is_active } });
    } catch (e) {
      setBusy(null);
      return alert(e instanceof Error ? e.message : "Failed");
    }
    setBusy(null);
    void qc.invalidateQueries({ queryKey: ["all-schools"] });
  }

  async function doResetPw(s: SchoolRow) {
    if (!confirm(`Reset admin password for ${s.name}?`)) return;
    setBusy(s.id);
    try {
      const r = await resetPw({ data: { schoolId: s.id } });
      setResetResult({ email: r.adminEmail ?? "(unknown)", password: r.tempPassword });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const rows = schools.data?.rows ?? [];
  const total = schools.data?.count ?? 0;
  const stats = schools.data?.stats ?? { total: 0, active: 0, paying: 0, expiring: 0 };

  return (
    <PortalPage title="Schools" subtitle="All tenant schools on the platform.">
      {showWizard && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
          onClick={() => setShowWizard(false)}
        >
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <AddSchoolForm
              onCreated={() => {
                void qc.invalidateQueries({ queryKey: ["all-schools"] });
              }}
            />
            <button
              onClick={() => setShowWizard(false)}
              className="mt-3 w-full rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {resetResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setResetResult(null)}
        >
          <div className="uos-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold">Password reset</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Share these credentials with the school admin. This is the only time the temporary
              password is shown.
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <div className="rounded-md border border-border p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Admin email</div>
                <div className="font-mono break-all">{resetResult.email}</div>
              </div>
              <div className="rounded-md border border-border p-2">
                <div className="text-[10px] uppercase text-muted-foreground">
                  Temporary password
                </div>
                <div className="font-mono break-all">{resetResult.password}</div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() =>
                  navigator.clipboard.writeText(
                    `Email: ${resetResult.email}\nTemp password: ${resetResult.password}`,
                  )
                }
                className="rounded-md border border-border px-3 py-2 text-sm"
              >
                Copy
              </button>
              <button
                onClick={() => setResetResult(null)}
                className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <EditSchoolDialog
          school={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["all-schools"] });
          }}
        />
      )}

      <SectionGrid>
        <StatCard label="Total schools" value={stats.total} />
        <StatCard label="Active" value={stats.active} />
        <StatCard label="Paid plans" value={stats.paying} />
        <StatCard label="Expiring in 30d" value={stats.expiring} />
      </SectionGrid>

      <div className="mt-8 uos-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="font-display text-lg font-semibold">Tenant directory</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filter by name or slug…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs"
            />
            <button
              onClick={() => setShowWizard(true)}
              className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
            >
              + Onboard school
            </button>
          </div>
        </header>
        {schools.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No schools match your filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">School</th>
                  <th className="px-3 py-2 text-left">Tier</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Expires</th>
                  <th className="px-3 py-2 text-right">Monthly</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{s.name}</div>
                      <a
                        href={`/?school=${s.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        /?school={s.slug} ↗
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase">
                        {s.subscription_tier ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                          s.is_active
                            ? "uos-tenant-bg"
                            : "border border-border text-muted-foreground"
                        }`}
                      >
                        {s.is_active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {s.subscription_expires_at
                        ? new Date(s.subscription_expires_at).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {s.monthly_fee ? `₦${Number(s.monthly_fee).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <a
                          href={`/?school=${s.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/40"
                          title="Open tenant public site"
                        >
                          View
                        </a>
                        <button
                          onClick={() => setEditing(s)}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/40"
                        >
                          Edit
                        </button>
                        <button
                          disabled={busy === s.id}
                          onClick={() => doResetPw(s)}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
                        >
                          Reset pw
                        </button>
                        <button
                          disabled={busy === s.id}
                          onClick={() => toggle(s)}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/40 disabled:opacity-50"
                        >
                          {busy === s.id ? "…" : s.is_active ? "Suspend" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <PaginationBar
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              onNext={nextPage}
              onPrev={prevPage}
              onPage={goToPage}
              isLoading={schools.isFetching}
            />
          </div>
        )}
      </div>
    </PortalPage>
  );
}

function EditSchoolDialog({
  school,
  onClose,
  onSaved,
}: {
  school: SchoolRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const updatePlan = useServerFn(updateSchoolPlan);
  const [tier, setTier] = useState<string>(school.subscription_tier ?? "trial");
  const [status, setStatus] = useState<string>(school.subscription_status ?? "active");
  const [fee, setFee] = useState<number>(Number(school.monthly_fee ?? 0));
  const [expires, setExpires] = useState<string>(
    school.subscription_expires_at ? school.subscription_expires_at.slice(0, 10) : "",
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updatePlan({
        data: {
          schoolId: school.id,
          subscriptionTier: tier as (typeof ALL_TIERS)[number],
          subscriptionStatus: status as "active" | "suspended" | "expired" | "trial",
          monthlyFee: fee,
          expiresAt: expires ? new Date(expires).toISOString() : null,
        },
      });
      onSaved();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div className="uos-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-semibold">Edit {school.name}</h3>
        <div className="mt-4 space-y-3 text-sm">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-widest text-muted-foreground">
              Tier
            </span>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="uos-input mt-1"
            >
              {ALL_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-widest text-muted-foreground">
              Status
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="uos-input mt-1"
            >
              {["active", "trial", "suspended", "expired"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-widest text-muted-foreground">
              Monthly fee (₦)
            </span>
            <input
              type="number"
              value={fee}
              onChange={(e) => setFee(Number(e.target.value))}
              className="uos-input mt-1"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-widest text-muted-foreground">
              Expires
            </span>
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className="uos-input mt-1"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
