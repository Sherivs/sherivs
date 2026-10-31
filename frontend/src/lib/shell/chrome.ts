/**
 * Shell chrome composition: Home and AI are pinned; the three middle slots
 * are the role's most important sections (family widgets first). The drawer
 * lists every remaining role preference. Account items stay under the portrait.
 */

import { APP_SHELL_AI, APP_SHELL_HOME, appShellSectionPath } from "./paths";

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

const ACCOUNT_KEYS = new Set([
  "nav.home",
  "nav.settings",
  "nav.workspace_policies",
  "nav.my_pay",
]);

const AI_KEYS = new Set(["nav.ai_tutor", "w.ai_tutor", "w.ai_lesson_helper"]);

const BOTTOM_STOP = new Set(["to", "the", "a", "at", "of", "for", "and", "on"]);

export function isHomeNavKey(key: string): boolean {
  return key === "nav.home";
}

export function isAiNavKey(key: string): boolean {
  return AI_KEYS.has(key) || key.endsWith(".ai") || key.includes("ai_tutor") || key.includes("ai-assistant");
}

export function isNewsItem(key: string, label: string): boolean {
  const hay = `${key} ${label}`.toLowerCase();
  return hay.includes("announce") || /\bnews\b/.test(hay);
}

export function toShellNavItem(item: Catalogish): ShellNavItem {
  if (isHomeNavKey(item.key)) {
    return { ...item, catalogTo: item.to, href: APP_SHELL_HOME };
  }
  if (isAiNavKey(item.key)) {
    return { ...item, catalogTo: item.to, href: APP_SHELL_AI };
  }
  return { ...item, catalogTo: item.to, href: appShellSectionPath(item.key) };
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

function uniquePush(target: Catalogish[], seen: Set<string>, item: Catalogish) {
  if (seen.has(item.key)) return;
  seen.add(item.key);
  target.push(item);
}

/** Home | three role-priority sections | AI. */
export function composeBottomSlots(input: {
  widgets?: readonly Catalogish[];
  nav?: readonly Catalogish[];
}): readonly ShellBottomSlot[] {
  const picked: Catalogish[] = [];
  const seen = new Set<string>();
  for (const item of [...(input.widgets ?? []), ...(input.nav ?? [])]) {
    if (picked.length >= 3) break;
    if (!eligibleBottom(item)) continue;
    uniquePush(picked, seen, item);
  }
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
    { key: "nav.ai", label: "AI", icon: "sparkles", href: APP_SHELL_AI, kind: "ai" },
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
    if (isHomeNavKey(item.key) || ACCOUNT_KEYS.has(item.key) || isAiNavKey(item.key) || seen.has(item.key)) {
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
}): {
  widgets: ShellNavItem[];
  actions: ShellNavItem[];
  news: ShellNavItem[];
  cards: ShellNavItem[];
} {
  const widgets = (input.widgets ?? [])
    .filter((item) => !isNewsItem(item.key, item.label) && !isAiNavKey(item.key))
    .map(toShellNavItem);
  const actions = (input.actions ?? []).filter((item) => !isAiNavKey(item.key)).map(toShellNavItem);
  const news: ShellNavItem[] = [];
  const newsSeen = new Set<string>();
  for (const item of [...(input.widgets ?? []), ...(input.inbox ?? []), ...(input.nav ?? [])]) {
    if (!isNewsItem(item.key, item.label) || newsSeen.has(item.key)) continue;
    newsSeen.add(item.key);
    news.push(toShellNavItem(item));
  }
  const shown = new Set([...widgets, ...actions, ...news].map((item) => item.key));
  const cards: ShellNavItem[] = [];
  const cardSeen = new Set<string>();
  for (const item of [...(input.nav ?? []), ...(input.inbox ?? [])]) {
    if (
      shown.has(item.key) ||
      cardSeen.has(item.key) ||
      isHomeNavKey(item.key) ||
      ACCOUNT_KEYS.has(item.key) ||
      isAiNavKey(item.key)
    ) {
      continue;
    }
    cardSeen.add(item.key);
    cards.push(toShellNavItem(item));
  }
  return { widgets, actions, news, cards };
}

/** @deprecated Prefer composeSidePanel — kept for tests that pass a nav list. */
export function sidePanelNav(items: readonly ShellNavItem[]): readonly ShellNavItem[] {
  return items.filter((item) => !ACCOUNT_KEYS.has(item.key) && !isHomeNavKey(item.key));
}
