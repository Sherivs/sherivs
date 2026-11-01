/** SEO for a rendered site page: title, description, canonical, hreflang, Open Graph, JSON-LD (SPEC §9). */
import { jsonLdJson } from "@/lib/security/json-ld";
import { generateSite, orgKind } from "./generator";
import { tx } from "./i18n";
import { pageHasContent } from "./nav";
import { safeUrl } from "./sanitize";
import { onColor } from "./theme";
import type { Locale, Page, Post, PublicSite, SiteDocument } from "./types";

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
/** Absolute URL for an image path on the site's own origin (OG images must be absolute). */
function abs(origin: string, u: string | null | undefined): string | undefined {
  const x = safeUrl(u);
  if (!x || x.startsWith("#") || x.startsWith("mailto:") || x.startsWith("tel:")) return undefined;
  return x.startsWith("/") ? `${origin}${x}` : x;
}
function heroImage(doc: SiteDocument): string | undefined {
  for (const p of doc.pages)
    for (const sec of p.sections)
      for (const b of sec.blocks)
        if (b.type === "hero" && typeof b.props.image === "string" && b.props.image)
          return b.props.image;
  return undefined;
}
/** Favicon: the school's own icon, else its logo, else a generated monogram in its brand colour. */
export function siteIcon(site: PublicSite): { href: string; type?: string } {
  const doc = effectiveDocument(site);
  const own = safeUrl(doc.seo?.favicon) ?? safeUrl(doc.theme.logo ?? site.data.school.logo_url);
  return own ? { href: own } : { href: "/site-icon.svg", type: "image/svg+xml" };
}
export function siteSeo(site: PublicSite, slug: string, lang: unknown, post?: Post | null) {
  const doc = effectiveDocument(site);
  const l = resolveLocale(doc, lang);
  const def = doc.locales[0];
  const page = doc.pages.find((p) => p.slug === slug);
  const s = site.data.school;
  const suffix = doc.seo?.title_suffix?.trim() || s.name;
  const pageTitle = post
    ? post.seo?.title || tx(post.title, l, def)
    : page
      ? tx(page.title, l, def)
      : "";
  const title =
    !post && (slug === "home" || !pageTitle)
      ? `${s.name}${s.motto ? ` | ${s.motto}` : ""}`
      : `${pageTitle} | ${suffix}`;
  const description = (
    (post && (post.seo?.description || tx(post.excerpt, l, def))) ||
    (page && tx(page.description, l, def)) ||
    (slug === "home" && tx(doc.seo?.description, l, def)) ||
    s.about ||
    s.motto ||
    s.name
  )
    .replace(/\s+/g, " ")
    .slice(0, 300);
  const path = post ? `/posts/${post.slug}` : slug === "home" ? "/" : `/pages/${slug}`;
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
    og: {
      title,
      description,
      url: url(l),
      type: post ? "article" : "website",
      image:
        abs(origin, post?.cover_url) ??
        abs(origin, doc.seo?.og_image) ??
        abs(origin, heroImage(doc)) ??
        abs(origin, doc.theme.logo ?? s.logo_url),
      site_name: s.name,
    },
    themeColor: doc.theme.primary,
    icon: siteIcon(site),
    jsonLd: jsonLdJson(ld),
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
  for (const post of site.data.posts ?? []) out.push(`${origin}/posts/${post.slug}`);
  return out;
}

const xml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] as string,
  );
/** RSS 2.0 feed of the site's published posts (default language). */
export function siteRss(site: PublicSite): string {
  const doc = effectiveDocument(site);
  const def = doc.locales[0];
  const origin = siteOrigin(site);
  const s = site.data.school;
  const items = (site.data.posts ?? []).map((p) =>
    [
      "    <item>",
      `      <title>${xml(tx(p.title, def, def))}</title>`,
      `      <link>${origin}/posts/${xml(p.slug)}</link>`,
      `      <guid isPermaLink="true">${origin}/posts/${xml(p.slug)}</guid>`,
      `      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>`,
      p.category ? `      <category>${xml(p.category)}</category>` : "",
      tx(p.excerpt, def, def)
        ? `      <description>${xml(tx(p.excerpt, def, def))}</description>`
        : "",
      "    </item>",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    "  <channel>",
    `    <title>${xml(s.name)}</title>`,
    `    <link>${origin}/</link>`,
    `    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>`,
    `    <description>${xml((s.motto || s.about || s.name).slice(0, 300))}</description>`,
    `    <language>${def === "pcm" ? "pcm-NG" : def}</language>`,
    ...items,
    "  </channel>",
    "</rss>",
  ].join("\n");
}

/** Monogram favicon in the school's brand colours (used when the school has no icon or logo). */
export function siteIconSvg(site: PublicSite): string {
  const doc = effectiveDocument(site);
  const name = site.data.school.name;
  const letters =
    name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and|&)$/i.test(w))
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "S";
  const hex = (v: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
  const p = hex(doc.theme.primary, "#0b6b3a");
  const s2 = hex(doc.theme.secondary, "#a35a00");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${onColor(p).fill}"/><rect y="52" width="64" height="12" fill="${s2}"/><text x="32" y="40" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="${letters.length > 1 ? 26 : 32}" fill="${onColor(p).text}">${xml(letters)}</text></svg>`;
}
