/**
 * Government console realm (SHERIVS-B02): <label>.gov.sherivs.com belongs to one jurisdiction
 * (borno.gov.sherivs.com -> Borno). gov.sherivs.com itself is the neutral entry point.
 * On localhost / Vercel previews, ?gov=<label> stands in for the subdomain.
 */
const GOV_HOST_RE = /^([a-z][a-z0-9-]{1,30}[a-z0-9])\.gov\.sherivs\.com$/;
const RESERVED = new Set(["www", "app", "api", "admin", "console", "internal", "gov", "mail", "status"]);

export function govLabelFromHost(hostname: string): string | null {
  const m = GOV_HOST_RE.exec(hostname.trim().toLowerCase().replace(/\.$/, ""));
  if (!m || RESERVED.has(m[1])) return null;
  return m[1];
}

export function isGovHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  return h === "gov.sherivs.com" || govLabelFromHost(h) !== null;
}

function isDevHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".vercel.app");
}

export function govLabel(loc: { hostname: string; search: string }): string | null {
  const fromHost = govLabelFromHost(loc.hostname);
  if (fromHost) return fromHost;
  if (!isDevHost(loc.hostname)) return null;
  const q = new URLSearchParams(loc.search).get("gov");
  return q && /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(q) ? q : null;
}

/** Same key the /mfa page reads (SHERIVS-B01) so step-up returns to the console. Same-origin paths only. */
export function rememberGovMfaReturn(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  try { sessionStorage.setItem("sherivs.mfa.return", path); } catch { /* storage blocked */ }
}

export const AGENCY_ROLES = [
  ["commissioner", "Commissioner"], ["permanent_secretary", "Permanent Secretary"], ["director", "Director"],
  ["board_chair", "Board chair (SUBEB/TSB)"], ["inspector", "Inspector"], ["planning_officer", "Planning officer"],
  ["data_officer", "Data officer"], ["viewer", "Viewer"],
] as const;
export type AgencyRole = (typeof AGENCY_ROLES)[number][0];

export type GovConsoleSession =
  | { status: "unknown_jurisdiction" }
  | { status: "signed_out" | "not_an_officer" | "mfa_required"; jurisdiction: string }
  | { status: "ok"; jurisdiction_id: string; jurisdiction: string; agency_role: AgencyRole | null; expires_at: string | null };
