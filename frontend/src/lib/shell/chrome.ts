/**
 * Shell chrome composition: Home and Assistant are pinned; the three middle slots
 * are the role's most important sections (family widgets first). The drawer
 * lists every remaining role preference. Account items stay under the portrait.
 */

import { catalogItem } from "@/lib/sherivs-ws/engine";
import { APP_SHELL_AI, APP_SHELL_HOME, appShellSectionPath } from "./paths";
import { rankByUsage, type ShellUsageCounts } from "./usage";

export interface ShellNavItem {
  key: string;
  label: string;
  icon: string;
  /** Catalog provenance route (never opened as a hardcoded portal). */
  catalogTo: string;
  href: string;
}

export interface ShellBottomSlot {
  key: string;
  label: string;
  icon: string;
  href: string | null;
  kind: "home" | "role" | "empty" | "ai";
}

export interface Catalogish {
  key: string;
  label: string;
  icon: string;
  to: string;
}

/**
 * Catalogue provenance route of an item. Once `workspace_item_catalog.route` holds shell routes
 * (`/home/s/<key>`, migration 20261117001200), the legacy destination still decides which cards
 * are duplicates of each other and which notification links an item accepts, so it is read from the
 * catalogue mirror. Items whose route is not a shell route are returned unchanged.
 */
