import { CATALOG, type CatalogItem } from "@/lib/sherivs-ws/engine";
import { isAiNavKey, isHomeNavKey, isNewsItem, uniqueCatalogItems } from "@/lib/shell/chrome";
import type { WorkspaceManifest, WorkspaceManifestItem } from "./_contract-shim";

const SYSTEM_NAV_KEYS = new Set([
  "nav.home",
  "nav.settings",
  "nav.workspace_policies",
  "nav.my_pay",
]);

export const WIDGET_REGISTRY: readonly CatalogItem[] = CATALOG.filter(
  (item) => item.kind === "widget",
);

export function visibleWorkspaceWidgets(
  manifest: WorkspaceManifest,
  hiddenKeys: readonly string[] = [],
): WorkspaceManifestItem[] {
  const hidden = new Set(hiddenKeys);
  const widgets = uniqueCatalogItems(manifest.widgets.filter((item) => !hidden.has(item.key)));
  if (widgets.length >= 3) return widgets;

  for (const item of manifest.available) {
    if (item.kind !== "widget" || hidden.has(item.key) || widgets.length >= 3) continue;
    const next = uniqueCatalogItems([...widgets, item]);
    if (next.length > widgets.length) widgets.push(item);
  }
  return widgets;
}

export function primarySections(manifest: WorkspaceManifest): WorkspaceManifestItem[] {
  return uniqueCatalogItems(
    [...manifest.widgets, ...manifest.nav, ...manifest.actions, ...manifest.inbox].filter(
      (item) =>
        !SYSTEM_NAV_KEYS.has(item.key) &&
        !isHomeNavKey(item.key) &&
        !isAiNavKey(item.key) &&
        !isNewsItem(item.key, item.label),
    ),
  ).slice(0, 3);
}

export function additionalResponsibilities(
  manifest: WorkspaceManifest,
  primary: readonly WorkspaceManifestItem[] = primarySections(manifest),
): WorkspaceManifestItem[] {
  const primaryKeys = new Set(primary.map((item) => item.key));
  const candidates = [
    ...manifest.nav,
    ...manifest.widgets,
    ...manifest.actions,
    ...manifest.inbox,
  ].filter((item) => !SYSTEM_NAV_KEYS.has(item.key) && !primaryKeys.has(item.key));
  return uniqueCatalogItems([...primary, ...candidates]).slice(primary.length);
}

export function workspaceResponsibilityIcon(item: WorkspaceManifestItem): string {
  const icon = item.icon?.trim();
  if (icon) return icon;
  return (
    CATALOG.find((catalogItem) => catalogItem.key === item.key)?.icon ??
    CATALOG.find((catalogItem) => catalogItem.to === item.to)?.icon ??
    "dashboard"
  );
}

export function permittedWidgetCatalog(manifest: WorkspaceManifest): WorkspaceManifestItem[] {
  const permitted = new Set([...manifest.widgets, ...manifest.available].map((item) => item.key));
  return WIDGET_REGISTRY.filter((item) => permitted.has(item.key)).map((item) => {
    const existing = [...manifest.widgets, ...manifest.available].find(
      (candidate) => candidate.key === item.key,
    );
    return (
      existing ?? {
        key: item.key,
        kind: "widget",
        icon: item.icon,
        to: item.to,
        size: item.size,
        label: item.label[manifest.locale] || item.label.en,
        scope: [],
        via: [],
      }
    );
  });
}

export function reorderWidgetKeys(
  keys: readonly string[],
  key: string,
  direction: -1 | 1,
): string[] {
  const from = keys.indexOf(key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= keys.length) return [...keys];
  const next = [...keys];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
