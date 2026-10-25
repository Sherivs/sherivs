/**
 * SHERIVS-B01: institution head console host — console.<inst>.sherivs.com.
 * Routing only; the database decides access (head role + aal2) in head_console_session.
 * On local / preview hosts `?inst=<slug>` selects the institution for testing.
 */
const RESERVED = new Set(["www", "app", "api", "admin", "dashboard", "internal", "console", "gov"]);
const MFA_RETURN_KEY = "sherivs.mfa.return";

export function headConsoleSlugFromHost(hostname: string): string | null {
  const h = (hostname ?? "").toLowerCase().split(":")[0] ?? "";
  const m = /^console\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.sherivs\.com$/.exec(h);
  if (!m || RESERVED.has(m[1]!)) return null;
  return m[1]!;
}

export function headConsoleSlug(loc: { hostname: string; search: string }): string | null {
  const fromHost = headConsoleSlugFromHost(loc.hostname);
  if (fromHost) return fromHost;
  const local = /^(localhost|127\.0\.0\.1)$/.test(loc.hostname) || /\.vercel\.(app|sh)$/.test(loc.hostname);
  if (!local) return null;
  const q = new URLSearchParams(loc.search).get("inst");
  return q && /^[a-z0-9-]{1,63}$/.test(q) ? q : null;
}

/** Where /mfa returns after a successful step-up (same-origin paths only). */
export function rememberMfaReturn(path: string): void {
  if (typeof sessionStorage !== "undefined" && path.startsWith("/") && !path.startsWith("//")) sessionStorage.setItem(MFA_RETURN_KEY, path);
}
export function takeMfaReturn(fallback: string): string {
  if (typeof sessionStorage === "undefined") return fallback;
  const p = sessionStorage.getItem(MFA_RETURN_KEY);
  sessionStorage.removeItem(MFA_RETURN_KEY);
  return p && p.startsWith("/") && !p.startsWith("//") ? p : fallback;
}

export const HEAD_ROLE_LABELS: Record<string, string> = {
  proprietor: "Proprietor", director: "Director", vc: "Vice-Chancellor", dvc: "Deputy Vice-Chancellor", rector: "Rector",
  deputy_rector: "Deputy Rector", provost: "Provost", deputy_provost: "Deputy Provost", registrar: "Registrar", bursar: "Bursar",
  librarian: "Librarian", dean: "Dean", hod: "Head of Department", principal: "Principal", vice_principal: "Vice Principal", head_teacher: "Head Teacher",
};
