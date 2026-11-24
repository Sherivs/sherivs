const APP_LINK_HOST = "app.sherivs.com";

export const APP_LINK_PATH_PREFIXES = [
  "/m/",
  "/home/notifications",
  "/results",
  "/fees",
  "/messages",
  "/cbt",
] as const;

export const APP_LINK_ROUTE_FALLBACK = "/(school)/home";

function toPathname(raw: string): { pathname: string; host: string | null } | null {
  if (!raw) return null;

  const value = raw.trim();
  if (!value) return null;

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const url = new URL(value);
      return { pathname: url.pathname || "/", host: url.host.toLowerCase() };
    } catch {
      return null;
    }
  }

  if (!value.startsWith("/")) {
    return null;
  }

  return { pathname: value, host: null };
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function mapScholarIncomingLinkToRoute(input: string): string | null {
  const parsed = toPathname(input);
  if (!parsed) return null;
  if (parsed.host && parsed.host !== APP_LINK_HOST) return null;

  const pathname = parsed.pathname;

  if (pathname.startsWith("/m/")) {
    return APP_LINK_ROUTE_FALLBACK;
  }

  if (matchesPrefix(pathname, "/home/notifications")) {
    return APP_LINK_ROUTE_FALLBACK;
  }

  if (matchesPrefix(pathname, "/results")) return "/(school)/results";
  if (matchesPrefix(pathname, "/fees")) return "/(school)/fees";
  if (matchesPrefix(pathname, "/messages")) return "/(school)/messages";
  if (matchesPrefix(pathname, "/cbt")) return "/(school)/cbt";

  return null;
}
