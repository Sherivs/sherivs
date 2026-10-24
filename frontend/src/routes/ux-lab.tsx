/** UX lab: renders the workspace engine for synthetic personas (no data, no sign-in). Only available in dev
 *  builds or when VITE_UX_LAB=1 (preview deployments); production builds show a 404-style message. */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PERSONAS, manifestFor, persona } from "@/lib/sherivs-ws/personas";
import type { Locale, ScopeFocus, WorkspacePrefs } from "@/lib/sherivs-ws/engine";
import { WorkspaceShell } from "@/components/sds/workspace-shell";

const ENABLED = import.meta.env.DEV || import.meta.env.VITE_UX_LAB === "1";
type Search = { p?: string; lang?: Locale; theme?: "light" | "dark"; edit?: string };
export const Route = createFileRoute("/ux-lab")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): Search => ({ p: typeof s.p === "string" ? s.p : undefined, lang: (["en", "ha", "yo", "ig", "pcm"] as const).find((l) => l === s.lang),
    theme: s.theme === "dark" ? "dark" : s.theme === "light" ? "light" : undefined }),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: UxLab,
});

function UxLab() {
  const search = Route.useSearch();
  const per = persona(search.p ?? "teacher-a");
  const [prefs, setPrefs] = useState<WorkspacePrefs>({ locale: search.lang ?? "en" });
  const [scope, setScope] = useState<ScopeFocus | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(search.theme ?? "light");
  if (!ENABLED) return <p style={{ padding: 24 }}>Not found.</p>;
  const m = manifestFor(per, prefs);
  return (
    <>
      <div style={{ background: "#111827", color: "#fff", padding: "6px 12px", fontSize: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>UX lab</strong>
        <label htmlFor="lab-p">Persona</label>
        <select id="lab-p" style={{ maxWidth: "70vw" }} value={per.id} onChange={(e) => { const u = new URL(location.href); u.searchParams.set("p", e.target.value); location.href = u.toString(); }}>
          {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.org.name}</option>)}
        </select>
        <span>families: {m.families.join(" + ")} · plan {per.org.plan} · {m.hiddenByPolicy.length} items hidden by policy</span>
      </div>
      <WorkspaceShell manifest={m} scope={scope} onScope={setScope} prefs={prefs} onPrefs={setPrefs} sample theme={theme} onTheme={setTheme} currentPath="/workspace"
        user={{ name: per.name, title: per.title, roles: per.roles.map((r) => r.name) }}
        inboxCounts={{ "i.approvals": m.inbox.some((i) => i.key === "i.approvals") ? 7 : 0, "i.messages": 3, "i.alerts": 1 }} />
    </>
  );
}
