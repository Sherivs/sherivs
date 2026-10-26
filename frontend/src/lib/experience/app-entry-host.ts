/**
 * App-entry host (ACTIVE-V1).
 *
 * app.sherivs.com is the customer application first view: splash, in-place
 * sign-in, and Sherivs-team onboarding. It must not SSR the public marketing
 * homepage and must not restore the deleted workspace shell.
 *
 * Console, gov, head, and group hosts stay on the retired unavailable surface.
 * Hostname classification is routing, not authorization.
 */
import { hostnameFromHostHeader, resolveExperienceHost, type ExperienceHostKind } from "./experience-host";

export type AppEntryPanel = "splash" | "signin";

export function isAppEntryKind(kind: ExperienceHostKind): boolean {
  return kind === "app";
}

export function isAppEntryHostname(hostname: string): boolean {
  const host = hostnameFromHostHeader(hostname);
  if (!host) return false;
  return resolveExperienceHost(host) === "app";
}

export function parseAppEntryPanel(value: unknown): AppEntryPanel {
  return value === "signin" ? "signin" : "splash";
}
