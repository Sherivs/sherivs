/**
 * Tenant resolver.
 *
 * Strategy (in order):
 *   1. `?school=<slug>` query param (legacy organization-slug parameter; the
 *      name is a stored contract shared with the sitemap and manifest routes)
 *   2. First subdomain label of the hostname, when not a known platform host
 *
 * Platform hosts (sherivs.com, app.sherivs.com, localhost, and the retained
 * legacy hosts) resolve to `null` — meaning the visitor landed on the
 * Sherivs platform plane (public site / platform workspaces), not on an
 * organization's public site. The host list is owned by the brand module
 * (`@/lib/experience/brand`, SHERIVS_BRAND_MIGRATION.md §4).
 */
import { PLATFORM_HOSTS } from "@/lib/experience/brand";

const RESERVED_SUBS = new Set(["www", "app", "api", "admin", "dashboard"]);

/** Pure resolver — usable on the server (request URL) and the client (window). */
export function tenantSlugFromUrl(url: URL): string | null {
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

export function resolveTenantSlug(): string | null {
  if (typeof window === "undefined") return null;
  return tenantSlugFromUrl(new URL(window.location.href));
}
