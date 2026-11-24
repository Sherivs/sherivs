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

function toPathname(raw: string): { pathname: string; host: string | null; suffix: string } | null {
  if (!raw) return null;

  const value = raw.trim();
  if (!value) return null;

  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      const url = new URL(value);
      return {
        pathname: url.pathname || "/",
        host: url.host.toLowerCase(),
        suffix: `${url.search}${url.hash}`,
      };
    } catch {
      return null;
    }
  }

  if (!value.startsWith("/")) {
    return null;
  }

  try {
    const url = new URL(value, `https://${APP_LINK_HOST}`);
    return {
      pathname: url.pathname || "/",
      host: null,
      suffix: `${url.search}${url.hash}`,
    };
  } catch {
    return null;
  }
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function withSuffix(route: string, suffix: string): string {
  return `${route}${suffix}`;
}

export function mapScholarIncomingLinkToRoute(input: string): string | null {
  const parsed = toPathname(input);
  if (!parsed) return null;
  if (parsed.host && parsed.host !== APP_LINK_HOST) return null;

  const { pathname, suffix } = parsed;

  if (pathname.startsWith("/m/")) {
    return withSuffix(APP_LINK_ROUTE_FALLBACK, suffix);
  }

  if (matchesPrefix(pathname, "/home/notifications")) {
    return withSuffix(APP_LINK_ROUTE_FALLBACK, suffix);
  }

  if (matchesPrefix(pathname, "/results")) return withSuffix("/(school)/results", suffix);
  if (matchesPrefix(pathname, "/fees")) return withSuffix("/(school)/fees", suffix);
  if (matchesPrefix(pathname, "/messages")) return withSuffix("/(school)/messages", suffix);
  if (matchesPrefix(pathname, "/cbt")) return withSuffix("/(school)/cbt", suffix);

  return null;
}
