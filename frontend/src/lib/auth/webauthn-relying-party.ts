/**
 * Domain-aware WebAuthn relying-party selection.
 *
 * Platform hosts (sherivs.com) keep the configured platform RP ID.
 * A custom tenant domain may complete a ceremony only when:
 *   - the request Origin is HTTPS
 *   - the hostname matches a verified school_domains row (or is a suffix of one)
 *   - the RP ID is that verified hostname
 *
 * Never trusts a client-supplied organization ID, RP ID, or Host header.
 * Existing sherivs.com credentials are not rewritten onto custom domains.
 */
import {
  hostnameIsRpSuffix,
  originAllowedForRp,
  originHostname,
  type WebAuthnConfig,
} from "./webauthn-policy";

export type SchoolDomainRpRecord = {
  hostname: string;
  status: "pending" | "verified" | "failed" | "removed" | string;
  schoolId: string;
};

export function candidateRpHosts(hostname: string): string[] {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return [];
  const labels = host.split(".").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i += 1) {
    out.push(labels.slice(i).join("."));
  }
  return out;
}

/**
 * Exact hostname wins. A live but unverified exact row cannot fall through
 * to a verified parent. Parents are considered only when the exact host has
 * no live registration.
 */
export function selectSchoolDomainForHost(
  hostname: string,
  rows: readonly SchoolDomainRpRecord[],
): SchoolDomainRpRecord | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  const live = rows.filter((row) => row.status !== "removed");
  const exact = live.find((row) => row.hostname === host);
  if (exact) return exact.status === "verified" ? exact : null;
  const parents = candidateRpHosts(host).slice(1);
  const verifiedParents = live
    .filter((row) => row.status === "verified" && parents.includes(row.hostname))
    .sort((a, b) => b.hostname.length - a.hostname.length);
  return verifiedParents[0] ?? null;
}

export function selectCustomDomainRelyingParty(input: {
  origin: string;
  domain: SchoolDomainRpRecord | null;
  rpName: string;
  challengeTtlMs: number;
}): WebAuthnConfig | null {
  if (!input.domain || input.domain.status !== "verified") return null;
  const host = originHostname(input.origin);
  if (!host) return null;
  try {
    const url = new URL(input.origin);
    if (url.protocol !== "https:") return null;
    if (url.origin !== input.origin) return null;
    if (!hostnameIsRpSuffix(host, input.domain.hostname)) return null;
    return {
      rpName: input.rpName,
      rpID: input.domain.hostname,
      origin: url.origin,
      allowedOrigins: [url.origin],
      challengeTtlMs: input.challengeTtlMs,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the ceremony config for a browser Origin.
 * Platform RP wins when the origin is valid for it. Otherwise a verified
 * custom tenant domain may supply its own RP ID. Unverified, revoked, HTTP,
 * and unknown origins return null (fail closed).
 */
export function resolveCeremonyRelyingParty(input: {
  origin: string;
  platform: WebAuthnConfig;
  domain: SchoolDomainRpRecord | null;
}): WebAuthnConfig | null {
  if (originAllowedForRp(input.origin, input.platform)) return input.platform;
  return selectCustomDomainRelyingParty({
    origin: input.origin,
    domain: input.domain,
    rpName: input.platform.rpName,
    challengeTtlMs: input.platform.challengeTtlMs,
  });
}

/**
 * Native iOS/Android passkeys use the associated-domain origin of the
 * platform RP ID (https://sherivs.com), not a custom tenant website and not
 * the browser tab that called the API. sherivs.com credentials stay bound
 * to that RP ID.
 */
export function nativeCeremonyOrigin(platform: Pick<WebAuthnConfig, "rpID">): string {
  if (platform.rpID === "localhost") return "http://localhost";
  return `https://${platform.rpID}`;
}
