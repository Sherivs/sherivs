/**
 * Sherivs experience-host resolution (ACTIVE-V1).
 *
 * Canonical production hostnames (exact match only):
 *   sherivs.com / www.sherivs.com  — public platform
 *   app.sherivs.com                — customer application
 *   console.sherivs.com            — protected internal operations
 *
 * www is classified as public. Production Vercel currently 308s apex → www;
 * this module must not reverse that redirect.
 *
 * Kind name `internal` is an architectural label. The hostname is console.
 */
export const EXPERIENCE_HOST_KINDS = [
  "public_platform",
  "app",
  "internal",
  "tenant",
  "local",
] as const;

export type ExperienceHostKind = (typeof EXPERIENCE_HOST_KINDS)[number];

export const CANONICAL_PUBLIC_HOSTS = ["sherivs.com", "www.sherivs.com"] as const;
export const CANONICAL_APP_HOST = "app.sherivs.com" as const;
export const CANONICAL_CONSOLE_HOST = "console.sherivs.com" as const;

const PUBLIC_PLATFORM_HOSTS = new Set<string>([
  ...CANONICAL_PUBLIC_HOSTS,
  "universalschoolos.com",
  "www.universalschoolos.com",
]);

const APP_HOSTS = new Set<string>([CANONICAL_APP_HOST, "app.universalschoolos.com"]);

/** Exact console hostname, plus LEGACY label so it cannot be a tenant slug. */
const INTERNAL_HOSTS = new Set<string>([CANONICAL_CONSOLE_HOST, "internal.sherivs.com"]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const RESERVED_SUBS = new Set(["www", "app", "api", "admin", "dashboard", "internal", "console"]);

/** Strip port and multi-value forwarded hosts. Exact hostname only. */
export function hostnameFromHostHeader(hostHeader: string | null | undefined): string {
  if (!hostHeader) return "";
  const first = hostHeader.split(",")[0]?.trim() ?? "";
  return first.split("/")[0]?.split(":")[0]?.trim().toLowerCase() ?? "";
}

export function resolveExperienceHost(hostname: string): ExperienceHostKind {
  const host = hostnameFromHostHeader(hostname);
  if (!host) return "public_platform";
  if (LOCAL_HOSTS.has(host)) return "local";
  if (INTERNAL_HOSTS.has(host)) return "internal";
  if (APP_HOSTS.has(host)) return "app";
  if (PUBLIC_PLATFORM_HOSTS.has(host)) return "public_platform";
  const parts = host.split(".");
  if (parts.length >= 3 && !RESERVED_SUBS.has(parts[0] ?? "")) return "tenant";
  return "public_platform";
}

export function isInternalHost(hostname: string): boolean {
  return resolveExperienceHost(hostname) === "internal";
}

export function isAppHost(hostname: string): boolean {
  return resolveExperienceHost(hostname) === "app";
}

/** App and console `/` must not SSR the public marketing homepage. */
export function shouldRedirectCanonicalRootToAuth(hostKind: ExperienceHostKind): boolean {
  return hostKind === "app" || hostKind === "internal";
}

export function currentExperienceHostKind(): ExperienceHostKind {
  if (typeof window === "undefined") return "local";
  return resolveExperienceHost(window.location.hostname);
}
