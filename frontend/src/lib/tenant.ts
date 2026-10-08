/**
 * Tenant resolver.
 *
 * Strategy (in order):
 *   1. `?school=<slug>` query param
 *   2. First subdomain label of the hostname, when not a known platform host
 *   3. Custom domain — a non-platform hostname that is not a subdomain of a
 *      platform host (e.g. `organization-domain.com`) resolves as a tenant
 *      HOST; the caller looks the organization up by its registered domain
 *      (`schools.domain`, Plane B: "custom-domain.example").
 *
 * Platform hosts (sherivs.com, app.sherivs.com, legacy universalschoolos.com
 * hosts, localhost) resolve to `platform` — meaning the visitor landed on the
 * platform marketing/super-admin site, not a tenant site.
 *
 * NOTE (runtime migration): these platform domains are runtime
 * configuration. Legacy hosts are kept for compatibility during the
 * Sherivs domain cutover.
 */
const PLATFORM_HOSTS = [
  "localhost",
  "127.0.0.1",
  "sherivs.com",
  "www.sherivs.com",
  "app.sherivs.com",
  // Legacy hosts — preserved for compatibility until DNS cutover completes.
  "universalschoolos.com",
  "www.universalschoolos.com",
  "app.universalschoolos.com",
];

const RESERVED_SUBS = new Set(["www", "app", "api", "admin", "dashboard"]);

export type TenantHostClassification =
  | { kind: "platform" }
  | { kind: "subdomain"; slug: string }
  | { kind: "custom-domain"; domain: string };

/** Pure host classification — no window access; the resolution entry points consume it. */
export function classifyTenantHost(hostname: string): TenantHostClassification {
  const host = hostname.toLowerCase();
  if (PLATFORM_HOSTS.includes(host)) return { kind: "platform" };
  // Bare IP addresses (dev tunnels) are never tenants.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === "[::1]") return { kind: "platform" };

  const parts = host.split(".");
  if (parts.length < 3) return { kind: "custom-domain", domain: host }; // organization-domain.com
  const first = parts[0].toLowerCase();
  if (RESERVED_SUBS.has(first)) return { kind: "platform" };
  return { kind: "subdomain", slug: first };
}

export function resolveTenantSlug(): string | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const qp = url.searchParams.get("school");
  if (qp) return qp.toLowerCase();

  const classification = classifyTenantHost(url.hostname);
  return classification.kind === "subdomain" ? classification.slug : null;
}

/**
 * The custom-domain host for THIS request, if any (Plane B). Returns the
 * lowercase hostname when the visitor landed on a tenant's own registered
 * domain; null on platform hosts, subdomains (handled by slug), and the
 * server (no window).
 */
export function resolveTenantDomain(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  if (url.searchParams.get("school")) return null;
  const classification = classifyTenantHost(url.hostname);
  return classification.kind === "custom-domain" ? classification.domain : null;
}
