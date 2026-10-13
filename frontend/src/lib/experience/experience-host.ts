/**
 * Sherivs experience-host resolution (ACTIVE-V1).
 *
 * DNS cutover for sherivs.com is BLOCKED_EXTERNAL_ACTION. This module still
 * classifies the intended hosts so the app behaves correctly when those names
 * (or localhost stand-ins) hit the same deployment.
 */
export const EXPERIENCE_HOST_KINDS = [
  "public_platform",
  "app",
  "internal",
  "tenant",
  "local",
] as const;

export type ExperienceHostKind = (typeof EXPERIENCE_HOST_KINDS)[number];

const PUBLIC_PLATFORM_HOSTS = new Set([
  "sherivs.com",
  "www.sherivs.com",
  "universalschoolos.com",
  "www.universalschoolos.com",
]);

const APP_HOSTS = new Set(["app.sherivs.com", "app.universalschoolos.com"]);
const INTERNAL_HOSTS = new Set(["internal.sherivs.com"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const RESERVED_SUBS = new Set(["www", "app", "api", "admin", "dashboard", "internal"]);

export function resolveExperienceHost(hostname: string): ExperienceHostKind {
  const host = hostname.trim().toLowerCase();
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

export function currentExperienceHostKind(): ExperienceHostKind {
  if (typeof window === "undefined") return "local";
  return resolveExperienceHost(window.location.hostname);
}
