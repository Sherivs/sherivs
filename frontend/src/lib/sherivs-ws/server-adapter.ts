/** Maps the server manifest (public.workspace_manifest) onto the UI manifest. The server decides WHAT is
 *  visible; the client only adds presentation (icons, localised labels). Unknown keys are dropped. */
import { catalogItem, type Locale, type ManifestItem, type WorkspaceManifest, type WorkspacePrefs } from "./engine";
export interface ServerManifest {
  version: 1 | 2; org_id: string; families: string[]; primary_family: string; features: string[]; locale: Locale; density: string;
  scopes: { role: string; type: string; ref: string | null; sets: Record<string, string[]>[] }[];
  nav: { key: string }[]; widgets: { key: string; scope?: Record<string, string[]> }[];
  /** v2 (SHERIVS-UX2) */ policies?: string[]; can_personalise?: boolean; scope_options?: Record<string, string[]>; available: string[]; actions: { key: string }[]; inbox: { key: string }[]; hidden_by_policy: number;
}
export function fromServer(s: ServerManifest, org: { name: string; plan: string }, localeOverride?: Locale): WorkspaceManifest {
  const L = localeOverride ?? s.locale ?? "en";
  const item = (k: string): ManifestItem | null => {
    const c = catalogItem(k); if (!c) return null;
    return { key: k, kind: c.kind, icon: c.icon, to: c.to, size: c.size, label: c.label[L] || c.label.en, scope: [], via: [] };
  };
  const list = (xs: { key: string }[] | string[]) => (xs as (string | { key: string })[]).map((x) => item(typeof x === "string" ? x : x.key)).filter((x): x is ManifestItem => !!x);
  const nav = list(s.nav);
  const widgets = s.widgets.map((w) => { const i = item(w.key); if (!i) return null;
    return w.scope && Object.keys(w.scope).length ? { ...i, scopeDims: w.scope } : i; }).filter((x): x is ManifestItem => !!x);
  const home = item("nav.home"); const navSorted = home ? [home, ...nav.filter((n) => n.key !== "nav.home")] : nav;
  return { version: 1, org: { id: s.org_id, name: org.name, plan: org.plan, features: s.features }, families: s.families, primaryFamily: s.primary_family, locale: L,
    nav: navSorted, bottomNav: navSorted.slice(0, 4), widgets, available: list(s.available), actions: list(s.actions), inbox: list(s.inbox), hiddenByPolicy: [],
    scopeOptions: s.scope_options ?? {}, policies: s.policies ?? [], canPersonalise: s.can_personalise ?? true };
}
export function scopeChips(s: ServerManifest): string[] {
  return s.scopes.flatMap((r) => r.sets.length ? r.sets.map((d) => Object.entries(d).map(([k, v]) => `${k}: ${v.join(", ")}`).join(" · ")) : r.type === "org" ? [] : [`${r.type}: ${r.ref ?? ""}`]);
}
export const prefsFromServer = (s: ServerManifest): WorkspacePrefs => ({ locale: s.locale, density: s.density === "compact" ? "compact" : "comfortable" });
