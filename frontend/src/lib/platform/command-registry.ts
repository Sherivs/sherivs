/**
 * Sherivs — global command registry (platform shell, ADR-010 / ADR-013).
 *
 * The command palette offers exactly what the member's resolved workspace navigation
 * offers, plus a short list of platform destinations every signed-in member has. It
 * holds no role list and no runtime route of its own: navigation commands are derived
 * from `WorkspaceNavSection`s that were already resolved from installed-runtime
 * contributions x the member's authorized capabilities.
 *
 * Laws:
 * - A command never grants access. Route guards, server functions and RLS still decide.
 * - A destination absent from the authorized navigation is absent from the palette.
 * - Ranking is deterministic and explainable (label prefix > word prefix > substring).
 */
import type { WorkspaceNavSection } from "@/lib/workspace-engine/navigation";

export type CommandKind = "navigate" | "preference";

export interface PaletteCommand {
  id: string;
  kind: CommandKind;
  label: string;
  /** Group heading shown in the palette. */
  group: string;
  /** Destination for navigate commands. */
  href?: string;
  /** Icon registry key (components never live in data). */
  iconKey: string;
  /** Extra search terms. */
  keywords: readonly string[];
  /** Installed runtime that contributed the command; "platform" for shell commands. */
  source: string;
}

/** Destinations every signed-in member has in the authenticated shell. */
export const PLATFORM_DESTINATIONS: readonly Omit<PaletteCommand, "group" | "source" | "kind">[] = [
  { id: "platform:notifications", label: "Notifications", href: "/notifications", iconKey: "notifications", keywords: ["alerts", "inbox"] },
  { id: "platform:messages", label: "Messages", href: "/messages", iconKey: "messages", keywords: ["chat", "conversation"] },
  { id: "platform:settings", label: "Account settings", href: "/settings", iconKey: "settings", keywords: ["profile", "preferences", "password"] },
];

export const PREFERENCE_COMMANDS: readonly PaletteCommand[] = [
  { id: "preference:theme-light", kind: "preference", label: "Use light theme", group: "Preferences", iconKey: "theme-light", keywords: ["appearance", "mode"], source: "platform" },
  { id: "preference:theme-dark", kind: "preference", label: "Use dark theme", group: "Preferences", iconKey: "theme-dark", keywords: ["appearance", "mode", "night"], source: "platform" },
  { id: "preference:theme-system", kind: "preference", label: "Match system theme", group: "Preferences", iconKey: "theme-system", keywords: ["appearance", "mode", "auto"], source: "platform" },
];

function normalizePath(path: string): string {
  const [pathname] = path.split(/[?#]/u);
  return pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
}

/** Navigation commands from the member's resolved workspace, deduplicated by destination. */
export function navigationCommands(sections: readonly WorkspaceNavSection[]): PaletteCommand[] {
  const seen = new Set<string>();
  const commands: PaletteCommand[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      const destination = normalizePath(item.url);
      if (seen.has(destination)) continue;
      seen.add(destination);
      commands.push({
        id: `nav:${item.runtimeRef}:${item.key}`,
        kind: "navigate",
        label: item.label,
        group: section.sectionLabel,
        href: item.url,
        iconKey: item.iconKey,
        keywords: [section.sectionLabel],
        source: item.runtimeRef,
      });
    }
  }
  return commands;
}

/** Every command the member may invoke: workspace navigation, platform destinations, preferences. */
export function buildPaletteCommands(sections: readonly WorkspaceNavSection[]): PaletteCommand[] {
  const navigation = navigationCommands(sections);
  const destinations = new Set(navigation.map((command) => normalizePath(command.href ?? "")));
  const platform = PLATFORM_DESTINATIONS.filter((command) => !destinations.has(normalizePath(command.href ?? ""))).map<PaletteCommand>(
    (command) => ({ ...command, kind: "navigate", group: "Platform", source: "platform" }),
  );
  return [...navigation, ...platform, ...PREFERENCE_COMMANDS];
}

function scoreCommand(command: PaletteCommand, query: string): number {
  const label = command.label.toLowerCase();
  if (label === query) return 400;
  if (label.startsWith(query)) return 300;
  if (label.split(/[\s/·-]+/u).some((word) => word.startsWith(query))) return 200;
  if (label.includes(query)) return 100;
  const haystack = [command.group, ...command.keywords].join(" ").toLowerCase();
  return haystack.includes(query) ? 50 : 0;
}

/** Filter and rank commands for a query; empty query returns commands in registry order. */
export function searchCommands(commands: readonly PaletteCommand[], query: string): PaletteCommand[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...commands];
  return commands
    .map((command, position) => ({ command, position, score: scoreCommand(command, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .map((entry) => entry.command);
}

/** Group commands by heading, preserving first-seen group order. */
export function groupCommands(commands: readonly PaletteCommand[]): { group: string; commands: PaletteCommand[] }[] {
  const groups = new Map<string, PaletteCommand[]>();
  for (const command of commands) {
    const list = groups.get(command.group) ?? [];
    list.push(command);
    groups.set(command.group, list);
  }
  return [...groups.entries()].map(([group, list]) => ({ group, commands: list }));
}

/**
 * The authorized destination a runtime's record search may open, found by the nav
 * item key the runtime declares. Returns null when the member's workspace does not
 * contain that destination — the search is then not offered at all.
 */
export function authorizedDestinationForKey(
  sections: readonly WorkspaceNavSection[],
  itemKeys: readonly string[],
): string | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (itemKeys.includes(item.key)) return normalizePath(item.url);
    }
  }
  return null;
}

export interface RecordSearchHit {
  /** Stable record reference passed to the authorized destination as `?id=`. */
  recordRef: string;
  label: string;
  hint?: string;
}

/**
 * A runtime-declared record search. The shell offers it only when the member's
 * resolved navigation contains one of `navItemKeys`, and opens hits at that
 * authorized destination. Row visibility is enforced by the data layer (RLS).
 */
export interface RecordSearchProvider {
  id: string;
  groupLabel: string;
  placeholderNoun: string;
  navItemKeys: readonly string[];
  minQueryLength: number;
  search: (term: string, scope: { tenantRef: string | null }) => Promise<RecordSearchHit[]>;
}

export function recordHitHref(destination: string, hit: RecordSearchHit): string {
  return `${destination}?id=${encodeURIComponent(hit.recordRef)}`;
}
