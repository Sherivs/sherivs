/**
 * SHERIVS-029: school custom domains (client side).
 * A school's own domain (e.g. portal.school.sch.ng, school.edu.ng) is resolved through
 * `resolve_school_by_host` (verified domains only). Sessions are already host-scoped:
 * the Supabase session lives in this origin's localStorage, so a sign-in on one domain is
 * never shared with another; `school_domain_login_allowed` additionally refuses users who
 * are not members of the domain's school.
 */
import { sdb } from "@/lib/scholar/rpc";

export type ResolvedSchoolHost = { school_id: string; slug: string; name: string; purpose: string; is_primary: boolean };
export type SchoolDomain = {
  id: string; hostname: string; purpose: "app" | "login" | "public_site"; is_primary: boolean;
  status: "pending" | "verified" | "failed" | "removed"; vercel_status: string; verification_token: string;
  last_checked_at: string | null; verified_at: string | null; failure_reason: string | null; created_at: string;
};
export type DnsInstructions = { cname: { name: string; target: string }; txt: { name: string; value: string }; apex: boolean };

/** CNAME target published by Vercel for custom domains (A 76.76.21.21 for an apex). */
export const VERCEL_CNAME_TARGET = "cname.vercel-dns.com";
export const VERCEL_APEX_A = "76.76.21.21";
const TWO_LEVEL_SUFFIXES = ["sch.ng", "edu.ng", "com.ng", "org.ng", "net.ng", "gov.ng", "name.ng", "mil.ng", "i.ng", "mobi.ng"];

/** True when the host is the registrable domain itself (school.sch.ng), which needs A/ALIAS rather than CNAME. */
export function isApexHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  const sfx = TWO_LEVEL_SUFFIXES.find((s) => h.endsWith(`.${s}`));
  const labels = (sfx ? h.slice(0, -(sfx.length + 1)) : h).split(".");
  return sfx ? labels.length === 1 : labels.length === 2;
}

export function dnsInstructions(d: Pick<SchoolDomain, "hostname" | "verification_token">): DnsInstructions {
  const apex = isApexHost(d.hostname);
  return {
    apex,
    cname: { name: d.hostname, target: apex ? VERCEL_APEX_A : VERCEL_CNAME_TARGET },
    txt: { name: `_sherivs-verify.${d.hostname}`, value: `sherivs-verify=${d.verification_token}` },
  };
}

export async function resolveSchoolByHost(host: string): Promise<ResolvedSchoolHost | null> {
  const { data, error } = await sdb.rpc("resolve_school_by_host", { p_host: host });
  if (error || !data) return null;
  return data as ResolvedSchoolHost;
}

export async function schoolDomainLoginAllowed(host: string): Promise<boolean> {
  const { data, error } = await sdb.rpc("school_domain_login_allowed", { p_host: host });
  return !error && data === true;
}
