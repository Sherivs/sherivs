const ALLOWED_PREFIXES = [
  "/m/",
  "/home/notifications",
  "/results",
  "/fees",
  "/messages",
  "/cbt",
  "/home/results",
  "/home/fees",
  "/home/messages",
  "/home/cbt",
] as const;

function allowPrefix(pathname: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Returns a canonical in-app route only when it is explicitly allowed.
 * Unknown or malformed routes are dropped.
 */
export function sanitizePushRoute(route: unknown): string | undefined {
  if (typeof route !== "string") return undefined;
  const trimmed = route.trim();
  if (!trimmed) return undefined;

  let pathname = trimmed;
  try {
    pathname = new URL(trimmed, "https://app.sherivs.com").pathname;
  } catch {
    return undefined;
  }

  return ALLOWED_PREFIXES.some((prefix) => allowPrefix(pathname, prefix)) ? pathname : undefined;
}

export const PUSH_ROUTE_ALLOWLIST = ALLOWED_PREFIXES;
