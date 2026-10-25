/**
 * Outbound HTTP for connectors (school-supplied URLs => SSRF risk). https only, no redirects,
 * every resolved address must be public (no loopback, private, link-local, CGNAT, metadata,
 * multicast or IPv6 ULA), 20 s timeout, 10 MB response cap.
 * Residual risk: DNS rebinding between the check and the connect; mitigate at the egress proxy.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const MAX_BYTES = 10 * 1024 * 1024;

export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const x = ip.toLowerCase();
    if (
      x === "::1" ||
      x === "::" ||
      x.startsWith("fe8") ||
      x.startsWith("fe9") ||
      x.startsWith("fea") ||
      x.startsWith("feb")
    )
      return false;
    if (x.startsWith("fc") || x.startsWith("fd") || x.startsWith("ff")) return false;
    const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPublicAddress(m[1]) : true;
  }
  return false;
}

export async function assertPublicHttps(
  raw: string,
  resolve: (h: string) => Promise<{ address: string }[]> = (h) => lookup(h, { all: true }),
): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "https:") throw new Error("connector URLs must use https");
  if (u.username || u.password) throw new Error("credentials in URLs are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await resolve(host);
  if (addrs.length === 0 || !addrs.every((a) => isPublicAddress(a.address)))
    throw new Error("connector host must be a public address");
  return u;
}

export const safeFetch: FetchLike = async (url, init = {}) => {
  await assertPublicHttps(url);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(url, { ...init, redirect: "manual", signal: ctl.signal });
    if (r.status >= 300 && r.status < 400)
      throw new Error(`connector redirect refused (HTTP ${r.status})`);
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error("connector response too large");
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) throw new Error("connector response too large");
    return new Response(buf, { status: r.status, headers: r.headers });
  } finally {
    clearTimeout(t);
  }
};
