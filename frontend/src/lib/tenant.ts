/**
 * Tenant resolver.
 *
 * Strategy (in order):
 *   1. `?school=<slug>` query param
 *   2. First subdomain label of the hostname, when not a known platform host
 *
 * Platform hosts (sherivs.com, www./app.sherivs.com, localhost) resolve to
 * `null` — meaning the visitor landed on the Sherivs public site or the
 * platform workspace, not an organization's site.
 *
 * The universalschoolos.com hosts are kept so existing links and DNS keep
 * resolving to the platform during the brand migration; they must not be
 * removed until the redirect plan in SHERIVS_BRAND_MIGRATION.md is executed.
 */
export const PLATFORM_HOSTS: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "sherivs.com",
  "www.sherivs.com",
  "app.sherivs.com",
  "universalschoolos.com",
  "www.universalschoolos.com",
  "app.universalschoolos.com",
];

const RESERVED_SUBS = new Set(["www", "app", "api", "admin", "dashboard"]);

export function resolveTenantSlug(): string | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const qp = url.searchParams.get("school");
  if (qp) return qp.toLowerCase();

  const host = url.hostname;
  if (PLATFORM_HOSTS.includes(host)) return null;

  const parts = host.split(".");
  if (parts.length < 3) return null; // not a subdomain
  const first = parts[0].toLowerCase();
  if (RESERVED_SUBS.has(first)) return null;
  return first;
}
