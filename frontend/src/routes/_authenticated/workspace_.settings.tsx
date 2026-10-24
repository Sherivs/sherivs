/** Workspace rules (SHERIVS-UX2): the school decides which optional modules and workspace policies apply.
 *  Policies can only hide items; permissions, scopes and RLS still decide access. Needs settings.manage
 *  (checked by workspace_policy_list / workspace_policy_set / workspace_feature_set on the server). */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApp } from "@/contexts/app-context";
import { rpc } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/workspace_/settings")({ ssr: false, component: WorkspaceRules });
type Row = { key: string; label?: string; enabled: boolean; default?: boolean };
const MODULE_LABEL: Record<string, string> = {
  cbt: "Computer-based tests (CBT)", wallet: "School wallet", payroll: "HR & payroll", library: "Library",
  hostel: "Hostel / boarding", health: "Sick bay", transport: "School buses",
};

function WorkspaceRules() {
  const { school } = useApp();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["workspace-policies", school?.id], enabled: !!school?.id,
    queryFn: () => rpc<{ policies: Row[]; modules: Row[] }>("workspace_policy_list", { p_org: school!.id }) });
  const toggle = async (kind: "policy" | "module", key: string, on: boolean) => {
    setBusy(key); setErr(null);
    try {
      if (kind === "policy") await rpc("workspace_policy_set", { p_org: school!.id, p_policy: key, p_enabled: on });
      else await rpc("workspace_feature_set", { p_org: school!.id, p_feature: key, p_enabled: on });
      await Promise.all([qc.invalidateQueries({ queryKey: ["workspace-policies", school!.id] }), qc.invalidateQueries({ queryKey: ["workspace-manifest", school!.id] })]);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const list = (title: string, hint: string, kind: "policy" | "module", rows: Row[]) => (
    <section className="sds-section" aria-labelledby={`h-${kind}`}>
      <h2 id={`h-${kind}`} className="sds-h2">{title}</h2>
      <p className="sds-sub">{hint}</p>
      <ul className="sds-list" style={{ marginTop: 8 }}>
        {rows.map((r) => (
          <li key={r.key} style={{ minHeight: 56, alignItems: "center" }}>
            <label htmlFor={`t-${r.key}`} style={{ flex: 1 }}>{kind === "module" ? MODULE_LABEL[r.key] ?? r.key : r.label}</label>
            <input id={`t-${r.key}`} type="checkbox" role="switch" aria-checked={r.enabled} checked={r.enabled} disabled={busy === r.key}
              style={{ width: 28, height: 28 }} onChange={(e) => toggle(kind, r.key, e.target.checked)} />
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="sds sds-app" style={{ display: "block" }}>
      <main id="sds-main" className="sds-main" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
        <Link to="/workspace" className="sds-btn">← Back</Link>
        <h1 className="sds-h1" style={{ marginTop: 12 }}>Workspace rules</h1>
        <p className="sds-sub">Everyone's home screen is built from their roles, the classes, campuses, shifts and sections you assigned them, and these rules.</p>
        {err && <div className="sds-banner" role="alert">{err}</div>}
        {q.isError && <div className="sds-banner" role="alert">You need the “school settings” permission to change these rules.</div>}
        {q.isLoading && <div className="sds-skel" style={{ height: 160, marginTop: 16 }} />}
        {q.data && <>
          {list("Modules", "Turn off modules your school does not run. Their menus and cards disappear for everyone.", "module", q.data.modules)}
          {list("Policies", "Decide what staff, parents and students can see and do in the app.", "policy", q.data.policies)}
        </>}
      </main>
    </div>
  );
}
