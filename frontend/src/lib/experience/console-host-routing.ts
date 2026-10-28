/**
 * Console host routing (console.sherivs.com).
 *
 * Routing only, never authorization: every console surface keeps its own
 * role / capability / MFA guards. This module decides WHERE a signed-in user
 * may be on a given host:
 *   - console host: only the Internal Console (`/console`), MFA, and auth
 *     recovery surfaces render. Anything else goes to `/console`.
 *     Users who are not console operators see a "not authorised" screen.
 *   - app / public / tenant hosts: `/console*` is not served (the console
 *     lives on its own subdomain).
 *   - local / preview hosts: unrestricted, unless VITE_SHERIVS_HOST_KIND_OVERRIDE
 *     simulates another host kind (honoured ONLY on local / preview hosts).
 *
 * Deleted prototypes (`/internal`, `/super-admin`, `/command-centre`) are
 * not console surfaces.
 */
import { CONSOLE_HOME_PATH } from "@/lib/internal-console/paths";
import {
  CANONICAL_CONSOLE_HOST,
  EXPERIENCE_HOST_KINDS,
  resolveExperienceHost,
  type ExperienceHostKind,
} from "./experience-host";

export type { ExperienceHostKind };

export { CONSOLE_HOME_PATH };
export const CONSOLE_ORIGIN = `https://${CANONICAL_CONSOLE_HOST}`;

export function parseHostKindOverride(value: string | null | undefined): ExperienceHostKind | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  return (EXPERIENCE_HOST_KINDS as readonly string[]).includes(v)
    ? (v as ExperienceHostKind)
    : null;
}

/** Host kind after applying the local/preview-only override. */
export function effectiveExperienceHostKind(
  hostname: string,
  override?: string | null,
): ExperienceHostKind {
  const real = resolveExperienceHost(hostname);
  if (real !== "local") return real; // production hosts can never be overridden
  return parseHostKindOverride(override) ?? real;
}

export function currentEffectiveHostKind(hostname?: string | null): ExperienceHostKind {
  const override = (import.meta.env?.VITE_SHERIVS_HOST_KIND_OVERRIDE as string | undefined) ?? null;
  if (typeof window !== "undefined") {
    return effectiveExperienceHostKind(window.location.hostname, override);
  }
  if (hostname) return effectiveExperienceHostKind(hostname, override);
  return "local";
}

export function isConsolePath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return (
    p === CONSOLE_HOME_PATH ||
    p.startsWith(`${CONSOLE_HOME_PATH}/`) ||
    p.startsWith(`${CONSOLE_HOME_PATH}_`)
  );
}

export const CONSOLE_PUBLIC_PREFIXES = [
  "/auth",
  "/login",
  "/reset-password",
  "/forgot-password",
] as const;

export function isPublicConsolePath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return CONSOLE_PUBLIC_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/**
 * Surfaces the console host may render after sign-in: the /console workspace
 * plus MFA step-up. Deleted prototypes are not included.
 */
export const CONSOLE_SURFACE_PREFIXES = [CONSOLE_HOME_PATH, "/mfa"] as const;

export function isConsoleSurfacePath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (isConsolePath(p)) return true;
  return CONSOLE_SURFACE_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** Internal workforce: super admins, plus active platform staff once that exists. */
export function isConsoleOperator(state: {
  superAdmin?: unknown;
  platformStaff?: unknown;
}): boolean {
  return Boolean(state.superAdmin) || Boolean(state.platformStaff);
}

export type HostRouteDecision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  | { kind: "not_authorised" }
  | { kind: "console_elsewhere" };

export function decideHostRoute(input: {
  hostKind: ExperienceHostKind;
  pathname: string;
  signedIn: boolean;
  isConsoleOperator: boolean;
}): HostRouteDecision {
  const { hostKind, pathname, signedIn } = input;
  if (hostKind === "local") return { kind: "allow" };
  if (hostKind === "internal") {
    if (!signedIn) {
      if (isPublicConsolePath(pathname)) return { kind: "allow" };
      return { kind: "redirect", to: "/auth" };
    }
    if (!input.isConsoleOperator) return { kind: "not_authorised" };
    if (isPublicConsolePath(pathname)) return { kind: "redirect", to: CONSOLE_HOME_PATH };
    if (!isConsoleSurfacePath(pathname)) return { kind: "redirect", to: CONSOLE_HOME_PATH };
    return { kind: "allow" };
  }
  if (isConsolePath(pathname)) return { kind: "console_elsewhere" };
  return { kind: "allow" };
}

/**
 * Only same-origin Internal Console surfaces may be used as a post-auth
 * `next` target. Rejects protocol-relative URLs, other origins, and
 * organization-app paths.
 */
export function sanitizeConsoleNextPath(next: string | null | undefined): string | null {
  if (typeof next !== "string") return null;
  let raw = next.trim();
  if (!raw) return null;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://") || raw.includes("\\")) {
    return null;
  }
  const path = (raw.split("?")[0] ?? "").split("#")[0] ?? "";
  const normalized = path.replace(/\/+$/, "") || "/";
  return isConsoleSurfacePath(normalized) ? normalized : null;
}

/** Search params for `/auth` when the console sends an unsigned visitor to sign in. */
export function consoleSignInSearch(pathname: string): { next: string } {
  return { next: sanitizeConsoleNextPath(pathname) ?? CONSOLE_HOME_PATH };
}

/**
 * Where a signed-in session should land.
 *
 * Console host: always the Internal Console (or a sanitized `next`).
 * Elsewhere: the identity destination (staff → `/console`, members → workspace).
 * Local / preview: honour a sanitized `next` so `/console` → `/auth` round-trips.
 */
export function postSignInPath(input: {
  hostKind: ExperienceHostKind;
  identityDestination: string;
  next?: string | null;
}): string {
  const next = sanitizeConsoleNextPath(input.next);
  if (input.hostKind === "internal") return next ?? CONSOLE_HOME_PATH;
  if (input.hostKind === "local" && next) return next;
  return input.identityDestination;
}
