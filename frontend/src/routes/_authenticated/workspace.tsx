/** The dynamic workspace (SHERIVS-UX1): computed per user on the server by public.workspace_manifest(). */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApp } from "@/contexts/app-context";
import { rpc } from "@/lib/scholar/rpc";
import { fromServer, scopeChips, type ServerManifest } from "@/lib/sherivs-ws/server-adapter";
import type { ScopeFocus, WorkspacePrefs } from "@/lib/sherivs-ws/engine";
import { WorkspaceShell, type LinkComp } from "@/components/sds/workspace-shell";

export const Route = createFileRoute("/_authenticated/workspace")({ ssr: false, component: WorkspacePage });
const RouterLink: LinkComp = ({ to, children, ...rest }) => <Link to={to as never} {...rest}>{children}</Link>;
const CACHE = "sherivs.ws.manifest.v2";
const SCOPE = "sherivs.ws.scope";

function WorkspacePage() {
  const { school, profile } = useApp();
  const qc = useQueryClient();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [scope, setScope] = useState<ScopeFocus | null>(null);
  useEffect(() => { try { setScope(JSON.parse(localStorage.getItem(SCOPE) ?? "null")); } catch { /* ignore */ } }, []);
  const onScope = (f: ScopeFocus | null) => { setScope(f); if (f) localStorage.setItem(SCOPE, JSON.stringify(f)); else localStorage.removeItem(SCOPE); };
  useEffect(() => { const v = localStorage.getItem("sherivs.theme"); setTheme(v === "dark" || (!v && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light"); }, []);
  const q = useQuery({
    queryKey: ["workspace-manifest", school?.id],
    enabled: !!school?.id,
    staleTime: 5 * 60_000,
    // Offline-first for slow networks: show the last manifest immediately, refresh in the background.
    initialData: () => { try { const c = JSON.parse(localStorage.getItem(CACHE) ?? "null"); return c?.org_id === school?.id ? (c as ServerManifest) : undefined; } catch { return undefined; } },
    queryFn: async () => { const m = await rpc<ServerManifest>("workspace_manifest", { p_org: school!.id }); localStorage.setItem(CACHE, JSON.stringify(m)); return m; },
  });
  if (!school || !q.data) return <div className="sds" style={{ padding: 16 }}><div className="sds-skel" style={{ width: "60%", height: 28 }} /><div className="sds-skel" style={{ marginTop: 16, height: 120 }} /></div>;
  const s = q.data;
  const prefs: WorkspacePrefs = { locale: s.locale, density: s.density === "compact" ? "compact" : "comfortable" };
  const save = async (p: WorkspacePrefs) => { await rpc("workspace_prefs_save", { p_org: school.id, p_prefs: p }); await qc.invalidateQueries({ queryKey: ["workspace-manifest", school.id] }); };
  return (
    <WorkspaceShell manifest={fromServer(s, { name: school.name, plan: school.subscription_tier ?? "starter" })} scope={scope} onScope={onScope} prefs={prefs} onPrefs={save} Link={RouterLink}
      user={{ name: profile?.full_name ?? "", title: s.families.join(" · "), roles: scopeChips(s) }}
      theme={theme} onTheme={(t) => { localStorage.setItem("sherivs.theme", t); setTheme(t); }} />
  );
}
