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
 * Platform hosts (sherivs.com, www, app, console, legacy universalschoolos.com
 * hosts, localhost) resolve to `platform` — meaning the visitor landed on a
 * Sherivs platform host, not a tenant site.
 *
 * Generated Vercel preview hosts (`*.vercel.app`, `*.vercel.sh`) are also
 * never tenants.
 *
 * NOTE (runtime migration): these platform domains are runtime
 * configuration. Legacy hosts are kept for compatibility during the
 * Sherivs domain cutover.
 *
 * Hostname classification is not authorization. `console.sherivs.com` is
 * never an organization slug.
 */
import { hostnameFromHostHeader, isVercelPlatformHostname } from "./experience/experience-host";

const PLATFORM_HOSTS = [
  "localhost",
  "127.0.0.1",
  "sherivs.com",
  "www.sherivs.com",
  "app.sherivs.com",
  "console.sherivs.com",
  "internal.sherivs.com",
  // Legacy hosts — preserved for compatibility until DNS cutover completes.
  "universalschoolos.com",
  "www.universalschoolos.com",
  "app.universalschoolos.com",
];

const RESERVED_SUBS = new Set(["www", "app", "api", "admin", "dashboard", "internal", "console", "gov"]);

/**
 * Root domains under which the first label is a Sherivs organization slug
 * (acme.sherivs.com). Any other hostname is a school's own registered domain
 * (SHERIVS-029: portal.school.sch.ng, school.edu.ng, school.com.ng), resolved
 * through `resolve_school_by_host` (verified domains only). Multi-label public
 * suffixes such as .sch.ng / .edu.ng therefore never yield a bogus slug.
 */
const PLATFORM_ROOT_DOMAINS = ["sherivs.com", "universalschoolos.com"];
/** Government console hosts (<state>.gov.sherivs.com) are never school tenants. */
const GOV_ROOT = "gov.sherivs.com";

export type TenantHostClassification =
  | { kind: "platform" }
  | { kind: "subdomain"; slug: string }
  | { kind: "custom-domain"; domain: string };

/** Pure host classification — no window access; the resolution entry points consume it. */
export function classifyTenantHost(hostname: string): TenantHostClassification {
  const host = hostnameFromHostHeader(hostname);
  if (!host) return { kind: "platform" };
  if (PLATFORM_HOSTS.includes(host)) return { kind: "platform" };
  if (isVercelPlatformHostname(host)) return { kind: "platform" };
  // Bare IP addresses (dev tunnels) are never tenants.
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host === "[::1]") return { kind: "platform" };

  if (host === GOV_ROOT || host.endsWith(`.${GOV_ROOT}`)) return { kind: "platform" };
  const root = PLATFORM_ROOT_DOMAINS.find((r) => host.endsWith(`.${r}`));
  if (root) {
    const labels = host.slice(0, -(root.length + 1)).split(".");
    // Only a single label directly under the platform root is a slug.
    if (labels.length !== 1) return { kind: "platform" };
    const first = labels[0] ?? "";
    if (!first || RESERVED_SUBS.has(first)) return { kind: "platform" };
    return { kind: "subdomain", slug: first };
  }
  if (!host.includes(".")) return { kind: "platform" };
  // Anything else is a school's own domain (looked up; unknown hosts resolve to nothing).
  return { kind: "custom-domain", domain: host.replace(/\.$/, "") };
}

/** Hostname → organization slug. Platform hosts and reserved labels are never tenants. */
export function tenantSlugFromHostname(hostname: string): string | null {
  const classification = classifyTenantHost(hostname);
  return classification.kind === "subdomain" ? classification.slug : null;
}

export function resolveTenantSlug(): string | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const qp = url.searchParams.get("school");
  if (qp) return qp.toLowerCase();

  return tenantSlugFromHostname(url.hostname);
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
