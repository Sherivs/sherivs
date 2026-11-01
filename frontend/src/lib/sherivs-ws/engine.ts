/**
 * Sherivs workspace engine (pure). The server function public.workspace_manifest() implements the
 * same rules in SQL and is the authority; this mirror powers previews, tests and offline rendering.
 * A workspace is computed, never stored: roles -> families -> default layout, filtered by effective
 * permissions (mandatory + admin-toggled optional + custom grants), the school's plan/modules, and
 * then personalised by the user only within the allowed set.
 */
import data from "./catalog.data";

export type ItemKind = "nav" | "widget" | "action" | "inbox";
export type Locale = "en" | "ha" | "yo" | "ig" | "pcm";
export interface CatalogItem {
  key: string;
  kind: ItemKind;
  icon: string;
  to: string;
  any: string[];
  all: string[];
  feature: string | null;
  size: string;
  families: string[];
  label: Record<Locale, string>;
  /** assigned-scope dimensions that unlock the item (campus, shift, section, level...); empty = not scope-bound */
  scopeDims: string[];
  /** school workspace policy that must be on; null = no policy gate */
  policy: string | null;
}
export interface WorkspacePolicy {
  key: string;
  default: boolean;
  label: string;
}
export interface FamilyLayout {
  family: string;
  templates: string[];
  priority: number;
  widgets: string[];
  actions: string[];
}
export interface Scope {
  type: string;
  ref: string | null;
  dims?: Record<string, string[]>;
}
export interface EffectivePermission {
  code: string;
  scopes: Scope[];
}
export interface WorkspacePrefs {
  order?: string[];
  hidden?: string[];
  added?: string[];
  actions?: string[];
  locale?: Locale;
  density?: "comfortable" | "compact";
}
export interface WorkspaceInput {
  org: {
    id: string;
    name: string;
    plan: string;
    features: string[];
    /** policies switched on; omitted = catalog defaults */ policies?: string[];
  };
  roles: { code: string; template: string; name?: string }[];
  permissions: EffectivePermission[];
  prefs?: WorkspacePrefs;
}
export interface ManifestItem {
  key: string;
  kind: ItemKind;
  icon: string;
  to: string;
  size: string;
  label: string;
  scope: string[];
  via: string[];
  scopeDims?: Record<string, string[]>;
}
export interface WorkspaceManifest {
  version: 1;
  org: WorkspaceInput["org"];
  families: string[];
  primaryFamily: string;
  locale: Locale;
  nav: ManifestItem[];
  bottomNav: ManifestItem[];
  widgets: ManifestItem[];
  available: ManifestItem[];
  actions: ManifestItem[];
  inbox: ManifestItem[];
  hiddenByPolicy: { key: string; reason: DenialReason }[];
  /** every scope dimension -> refs this user was assigned (drives the scope switcher) */
  scopeOptions: Record<string, string[]>;
  policies: string[];
  canPersonalise: boolean;
}

export type DenialReason = "permission" | "feature" | "family" | "policy" | "scope";
export const CATALOG = data.items as CatalogItem[];
export const POLICIES = data.policies as WorkspacePolicy[];
export const DEFAULT_POLICIES = POLICIES.filter((p) => p.default).map((p) => p.key);
export const FAMILIES = (data.families as FamilyLayout[])
  .slice()
  .sort((a, b) => a.priority - b.priority);
const BY_KEY = new Map(CATALOG.map((i) => [i.key, i]));
export const MAX_ACTIONS = 6;

export function familyForTemplate(template: string): FamilyLayout {
  return (
    FAMILIES.find((f) => f.templates.includes(template)) ??
    FAMILIES.find((f) => f.family === "staff")!
  );
}

function scopeLabel(s: Scope): string[] {
  if (s.dims && Object.keys(s.dims).length)
    return Object.entries(s.dims).map(([d, v]) => `${d}: ${v.join(", ")}`);
  return s.type === "org" ? [] : [`${s.type}${s.ref ? `: ${s.ref}` : ""}`];
}

