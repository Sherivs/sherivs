/**
 * SHERIVS-004 — pure request-safety helpers (no I/O, no clock).
 *
 * - safeRelativePath: open-redirect guard (same-origin relative paths only).
 * - safeMapEmbedSrc: only a Google Maps embed https URL may reach an <iframe src>.
 * - escapeXmlText: correct XML text escaping (ampersand first).
 * - clientIpFromHeaders: platform-observed caller address for rate-limit keys.
 */
function hasControlOrBackslash(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || value[i] === "\\") return true;
  }
  return false;
}

/** Returns `value` only when it is a same-origin relative path, else `fallback`. */
export function safeRelativePath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (hasControlOrBackslash(value) || hasControlOrBackslash(decoded)) return fallback;
  if (decoded.startsWith("//")) return fallback;
  return value;
}

const MAP_HOST = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;

/** Extracts and validates a Google Maps embed src from a URL or an <iframe> snippet. */
export function safeMapEmbedSrc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  const candidate = (match ? match[1] : raw).trim();
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!MAP_HOST.test(url.hostname)) return null;
  if (!url.pathname.startsWith("/maps/embed")) return null;
  return url.toString();
}

export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Cloudflare anycast ranges, copied 2026-10-29 from
 * https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6.
 * Used only to decide when cf-connecting-ip was set by Cloudflare rather than
 * by the caller. Refresh when Cloudflare publishes a new list.
 */
const CLOUDFLARE_IPV4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
] as const;

const CLOUDFLARE_IPV6: ReadonlyArray<readonly [string, number]> = [
  ["2400:cb00::", 32],
  ["2606:4700::", 32],
  ["2803:f800::", 32],
  ["2405:b500::", 32],
  ["2405:8100::", 32],
  ["2a06:98c0::", 29],
  ["2c0f:f248::", 32],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const ipInt = ipv4ToInt(ip);
  const baseInt = base ? ipv4ToInt(base) : null;
  const bits = Number(bitsRaw);
  if (ipInt === null || baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

function ipv6Groups(ip: string): number[] | null {
  const raw = ip.toLowerCase();
  if (raw.includes(".") || raw.includes("%")) return null;
  const halves = raw.split("::");
  if (halves.length > 2) return null;
  const parse = (side: string): number[] | null => {
    if (!side) return [];
    const parts = side.split(":");
    const nums: number[] = [];
    for (const part of parts) {
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
  return [...left, ...Array(missing).fill(0), ...right];
}

function ipv6PrefixMatch(ip: string, base: string, bits: number): boolean {
  const left = ipv6Groups(ip);
  const right = ipv6Groups(base);
  if (!left || !right || bits < 0 || bits > 128) return false;
  let remaining = bits;
  for (let i = 0; i < 8 && remaining > 0; i += 1) {
    const take = Math.min(16, remaining);
    const shift = 16 - take;
    if (left[i]! >>> shift !== right[i]! >>> shift) return false;
    remaining -= take;
  }
  return true;
}

export function isCloudflarePeer(ip: string): boolean {
  if (ipv4ToInt(ip) !== null) return CLOUDFLARE_IPV4.some((cidr) => ipv4InCidr(ip, cidr));
  return CLOUDFLARE_IPV6.some(([base, bits]) => ipv6PrefixMatch(ip, base, bits));
}

function firstHop(value: string | null): string | null {
  if (!value) return null;
  const hop = value.split(",")[0]?.trim() ?? "";
  if (!hop || hop.length > 64) return null;
  return hop;
}

function isIpLiteral(value: string): boolean {
  return ipv4ToInt(value) !== null || ipv6Groups(value) !== null;
}

/**
 * Address used as a rate-limit key.
 *
 * Vercel overwrites `x-vercel-forwarded-for` with the connecting peer so a
 * caller cannot choose their bucket. `cf-connecting-ip` is honoured only when
 * that peer is a Cloudflare address (orange-cloud in front of Vercel). A
 * direct request that forges `cf-connecting-ip` or the left-most
 * `x-forwarded-for` hop does not get its own bucket.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const peer = firstHop(headers.get("x-vercel-forwarded-for"));
  if (!peer || !isIpLiteral(peer)) return "unknown";
  if (isCloudflarePeer(peer)) {
    const visitor = firstHop(headers.get("cf-connecting-ip"));
    if (visitor && isIpLiteral(visitor)) return visitor;
  }
  return peer;
}
