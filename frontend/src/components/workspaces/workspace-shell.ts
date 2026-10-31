import { CATALOG, type CatalogItem } from "@/lib/sherivs-ws/engine";
import type { WorkspaceManifest, WorkspaceManifestItem } from "./_contract-shim";

const SYSTEM_NAV_KEYS = new Set(["nav.home", "nav.settings", "nav.workspace_policies", "nav.my_pay"]);

export const WIDGET_REGISTRY: readonly CatalogItem[] = CATALOG.filter((item) => item.kind === "widget");

export function primarySections(manifest: WorkspaceManifest): WorkspaceManifestItem[] {
  return manifest.nav
    .filter((item) => !SYSTEM_NAV_KEYS.has(item.key) && item.key !== "nav.ai_tutor")
    .slice(0, 3);
}

export function additionalResponsibilities(
  manifest: WorkspaceManifest,
  primary: readonly WorkspaceManifestItem[] = primarySections(manifest),
): WorkspaceManifestItem[] {
  const primaryKeys = new Set(primary.map((item) => item.key));
  return manifest.nav.filter((item) => !SYSTEM_NAV_KEYS.has(item.key) && !primaryKeys.has(item.key));
}

export function permittedWidgetCatalog(manifest: WorkspaceManifest): WorkspaceManifestItem[] {
  const permitted = new Set([...manifest.widgets, ...manifest.available].map((item) => item.key));
  return WIDGET_REGISTRY.filter((item) => permitted.has(item.key)).map((item) => {
    const existing = [...manifest.widgets, ...manifest.available].find((candidate) => candidate.key === item.key);
    return existing ?? {
      key: item.key,
      kind: "widget",
      icon: item.icon,
      to: item.to,
      size: item.size,
      label: item.label[manifest.locale] || item.label.en,
      scope: [],
      via: [],
    };
  });
}

export function reorderWidgetKeys(keys: readonly string[], key: string, direction: -1 | 1): string[] {
  const from = keys.indexOf(key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= keys.length) return [...keys];
  const next = [...keys];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
