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

function ipv6Groups(ip: string): number[] | null {
  const raw = ip.toLowerCase();
  if (raw.includes("%")) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const parse = (side: string): number[] | null => {
    if (!side) return [];
    const nums: number[] = [];
    for (const part of side.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      nums.push(Number.parseInt(part, 16));
    }
    return nums;
  };
  const left = parse(halves[0] ?? "");
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parse(halves[1] ?? "");
  if (!right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

function ipv4FromGroups(hi: number, lo: number): string {
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

export function isPublicAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    // 192.0.0.0/24 (IETF protocol assignments) and 192.88.99.0/24 (6to4 anycast).
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 192 && b === 88 && c === 99) return false;
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
      x.startsWith("feb") ||
      x.startsWith("fec") ||
      x.startsWith("fed") ||
      x.startsWith("fee") ||
      x.startsWith("fef")
    )
      return false;
    if (x.startsWith("fc") || x.startsWith("fd") || x.startsWith("ff")) return false;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1] ?? "");
    const groups = ipv6Groups(x);
    if (!groups) return false;
    // IPv4-mapped in hextet form, NAT64, 6to4: the embedded IPv4 is the real target.
    const v4Mapped =
      groups[0] === 0 &&
      groups[1] === 0 &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0xffff;
    if (v4Mapped) return isPublicAddress(ipv4FromGroups(groups[6] ?? 0, groups[7] ?? 0));
    const nat64 =
      groups[0] === 0x64 &&
      groups[1] === 0xff9b &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0;
    if (nat64) return isPublicAddress(ipv4FromGroups(groups[6] ?? 0, groups[7] ?? 0));
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups[2] === 1) return false;
    if (groups[0] === 0x2002)
      return isPublicAddress(ipv4FromGroups(groups[1] ?? 0, groups[2] ?? 0));
    if (groups[0] === 0x2001 && groups[1] === 0) return false;
    if (groups[0] === 0x100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return false;
    return true;
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