/** Why an item is (not) available to this user; null = allowed. */
export function denialReason(
  item: CatalogItem,
  perms: Set<string>,
  features: Set<string>,
  families?: string[],
  policies?: Set<string>,
  dims?: Set<string>,
): DenialReason | null {
  if (item.families.length && families && !item.families.some((f) => families.includes(f)))
    return "family";
  if (item.any.length && !item.any.some((p) => perms.has(p))) return "permission";
  if (item.all.some((p) => !perms.has(p))) return "permission";
  if (item.feature && !features.has(item.feature)) return "feature";
  if (item.policy && policies && !policies.has(item.policy)) return "policy";
  if (item.scopeDims.length && dims && !item.scopeDims.some((d) => dims.has(d))) return "scope";
  return null;
}

export function computeWorkspace(input: WorkspaceInput): WorkspaceManifest {
  const perms = new Map(input.permissions.map((p) => [p.code, p]));
  const permSet = new Set(perms.keys());
  const features = new Set(input.org.features);
  const locale: Locale = input.prefs?.locale ?? "en";
  const policies = new Set(input.org.policies ?? DEFAULT_POLICIES);
  const scopeOptions: Record<string, string[]> = {};
  for (const p of input.permissions)
    for (const s of p.scopes)
      for (const [d, v] of Object.entries(s.dims ?? {}))
        scopeOptions[d] = [...new Set([...(scopeOptions[d] ?? []), ...v])].sort();
  const dims = new Set(Object.keys(scopeOptions));
  const fams = [
    ...new Map(
      input.roles.map((r) => familyForTemplate(r.template)).map((f) => [f.family, f]),
    ).values(),
  ].sort((a, b) => a.priority - b.priority);
  if (!fams.length) fams.push(familyForTemplate("__none__"));

  const hiddenByPolicy: WorkspaceManifest["hiddenByPolicy"] = [];
  const allowed = new Map<string, ManifestItem>();
  for (const item of CATALOG) {
    const reason = denialReason(
      item,
      permSet,
      features,
      fams.map((f) => f.family),
      policies,
      dims,
    );
    if (reason) {
      hiddenByPolicy.push({ key: item.key, reason });
      continue;
    }
    const via = [...item.any, ...item.all].filter((p) => permSet.has(p));
    const scope = [...new Set(via.flatMap((p) => perms.get(p)!.scopes.flatMap(scopeLabel)))];
    allowed.set(item.key, {
      key: item.key,
      kind: item.kind as ItemKind,
      icon: item.icon,
      to: item.to,
      size: item.size,
      label: item.label[locale] || item.label.en,
      scope,
      via: [...new Set(via)],
      ...(item.scopeDims.length
        ? {
            scopeDims: Object.fromEntries(
              item.scopeDims.filter((d) => dims.has(d)).map((d) => [d, scopeOptions[d]]),
            ),
          }
        : {}),
    });
  }
  const pick = (keys: string[]) =>
    [...new Set(keys)].map((k) => allowed.get(k)).filter((x): x is ManifestItem => !!x);
  const ofKind = (k: ItemKind) => [...allowed.values()].filter((i) => i.kind === k);

  const canPersonalise = policies.has("workspace.personalise") || permSet.has("settings.manage");
  const rawPrefs = input.prefs ?? {};
  const prefs: WorkspacePrefs = canPersonalise
    ? rawPrefs
    : { locale: rawPrefs.locale, density: rawPrefs.density };
  const hidden = new Set(prefs.hidden ?? []);
  const addable = (k: string) => allowed.get(k)?.kind === "widget";
  // scope-bound cards sit right after the primary family's lead card: they make this home theirs (campus, shift, section, level...)
  const scoped = CATALOG.filter(
    (i) => i.kind === "widget" && i.scopeDims.length && allowed.has(i.key),
  ).map((i) => i.key);
  const famWidgets = fams.flatMap((f) => f.widgets);
  let widgetKeys = [
    ...famWidgets.slice(0, 1),
    ...scoped,
    ...famWidgets.slice(1),
    ...(prefs.added ?? []).filter(addable),
  ].filter((k) => !hidden.has(k));
  if (prefs.order?.length) {
    const rank = new Map(prefs.order.map((k, i) => [k, i]));
    widgetKeys = widgetKeys
      .map((k, i) => ({ k, i }))
      .sort((a, b) => (rank.get(a.k) ?? 1e3 + a.i) - (rank.get(b.k) ?? 1e3 + b.i))
      .map((x) => x.k);
  }
  const widgets = pick(widgetKeys);
  const shown = new Set(widgets.map((w) => w.key));
  const available = ofKind("widget").filter((w) => !shown.has(w.key));
  const actionKeys = prefs.actions?.length ? prefs.actions : fams.flatMap((f) => f.actions);
  const actions = pick(actionKeys)
    .filter((a) => a.kind === "action")
    .slice(0, MAX_ACTIONS);
  const nav = ofKind("nav");
  return {
    version: 1,
    org: input.org,
    families: fams.map((f) => f.family),
    primaryFamily: fams[0].family,
    locale,
    nav,
    bottomNav: nav.slice(0, 4),
    widgets,
    available,
    actions,
    inbox: ofKind("inbox"),
    hiddenByPolicy,
    scopeOptions,
    policies: [...policies],
    canPersonalise,
  };
}

