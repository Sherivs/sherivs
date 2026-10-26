/** Shared head() + search parsing for public site routes (index and /pages/$slug). */
import siteCss from "./website.css?url";
import { siteSeo } from "@/lib/website/seo";
import type { PublicSite } from "@/lib/website/types";

export interface SiteSearch {
  school?: string;
  lang?: string;
  /** App-entry splash expands Sign In when this is set. Ignored on tenant sites. */
  panel?: "signin";
}
export function parseSiteSearch(s: Record<string, unknown>): SiteSearch {
  const out: SiteSearch = {};
  if (typeof s.school === "string" && s.school) out.school = s.school.slice(0, 63);
  if (typeof s.lang === "string" && s.lang) out.lang = s.lang.slice(0, 8);
  if (s.panel === "signin") out.panel = "signin";
  return out;
}
export function siteHead(
  site: PublicSite,
  slug: string,
  lang: string | undefined,
  preview: string | null,
) {
  const seo = siteSeo(site, slug, lang);
  return {
    meta: [
      { title: seo.title },
      { name: "description", content: seo.description },
      { property: "og:title", content: seo.og.title },
      { property: "og:description", content: seo.og.description },
      { property: "og:type", content: "website" },
      { property: "og:url", content: seo.og.url },
      { property: "og:site_name", content: seo.og.site_name },
      ...(seo.og.image ? [{ property: "og:image", content: seo.og.image }] : []),
      { name: "twitter:card", content: seo.og.image ? "summary_large_image" : "summary" },
      // Platform-host previews (?school=) must not compete with the school's own domain in search.
      ...(preview ? [{ name: "robots", content: "noindex" }] : []),
    ],
    links: [
      { rel: "stylesheet", href: siteCss },
      { rel: "canonical", href: seo.canonical },
      ...seo.alternates.map((a) => ({ rel: "alternate", hrefLang: a.hreflang, href: a.href })),
    ],
    jsonLd: seo.jsonLd,
  };
}
