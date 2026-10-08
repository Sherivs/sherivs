/**
 * Global ⌘K / Ctrl+K command palette (platform shell).
 *
 * Commands are derived from the member's resolved workspace navigation (installed
 * runtime contributions x authorized capabilities) plus platform destinations and
 * preferences — see `@/lib/platform/command-registry`. The palette holds no role list
 * and no runtime route. Record search is offered only when a runtime's search
 * destination is part of the member's authorized navigation.
 *
 * A command never grants access: route guards, server functions and RLS still decide.
 *
 * Keyboard: ↑/↓ move, Enter run, Esc close (combobox semantics from cmdk, focus trap
 * and restore from Radix Dialog).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";
import { Clock, CornerDownLeft, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { navIconFor } from "@/components/shell/nav-icons";
import { useApp } from "@/contexts/app-context";
import {
  authorizedDestinationForKey,
  buildPaletteCommands,
  groupCommands,
  recordHitHref,
  searchCommands,
  type PaletteCommand,
  type RecordSearchHit,
  type RecordSearchProvider,
} from "@/lib/platform/command-registry";
import { INSTALLED_RECORD_SEARCH_PROVIDERS } from "@/lib/runtime/installed-record-search";
import { setThemeMode, type ThemeMode } from "@/lib/theme";
import type { WorkspaceNavSection } from "@/lib/workspace-engine/navigation";

export const COMMAND_CENTER_EVENT = "open-command-center";

const GROUP_CLASS =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-sx-muted";

const RECENT_KEY = "uos:cc:recent";
const RECENT_MAX = 5;

function pushRecent(path: string, label: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const previous = Array.isArray(parsed) ? (parsed as Array<{ path: string; label: string }>) : [];
    const next = [{ path, label }, ...previous.filter((entry) => entry.path !== path)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: recents are a convenience, not state */
  }
}

