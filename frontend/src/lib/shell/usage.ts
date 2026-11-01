export interface ShellUsageScope {
  userId: string;
  organizationId: string;
  role: string;
}

export type ShellUsageCounts = Readonly<Record<string, number>>;

const STORAGE_PREFIX = "sherivs.home.usage.v1";
const MAX_USAGE_COUNT = 1_000;

export function shellUsageStorageKey(scope: ShellUsageScope): string | null {
  if (!scope.userId || !scope.organizationId || !scope.role) return null;
  return `${STORAGE_PREFIX}:${[scope.userId, scope.organizationId, scope.role]
    .map(encodeURIComponent)
    .join(":")}`;
}

export function readShellUsage(scope: ShellUsageScope): Record<string, number> {
  const key = shellUsageStorageKey(scope);
  if (!key || typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function recordShellUsage(scope: ShellUsageScope, itemKey: string): void {
  const storageKey = shellUsageStorageKey(scope);
  if (!storageKey || !itemKey || typeof window === "undefined") return;
  try {
    const counts = readShellUsage(scope);
    counts[itemKey] = Math.min((counts[itemKey] ?? 0) + 1, MAX_USAGE_COUNT);
    window.localStorage.setItem(storageKey, JSON.stringify(counts));
  } catch {
    // Private browsing and storage quota failures must not interrupt navigation.
  }
}

export function rankByUsage<T extends { key: string }>(
  items: readonly T[],
  counts: ShellUsageCounts,
): T[] {
  return items
    .map((item, index) => ({ item, index, count: counts[item.key] ?? 0 }))
    .sort((left, right) => right.count - left.count || left.index - right.index)
    .map(({ item }) => item);
}
