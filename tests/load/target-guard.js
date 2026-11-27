/**
 * Target guard for the Sherivs k6 load tests (mission M23, ADR-110).
 *
 * Plain ES module with no imports, so both k6 and vitest can load it.
 *
 * Rules:
 *   - localhost and 127.0.0.1 are allowed.
 *   - Any other host is allowed only when the explicit override names that exact host
 *     (K6_ALLOW_NON_LOCAL_HOST=<host>), and it is not a production host.
 *   - sherivs.com, app.sherivs.com and every other *.sherivs.com host, and *.supabase.co, are
 *     ALWAYS refused, with or without the override.
 *   - URLs with credentials, or schemes other than http/https, are refused.
 */

export const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
export const ALWAYS_REFUSED_HOSTS = ["sherivs.com", "app.sherivs.com"];
export const ALWAYS_REFUSED_SUFFIXES = [".sherivs.com", ".supabase.co"];

const URL_PATTERN = /^(https?):\/\/([^/?#]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i;

/** Returns { ok: true, origin, host } or { ok: false, reason }. Never throws. */
export function checkTarget(baseUrl, allowNonLocalHost) {
  const raw = typeof baseUrl === "string" ? baseUrl.trim() : "";
  const match = URL_PATTERN.exec(raw);
  if (!match) return { ok: false, reason: "BASE_URL must be an http(s) URL" };
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  if (authority.includes("@")) return { ok: false, reason: "BASE_URL must not carry credentials" };
  const hostPort = /^([^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hostPort) return { ok: false, reason: "BASE_URL host is not readable" };
  const host = hostPort[1].toLowerCase().replace(/\.$/, "");
  const port = hostPort[2];

  const production =
    ALWAYS_REFUSED_HOSTS.includes(host) ||
    ALWAYS_REFUSED_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (production) {
    return { ok: false, reason: `refusing ${host}: production hosts are never load-tested` };
  }
  const origin = `${scheme}://${host}${port ? `:${port}` : ""}`;
  if (LOCAL_HOSTS.includes(host)) return { ok: true, origin, host };

  const override =
    typeof allowNonLocalHost === "string" ? allowNonLocalHost.trim().toLowerCase() : "";
  if (override && override === host) return { ok: true, origin, host };
  return {
    ok: false,
    reason: `refusing ${host}: only localhost and 127.0.0.1 are allowed unless K6_ALLOW_NON_LOCAL_HOST names this exact non-production host`,
  };
}
