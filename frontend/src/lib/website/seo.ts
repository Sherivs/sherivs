/** SEO for a rendered site page: title, description, canonical, hreflang, Open Graph, JSON-LD (SPEC §9). */
import { generateSite, orgKind } from "./generator";
import { tx } from "./i18n";
import { pageHasContent } from "./nav";
import type { Locale, Page, PublicSite, SiteDocument } from "./types";

export function effectiveDocument(site: PublicSite): SiteDocument {
  return site.document ?? generateSite({ data: site.data });
}
export function resolveLocale(doc: SiteDocument, lang: unknown): Locale {
  return (doc.locales as string[]).includes(String(lang)) ? (lang as Locale) : doc.locales[0];
}
export function findPage(
  doc: SiteDocument,
  site: PublicSite,
  slug: string,
  l: Locale,
): Page | null {
  const p = doc.pages.find((x) => x.slug === slug);
  return p && pageHasContent(p, site.data, l) ? p : null;
}
export function siteOrigin(site: PublicSite): string {
  return site.canonical_host
    ? `https://${site.canonical_host}`
    : `https://${site.data.school.slug}.sherivs.com`;
}
export function siteSeo(site: PublicSite, slug: string, lang: unknown) {
  const doc = effectiveDocument(site);
  const l = resolveLocale(doc, lang);
  const def = doc.locales[0];
  const page = doc.pages.find((p) => p.slug === slug);
  const s = site.data.school;
  const pageTitle = page ? tx(page.title, l, def) : "";
  const title =
    slug === "home" || !pageTitle
      ? `${s.name}${s.motto ? ` | ${s.motto}` : ""}`
      : `${pageTitle} | ${s.name}`;
  const description = ((page && tx(page.description, l, def)) || s.about || s.motto || s.name)
    .replace(/\s+/g, " ")
    .slice(0, 300);
  const path = slug === "home" ? "/" : `/pages/${slug}`;
  const origin = siteOrigin(site);
  const url = (loc: Locale) => `${origin}${path}${loc === def ? "" : `?lang=${loc}`}`;
  const kind = orgKind({ data: site.data });
  const ld = {
    "@context": "https://schema.org",
    "@type":
      kind === "university" || kind === "polytechnic"
        ? "CollegeOrUniversity"
        : kind === "government"
          ? "GovernmentOrganization"
          : "EducationalOrganization",
    name: s.name,
    url: origin,
    description,
    logo: s.logo_url ?? undefined,
    telephone: s.phone ?? undefined,
    email: s.email ?? undefined,
    foundingDate: s.founded_year ? String(s.founded_year) : undefined,
    address: s.address
      ? { "@type": "PostalAddress", streetAddress: s.address, addressCountry: "NG" }
      : undefined,
    sameAs: Object.values(s.socials ?? {}).filter(Boolean),
  };
  return {
    title,
    description,
    canonical: url(l),
    lang: l,
    alternates: doc.locales.map((loc) => ({
      hreflang: loc === "pcm" ? "pcm-NG" : loc,
      href: url(loc),
    })),
    og: { title, description, url: url(l), image: s.logo_url ?? undefined, site_name: s.name },
    jsonLd: JSON.stringify(ld).replace(/</g, "\\u003c"),
  };
}

/** Sitemap URLs for one organization site: every page with content, in every locale (SPEC §9). */
export function siteSitemapUrls(site: PublicSite): string[] {
  const doc = effectiveDocument(site);
  const def = doc.locales[0];
  const origin = siteOrigin(site);
  const out: string[] = [];
  for (const p of doc.pages) {
    if (!pageHasContent(p, site.data, def)) continue;
    const path = p.slug === "home" ? "/" : `/pages/${p.slug}`;
    for (const l of doc.locales) out.push(`${origin}${path}${l === def ? "" : `?lang=${l}`}`);
  }
  return out;
}
