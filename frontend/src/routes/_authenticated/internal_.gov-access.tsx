import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { InternalSecurityGate } from "@/components/security/internal-security-gate";
import { useApp } from "@/contexts/app-context";
import { capabilitiesForRoles, isPlatformRoleCode } from "@/lib/platform-staff/catalogue";
import { rpc } from "@/lib/scholar/rpc";

/**
 * Internal console — government access (SHERIVS-028). Sherivs staff with platform.gov.manage
 * (or super admins) create jurisdictions and grant / revoke officer accounts. Every change is
 * written to gov_admin_audit by the database; the permission is re-checked server-side.
 */
export const Route = createFileRoute("/_authenticated/internal_/gov-access")({
  ssr: false,
  component: () => (
    <InternalSecurityGate>
      <GovAccessPage />
    </InternalSecurityGate>
  ),
});

type Viewer = { user_id: string; email: string; granted_at: string };
type Jur = { id: string; name: string; state: string; lga: string | null; schools_sharing: number; viewers: Viewer[] };
type Audit = { action: string; at: string; actor: string | null; jurisdiction_id: string | null; detail: Record<string, unknown> | null };
type Overview = { jurisdictions: Jur[]; audit: Audit[] };

function GovAccessPage() {
  const { superAdmin, platformStaff } = useApp();
  const caps = capabilitiesForRoles((platformStaff?.roles ?? []).filter(isPlatformRoleCode));
  const allowed = Boolean(superAdmin) || caps.has("platform.gov.manage");
  const [data, setData] = useState<Overview | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", state: "", lga: "" });
  const [grant, setGrant] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    rpc<Overview>("gov_admin_overview").then(setData).catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  if (!allowed) return <Navigate to="/internal" replace />;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); load(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" }); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 text-sm">
      <h1 className="font-display text-2xl font-bold">Government access</h1>
      <p className="text-muted-foreground">Officers see only aggregate, small-group-suppressed figures for schools that opted in to share with their jurisdiction.</p>
      {msg && <p className={msg.ok ? "text-emerald-600" : "text-destructive"} role="status">{msg.text}</p>}

      <section className="uos-card p-5">
        <h2 className="font-display font-semibold">New jurisdiction</h2>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void act(() => rpc("gov_jurisdiction_create", { p_name: form.name, p_state: form.state, p_lga: form.lga || null }).then(() => setForm({ name: "", state: "", lga: "" })), "Jurisdiction created"); }}>
          <input aria-label="Name" required minLength={3} placeholder="Name (e.g. Kano State MoE)" className="rounded border px-2 py-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input aria-label="State" required minLength={2} placeholder="State" className="rounded border px-2 py-1" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          <input aria-label="LGA" placeholder="LGA (optional)" className="rounded border px-2 py-1" value={form.lga} onChange={(e) => setForm({ ...form, lga: e.target.value })} />
          <button disabled={busy} className="rounded bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50">Create</button>
        </form>
      </section>

      {data?.jurisdictions.map((j) => (
        <section key={j.id} className="uos-card p-5">
          <h2 className="font-display font-semibold">{j.name} <span className="text-muted-foreground">— {j.state}{j.lga ? ` / ${j.lga}` : ""} · {j.schools_sharing} school(s) sharing</span></h2>
          <ul className="mt-2 space-y-1">
            {j.viewers.length === 0 && <li className="text-muted-foreground">No officers yet.</li>}
            {j.viewers.map((v) => (
              <li key={v.user_id} className="flex items-center justify-between gap-2">
                <span>{v.email} <span className="text-muted-foreground">since {v.granted_at.slice(0, 10)}</span></span>
                <button disabled={busy} className="text-destructive underline disabled:opacity-50" onClick={() => { if (confirm(`Revoke ${v.email} from ${j.name}?`)) void act(() => rpc("gov_viewer_revoke", { p_user: v.user_id, p_jurisdiction: j.id }), "Access revoked"); }}>Revoke</button>
              </li>
            ))}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const email = grant[j.id] ?? ""; void act(() => rpc("gov_viewer_grant_email", { p_email: email, p_jurisdiction: j.id }).then(() => setGrant({ ...grant, [j.id]: "" })), `Granted ${email}`); }}>
            <input aria-label={`Officer email for ${j.name}`} type="email" required placeholder="officer@ministry.gov.ng (must have signed up)" className="flex-1 rounded border px-2 py-1" value={grant[j.id] ?? ""} onChange={(e) => setGrant({ ...grant, [j.id]: e.target.value })} />
            <button disabled={busy} className="rounded border px-3 py-1 disabled:opacity-50">Grant</button>
          </form>
        </section>
      ))}

      <section className="uos-card p-5">
        <h2 className="font-display font-semibold">Audit trail (latest 50)</h2>
        <ul className="mt-2 space-y-1 font-mono text-xs">
          {data?.audit.length === 0 && <li className="text-muted-foreground">No changes yet.</li>}
          {data?.audit.map((a, i) => (
            <li key={`${a.at}-${i}`}>{a.at} {a.action} by {a.actor ?? "?"} {a.detail ? JSON.stringify(a.detail) : ""}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
