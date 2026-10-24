/**
 * Server-side public site loader (SPEC §4). The tenant comes from the REQUEST host: a verified custom domain
 * (school_domains, SHERIVS-029) or <slug>.sherivs.com. Only on platform hosts may ?school=<slug> preview a site.
 * Responses are cacheable (s-maxage=60, stale-while-revalidate) and memoised in-process for 60 s.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { hostnameFromHostHeader } from "@/lib/experience/experience-host";
import { classifyTenantHost } from "@/lib/tenant";
import type { PublicSite } from "./types";

const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
const cache = new Map<string, { at: number; value: PublicSite | null }>();
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type SiteTarget = { p_host: string } | { p_slug: string } | null;
/** Pure: which tenant does this request address? Custom domains never honour ?school= (no cross-tenant preview). */
export function siteTarget(
  host: string,
  school: string | null | undefined,
): { target: SiteTarget; preview: string | null } {
  const cls = classifyTenantHost(host);
  if (cls.kind === "custom-domain") return { target: { p_host: cls.domain }, preview: null };
  if (cls.kind === "subdomain") return { target: { p_slug: cls.slug }, preview: null };
  const s = (school ?? "").toLowerCase();
  return SLUG.test(s) ? { target: { p_slug: s }, preview: s } : { target: null, preview: null };
}

function publicClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function fetchPublicSite(
  target: Exclude<SiteTarget, null>,
): Promise<PublicSite | null> {
  const key = JSON.stringify(target);
  const hit = cache.get(key);
  if (hit && performance.now() - hit.at < TTL_MS) return hit.value;
  const sb = publicClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc("website_public", target);
  if (error) throw new Error("website unavailable");
  const value = (data ?? null) as PublicSite | null;
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: performance.now(), value });
  return value;
}

export const loadPublicSite = createServerFn({ method: "GET" })
  .validator((i: unknown) => {
    const v = (i ?? {}) as { school?: unknown };
    return { school: typeof v.school === "string" ? v.school.slice(0, 63) : null };
  })
  .handler(async ({ data }) => {
    let host = "";
    try {
      const req = getRequest();
      host =
        hostnameFromHostHeader(req.headers.get("x-forwarded-host") ?? req.headers.get("host")) ??
        "";
    } catch {
      host = "";
    }
    const { target, preview } = siteTarget(host, data.school);
    if (!target)
      return { siteJson: null as string | null, preview: null as string | null, tenant: false };
    const site = await fetchPublicSite(target);
    try {
      setResponseHeader(
        "Cache-Control",
        site
          ? "public, max-age=0, s-maxage=60, stale-while-revalidate=600"
          : "public, max-age=0, s-maxage=30",
      );
      setResponseHeader("Vary", "Host");
    } catch {
      /* outside a request */
    }
    // Sent as a JSON string: the document is free-form JSON the RPC already validated.
    return { siteJson: site ? JSON.stringify(site) : null, preview, tenant: true };
  });

/** Typed loader used by the public routes. */
export async function getPublicSite(school: string | null | undefined) {
  const r = await loadPublicSite({ data: { school: school ?? null } });
  return {
    site: r.siteJson ? (JSON.parse(r.siteJson) as PublicSite) : null,
    preview: r.preview,
    tenant: r.tenant,
  };
}