/** Server rule mirrored: a user may only save personalisation that references allowed items. */
export function sanitizePrefs(prefs: WorkspacePrefs, manifest: WorkspaceManifest): WorkspacePrefs {
  if (!manifest.canPersonalise) return { locale: prefs.locale, density: prefs.density };
  const ok = new Set([...manifest.widgets, ...manifest.available].map((w) => w.key));
  const okA = new Set(
    CATALOG.filter((i) => i.kind === "action")
      .map((i) => i.key)
      .filter((k) => !manifest.hiddenByPolicy.some((h) => h.key === k)),
  );
  return {
    ...prefs,
    order: prefs.order?.filter((k) => ok.has(k)),
    hidden: prefs.hidden?.filter((k) => ok.has(k)),
    added: prefs.added?.filter((k) => ok.has(k)),
    actions: prefs.actions?.filter((k) => okA.has(k)).slice(0, MAX_ACTIONS),
  };
}
export const catalogItem = (k: string) => BY_KEY.get(k);

/** Active scope focus (presentation only, the server already decided what is visible): when the user picks
 *  one of their scopes (e.g. campus: Ikeja), scope-bound cards for other dimensions step back and every
 *  workspace destination carries ?scope=dim:ref so its data opens filtered. */
export interface ScopeFocus {
  dim: string;
  ref: string;
}
export function focusScope(m: WorkspaceManifest, f: ScopeFocus | null): WorkspaceManifest {
  if (!f || !m.scopeOptions[f.dim]?.includes(f.ref)) return m;
  const tag = (to: string) =>
    `${to}${to.includes("?") ? "&" : "?"}scope=${encodeURIComponent(`${f.dim}:${f.ref}`)}`;
  const nav = m.nav.map((item) => ({ ...item, to: tag(item.to) }));
  const widgets = m.widgets
    .filter((w) => !w.scopeDims || f.dim in w.scopeDims)
    .map((w) => ({
      ...w,
      to: tag(w.to),
      scopeDims: w.scopeDims ? { [f.dim]: [f.ref] } : undefined,
    }));
  return { ...m, nav, widgets, actions: m.actions.map((a) => ({ ...a, to: tag(a.to) })) };
}
export const scopeFocusOptions = (m: WorkspaceManifest): ScopeFocus[] =>
  Object.entries(m.scopeOptions).flatMap(([dim, refs]) => refs.map((ref) => ({ dim, ref })));
