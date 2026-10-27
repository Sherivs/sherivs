/**
 * Shell chrome composition: Home and AI are pinned; three middle slots
 * are filled from the role's nav. Account items stay in the side panel.
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

const ACCOUNT_KEYS = new Set([
  "nav.home",
  "nav.settings",
  "nav.workspace_policies",
  "nav.my_pay",
]);

const AI_KEYS = new Set(["nav.ai_tutor", "w.ai_tutor", "w.ai_lesson_helper"]);

export function isHomeNavKey(key: string): boolean {
  return key === "nav.home";
}

export function isAiNavKey(key: string): boolean {
  return AI_KEYS.has(key) || key.endsWith(".ai") || key.includes("ai_tutor") || key.includes("ai-assistant");
}

export function toShellNavItem(item: {
  key: string;
  label: string;
  icon: string;
  to: string;
}): ShellNavItem {
  if (isHomeNavKey(item.key)) {
    return { ...item, catalogTo: item.to, href: APP_SHELL_HOME };
  }
  if (isAiNavKey(item.key)) {
    return { ...item, catalogTo: item.to, href: APP_SHELL_AI };
  }
  return { ...item, catalogTo: item.to, href: appShellSectionPath(item.key) };
}

export function sidePanelNav(items: readonly ShellNavItem[]): readonly ShellNavItem[] {
  return items.filter((item) => !ACCOUNT_KEYS.has(item.key) && !isHomeNavKey(item.key));
}

export function composeBottomSlots(items: readonly ShellNavItem[]): readonly ShellBottomSlot[] {
  const roleSlots: ShellBottomSlot[] = items
    .filter((item) => !isHomeNavKey(item.key) && !isAiNavKey(item.key) && !ACCOUNT_KEYS.has(item.key))
    .slice(0, 3)
    .map((item) => ({
      key: item.key,
      label: item.label,
      icon: item.icon,
      href: item.href,
      kind: "role" as const,
    }));
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
