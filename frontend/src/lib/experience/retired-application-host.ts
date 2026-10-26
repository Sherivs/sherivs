/**
 * Retired hardcoded application hosts (ACTIVE-V1).
 *
 * The Lovable/Scholar portal shells, Sherivs internal console chrome, and
 * gov/head/group console UIs have been removed. These hostnames must not
 * SSR the public marketing homepage (sherivs.com) and must not render a
 * prototype workspace. Canonical app.sherivs.com is the application splash
 * (not retired). Tenant websites (`<slug>.sherivs.com` and custom domains)
 * remain on the website engine.
 *
 * Hostname classification is routing, not authorization.
 */
import { isGovHost } from "@/lib/gov/host";
import { hostnameFromHostHeader, resolveExperienceHost } from "./experience-host";

/** console.<label>.sherivs.com — former head and group consoles. */
const CONSOLE_LABEL_HOST = /^console\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sherivs\.com$/;

/** First labels that used to host application / console chrome. Not tenant slugs. */
const RETIRED_FIRST_LABELS = new Set([
  "app",
  "console",
  "internal",
  "admin",
  "dashboard",
  "gov",
  "head",
  "group",
]);

const PLATFORM_ROOTS = ["sherivs.com", "universalschoolos.com"] as const;

function isRetiredPlatformLabelHost(host: string): boolean {
  for (const root of PLATFORM_ROOTS) {
    if (host === root || host === `www.${root}`) continue;
    if (!host.endsWith(`.${root}`)) continue;
    const label = host.slice(0, -(root.length + 1)).split(".")[0] ?? "";
    if (RETIRED_FIRST_LABELS.has(label)) return true;
  }
  return false;
}

export function isRetiredApplicationHostname(hostname: string): boolean {
  const host = hostnameFromHostHeader(hostname);
  if (!host) return false;
  const kind = resolveExperienceHost(host);
  // Canonical app hosts render the splash / sign-in / onboarding entry.
  if (kind === "app") return false;
  if (kind === "internal") return true;
  if (isGovHost(host)) return true;
  if (CONSOLE_LABEL_HOST.test(host)) return true;
  if (isRetiredPlatformLabelHost(host)) return true;
  return false;
}