function readRecentPaths(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (typeof entry === "object" && entry && "path" in entry ? String(entry.path) : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Record a pathname in the recent-pages ring buffer. */
export function useTrackRecentPage(pathname: string, label: string) {
  useEffect(() => {
    if (!pathname || pathname === "/") return;
    pushRecent(pathname, label);
  }, [pathname, label]);
}

type RecordResults = { provider: RecordSearchProvider; destination: string; hits: RecordSearchHit[] };

function useRecordSearch(query: string, sections: readonly WorkspaceNavSection[], tenantRef: string | null, open: boolean) {
  const available = useMemo(
    () =>
      INSTALLED_RECORD_SEARCH_PROVIDERS.flatMap((provider) => {
        const destination = authorizedDestinationForKey(sections, provider.navItemKeys);
        return destination ? [{ provider, destination }] : [];
      }),
    [sections],
  );
  const [results, setResults] = useState<RecordResults[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = query.trim();
    const eligible = available.filter(({ provider }) => term.length >= provider.minQueryLength);
    if (!open || eligible.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const settled = await Promise.allSettled(
        eligible.map(async ({ provider, destination }) => ({
          provider,
          destination,
          hits: await provider.search(term, { tenantRef }),
        })),
      );
      if (cancelled) return;
      setResults(
        settled.flatMap((outcome) => (outcome.status === "fulfilled" && outcome.value.hits.length > 0 ? [outcome.value] : [])),
      );
      setSearching(false);
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, available, tenantRef, open]);

  return { available, results, searching };
}

export function CommandPalette({
  open,
  onClose,
  sections,
}: {
  open: boolean;
  onClose: () => void;
  sections: readonly WorkspaceNavSection[];
}) {
  const navigate = useNavigate();
  const { profile } = useApp();
  const [query, setQuery] = useState("");
  const [recentPaths, setRecentPaths] = useState<string[]>([]);

  const commands = useMemo(() => buildPaletteCommands(sections), [sections]);
  const { available, results, searching } = useRecordSearch(query, sections, profile?.school_id ?? null, open);

  useEffect(() => {
    if (open) {
      setQuery("");
      setRecentPaths(readRecentPaths());
    }
  }, [open]);

  const run = useCallback(
    (command: PaletteCommand) => {
      onClose();
      if (command.kind === "preference") {
        const mode = command.id.replace("preference:theme-", "") as ThemeMode;
        setThemeMode(mode);
        return;
      }
      if (command.href) navigate({ to: command.href });
    },
    [navigate, onClose],
  );

  const recentCommands = useMemo(() => {
    if (query.trim()) return [];
    const byHref = new Map(commands.filter((command) => command.href).map((command) => [command.href, command]));
    // Only recents that are still authorized destinations are shown.
    return recentPaths.flatMap((path) => {
      const command = byHref.get(path);
      return command ? [command] : [];
    });
  }, [commands, recentPaths, query]);

  const grouped = useMemo(() => groupCommands(searchCommands(commands, query)), [commands, query]);
  const searchNouns = available.map(({ provider }) => provider.placeholderNoun);
  const placeholder = searchNouns.length > 0 ? `Go to a page, run a command or find ${searchNouns.join(", ")}…` : "Go to a page or run a command…";
  const hasResults = grouped.length > 0 || results.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        data-sx=""
        className="top-[12vh] max-w-[min(42rem,calc(100vw-2rem))] translate-y-0 gap-0 overflow-hidden border-sx-line-strong bg-sx-surface-1 p-0 shadow-[0_32px_80px_-32px_rgb(7_9_12/0.5)] sm:rounded-[6px] [&>button:last-child]:hidden"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Lists only the pages and commands available in your workspace.
        </DialogDescription>
        <CommandPrimitive shouldFilter={false} loop label="Command palette" className="flex flex-col">
          <div className="flex items-center gap-3 border-b border-sx-line px-4">
            <Search aria-hidden="true" className="size-4 shrink-0 text-sx-muted" />
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder={placeholder}
              className="h-14 w-full bg-transparent text-base text-sx-strong outline-none placeholder:text-sx-muted"
            />
            {searching && <Loader2 aria-label="Searching records" className="size-4 shrink-0 animate-spin text-sx-muted" />}
            <kbd className="sx-label hidden shrink-0 border border-sx-line px-1.5 py-0.5 text-[0.625rem] sm:block">Esc</kbd>
          </div>

          <CommandPrimitive.List className="max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain p-2">
            {!hasResults && !searching && (
              <p className="px-3 py-10 text-center text-sm text-sx-muted">
                Nothing in your workspace matches “{query.trim()}”.
              </p>
            )}

            {recentCommands.length > 0 && (
              <CommandPrimitive.Group heading="Recent" className={GROUP_CLASS}>
                {recentCommands.map((command) => (
                  <PaletteItem key={`recent-${command.id}`} value={`recent-${command.id}`} command={command} recent onRun={run} />
                ))}
              </CommandPrimitive.Group>
            )}

            {grouped.map(({ group, commands: groupCommandsList }) => (
              <CommandPrimitive.Group key={group} heading={group} className={GROUP_CLASS}>
                {groupCommandsList.map((command) => (
                  <PaletteItem key={command.id} value={command.id} command={command} onRun={run} />
                ))}
              </CommandPrimitive.Group>
            ))}

            {results.map(({ provider, destination, hits }) => (
              <CommandPrimitive.Group key={provider.id} heading={provider.groupLabel} className={GROUP_CLASS}>
                {hits.map((hit) => (
                  <CommandPrimitive.Item
                    key={`${provider.id}-${hit.recordRef}`}
                    value={`${provider.id}-${hit.recordRef}`}
                    onSelect={() => {
                      onClose();
                      navigate({ to: recordHitHref(destination, hit) });
                    }}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[4px] px-3 py-2 text-sx-text data-[selected=true]:bg-sx-surface-2 data-[selected=true]:text-sx-strong"
                  >
                    <span aria-hidden="true" className="sx-data grid size-7 shrink-0 place-items-center border border-sx-line text-[0.6875rem]">
                      {hit.label
                        .split(/\s+/u)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase() ?? "")
                        .join("")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{hit.label}</span>
                      {hit.hint && <span className="block truncate text-xs text-sx-muted">{hit.hint}</span>}
                    </span>
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            ))}
          </CommandPrimitive.List>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-sx-line bg-sx-surface-2 px-4 py-2 text-[0.6875rem] text-sx-muted">
            <span>↑↓ move</span>
            <span>↵ open</span>
            <span>Esc close</span>
            <span className="ml-auto">Only what your role can open is listed</span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}

function PaletteItem({
  command,
  value,
  recent = false,
  onRun,
}: {
  command: PaletteCommand;
  value: string;
  recent?: boolean;
  onRun: (command: PaletteCommand) => void;
}) {
  const Icon = recent ? Clock : navIconFor(command.iconKey);
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={() => onRun(command)}
      className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-[4px] px-3 py-2 text-sx-text data-[selected=true]:bg-sx-surface-2 data-[selected=true]:text-sx-strong"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-sx-muted group-data-[selected=true]:text-sx-signal" />
      <span className="min-w-0 flex-1 truncate text-sm">{command.label}</span>
      {recent && <span className="sx-caption hidden sm:inline">{command.group}</span>}
      <CornerDownLeft aria-hidden="true" className="size-3.5 shrink-0 opacity-0 group-data-[selected=true]:opacity-60" />
    </CommandPrimitive.Item>
  );
}

/** Backwards-compatible alias for the previous component name. */
export const CommandCenter = CommandPalette;

/**
 * Mount + shortcut wiring for the authenticated layout. Owns the open state, listens
 * for ⌘K / Ctrl+K and the `open-command-center` window event, and records visited
 * routes for the Recent group.
 */
export function CommandCenterMount({ sections }: { sections: readonly WorkspaceNavSection[] }) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  useEffect(() => {
    if (!pathname || pathname === "/") return;
    const segments = pathname.split("/").filter(Boolean);
    const label = segments
      .slice(-2)
      .map((segment) => segment.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()))
      .join(" · ");
    pushRecent(pathname, label || pathname);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(COMMAND_CENTER_EVENT, onEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(COMMAND_CENTER_EVENT, onEvent);
    };
  }, []);

  return <CommandPalette open={open} onClose={() => setOpen(false)} sections={sections} />;
}

/** Fire from anywhere in the app to open the command palette. */
export function openCommandCenter() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COMMAND_CENTER_EVENT));
}
