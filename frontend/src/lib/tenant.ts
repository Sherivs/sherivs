/**
 * Tenant resolver.
 *
 * Strategy (in order):
 *   1. `?school=<slug>` query param
 *   2. First subdomain label of the hostname, when not a known platform host
 *
 * Platform hosts (sherivs.com, www, app, console, localhost, plus LEGACY
 * universalschoolos.com) resolve to `null` — the visitor landed on a Sherivs
 * platform host, not a tenant organization site.
 */
const PLATFORM_HOSTS = [
  "localhost",
  "127.0.0.1",
  "sherivs.com",
  "www.sherivs.com",
  "app.sherivs.com",
  "console.sherivs.com",
  "internal.sherivs.com",
  "universalschoolos.com",
  "www.universalschoolos.com",
  "app.universalschoolos.com",
];

const RESERVED_SUBS = new Set(["www", "app", "api", "admin", "dashboard", "internal", "console"]);

function normalizeHostname(hostname: string): string {
  const first = hostname.split(",")[0]?.trim() ?? "";
  return first.split("/")[0]?.split(":")[0]?.trim().toLowerCase() ?? "";
}

/** Hostname → organization slug. Platform hosts and reserved labels are never tenants. */
export function tenantSlugFromHostname(hostname: string): string | null {
  const host = normalizeHostname(hostname);
  if (!host) return null;
  if (PLATFORM_HOSTS.includes(host)) return null;
  const parts = host.split(".");
  if (parts.length < 3) return null;
  const first = parts[0] ?? "";
  if (RESERVED_SUBS.has(first)) return null;
  return first;
}

export function resolveTenantSlug(): string | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const qp = url.searchParams.get("organization") ?? url.searchParams.get("school");
  if (qp) return qp.toLowerCase();

  return tenantSlugFromHostname(url.hostname);
}