export function catalogueProvenance(item: Pick<Catalogish, "key" | "to">): string {
  const to = item.to.trim();
  const cut = to.search(/[?#]/);
  const path = cut === -1 ? to : to.slice(0, cut);
  if (path !== APP_SHELL_HOME && !path.startsWith(`${APP_SHELL_HOME}/`)) return item.to;
  const legacy = catalogItem(item.key)?.to;
  return legacy ? `${legacy}${cut === -1 ? "" : to.slice(cut)}` : item.to;
}

export function uniqueCatalogItems<T extends Catalogish>(items: readonly T[]): T[] {
  const seenKeys = new Set<string>();
  const seenDestinations = new Set<string>();
  return items.filter((item) => {
    const path = catalogueProvenance(item).trim().split(/[?#]/, 1)[0] ?? "";
    const destination = path.replace(/\/+$/, "") || (path ? "/" : "");
    if (seenKeys.has(item.key) || (destination && seenDestinations.has(destination))) return false;
    seenKeys.add(item.key);
    if (destination) seenDestinations.add(destination);
    return true;
  });
}

const ACCOUNT_KEYS = new Set(["nav.home", "nav.settings", "nav.workspace_policies", "nav.my_pay"]);

const AI_KEYS = new Set(["nav.ai_tutor", "w.ai_tutor", "w.ai_lesson_helper"]);

const BOTTOM_STOP = new Set(["to", "the", "a", "at", "of", "for", "and", "on"]);

export function isHomeNavKey(key: string): boolean {
  return key === "nav.home";
}

export function homeHrefForScope(scope: { dim: string; ref: string } | null): string {
  return scope
    ? `${APP_SHELL_HOME}?scope=${encodeURIComponent(`${scope.dim}:${scope.ref}`)}`
    : APP_SHELL_HOME;
}

export function isAiNavKey(key: string): boolean {
  return (
    AI_KEYS.has(key) ||
    key.endsWith(".ai") ||
    key.includes("ai_tutor") ||
    key.includes("ai-assistant")
  );
}

export function isNewsItem(key: string, label: string): boolean {
  const hay = `${key} ${label}`.toLowerCase();
  return hay.includes("announce") || /\bnews\b/.test(hay);
}

export function toShellNavItem(item: Catalogish): ShellNavItem {
  const query = item.to.includes("?")
    ? `?${new URLSearchParams(item.to.slice(item.to.indexOf("?") + 1)).toString()}`
    : "";
  const catalogTo = catalogueProvenance(item);
  if (isHomeNavKey(item.key)) {
    return { ...item, catalogTo, href: `${APP_SHELL_HOME}${query}` };
  }
  if (isAiNavKey(item.key)) {
    return { ...item, catalogTo, href: `${APP_SHELL_AI}${query}` };
  }
  return { ...item, catalogTo, href: `${appShellSectionPath(item.key)}${query}` };
}

export function compactBottomLabel(label: string): string {
  const cleaned = label.replace(/^My\s+/i, "").trim();
  if (cleaned.length <= 12) return cleaned;
  const words = cleaned.split(/\s+/).filter((word) => !BOTTOM_STOP.has(word.toLowerCase()));
  const pick = words[0] ?? cleaned;
  return pick.length <= 12 ? pick : `${pick.slice(0, 11)}…`;
}

function eligibleBottom(item: Catalogish): boolean {
  return (
    !isHomeNavKey(item.key) &&
    !isAiNavKey(item.key) &&
    !ACCOUNT_KEYS.has(item.key) &&
    !isNewsItem(item.key, item.label)
  );
}

/** Home | three role-priority sections | Assistant. */
export function composeBottomSlots(input: {
  widgets?: readonly Catalogish[];
  nav?: readonly Catalogish[];
  actions?: readonly Catalogish[];
  inbox?: readonly Catalogish[];
}): readonly ShellBottomSlot[] {
  const picked = uniqueCatalogItems(
    [
      ...(input.widgets ?? []),
      ...(input.nav ?? []),
      ...(input.actions ?? []),
      ...(input.inbox ?? []),
    ].filter(eligibleBottom),
  ).slice(0, 3);
  const roleSlots: ShellBottomSlot[] = picked.map((item) => {
    const nav = toShellNavItem(item);
    return {
      key: nav.key,
      label: compactBottomLabel(nav.label),
      icon: nav.icon,
      href: nav.href,
      kind: "role" as const,
    };
  });
  while (roleSlots.length < 3) {
    roleSlots.push({
      key: `empty-${roleSlots.length}`,
      label: "",
      icon: "",
      href: null,
      kind: "empty",
    });
  }
  return [
    { key: "nav.home", label: "Home", icon: "home", href: APP_SHELL_HOME, kind: "home" },
    ...roleSlots,
    { key: "nav.ai", label: "Assistant", icon: "sparkles", href: APP_SHELL_AI, kind: "ai" },
  ];
}

/** Every role preference the person may open, for the glass drawer. */
export function composeSidePanel(input: {
  nav?: readonly Catalogish[];
  widgets?: readonly Catalogish[];
  actions?: readonly Catalogish[];
  inbox?: readonly Catalogish[];
}): readonly ShellNavItem[] {
  const seen = new Set<string>();
  const out: ShellNavItem[] = [];
  for (const item of [
    ...(input.nav ?? []),
    ...(input.widgets ?? []),
    ...(input.actions ?? []),
    ...(input.inbox ?? []),
  ]) {
    if (
      isHomeNavKey(item.key) ||
      ACCOUNT_KEYS.has(item.key) ||
      isAiNavKey(item.key) ||
      seen.has(item.key)
    ) {
      continue;
    }
    seen.add(item.key);
    out.push(toShellNavItem(item));
  }
  return out;
}

export function composeHomeSections(input: {
  widgets?: readonly Catalogish[];
  actions?: readonly Catalogish[];
  inbox?: readonly Catalogish[];
  nav?: readonly Catalogish[];
  available?: readonly Catalogish[];
  usage?: ShellUsageCounts;
}): {
  widgets: ShellNavItem[];
  actions: ShellNavItem[];
  news: ShellNavItem[];
  cards: ShellNavItem[];
} {
  const widgets = (input.widgets ?? [])
    .filter((item) => !isNewsItem(item.key, item.label) && !isAiNavKey(item.key))
    .map(toShellNavItem);
  const news: ShellNavItem[] = [];
  const newsSeen = new Set<string>();
  for (const item of [...(input.widgets ?? []), ...(input.inbox ?? []), ...(input.nav ?? [])]) {
    if (!isNewsItem(item.key, item.label) || newsSeen.has(item.key)) continue;
    newsSeen.add(item.key);
    news.push(toShellNavItem(item));
  }
  const shown = [...(input.widgets ?? []), ...news];
  const shownKeys = new Set(shown.map((item) => item.key));
  const candidates = rankByUsage(
    uniqueCatalogItems([
      ...(input.actions ?? []),
      ...(input.nav ?? []),
      ...(input.inbox ?? []),
      ...(input.available ?? []),
    ]).filter((item) => {
      return (
        !shownKeys.has(item.key) &&
        !isHomeNavKey(item.key) &&
        !ACCOUNT_KEYS.has(item.key) &&
        !isAiNavKey(item.key) &&
        !isNewsItem(item.key, item.label)
      );
    }),
    input.usage ?? {},
  );
  return {
    widgets,
    actions: candidates.slice(0, 4).map(toShellNavItem),
    news,
    cards: candidates.slice(4, 12).map(toShellNavItem),
  };
}

/** @deprecated Prefer composeSidePanel — kept for tests that pass a nav list. */
export function sidePanelNav(items: readonly ShellNavItem[]): readonly ShellNavItem[] {
  return items.filter((item) => !ACCOUNT_KEYS.has(item.key) && !isHomeNavKey(item.key));
}
