/**
 * Recently accessed console resources. Stored locally, re-authorized on read.
 * A stale entry whose permission no longer holds is dropped, not shown.
 */
const STORAGE_KEY = "sherivs.console.recent.v1";
const MAX_ITEMS = 8;

export interface RecentResource {
  id: string;
  title: string;
  href: string;
  kind: string;
  at: string;
}

export function readRecentResources(allowedHrefs: ReadonlySet<string>): RecentResource[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row): row is RecentResource => {
        if (!row || typeof row !== "object") return false;
        const item = row as RecentResource;
        return (
          typeof item.id === "string" &&
          typeof item.title === "string" &&
          typeof item.href === "string" &&
          typeof item.kind === "string" &&
          typeof item.at === "string" &&
          allowedHrefs.has(item.href)
        );
      })
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function rememberResource(entry: RecentResource): void {
  if (typeof window === "undefined") return;
  const next: RecentResource = entry;
  const allowed = new Set<string>([entry.href]);
  const existing = readRecentResources(allowed);
  const rest = (() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as RecentResource[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const merged = [next, ...rest.filter((row) => row.id !== next.id)].slice(0, MAX_ITEMS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    /* quota / private mode */
  }
  void existing;
}

export function allowedHrefsFrom(items: ReadonlyArray<{ href: string }>): Set<string> {
  return new Set(items.map((item) => item.href));
}
