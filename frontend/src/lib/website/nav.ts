/** Navigation is derived, never hand-built: pages in order, minus pages with nothing visible. */
import { blockVisible } from "./catalog";
import { tx } from "./i18n";
import type { Locale, Page, SiteData, SiteDocument } from "./types";

export function visibleSections(p: Page, d: SiteData, l: Locale) {
  return p.sections
    .map((s) => ({ ...s, blocks: s.blocks.filter((b) => blockVisible(b, d, l)) }))
    .filter((s) => s.blocks.length > 0);
}
export function pageHasContent(p: Page, d: SiteData, l: Locale): boolean {
  return visibleSections(p, d, l).length > 0;
}
/** Link to a site page. `school` is kept only for platform-host previews (?school=slug); custom domains omit it. */
export function pageHref(
  slug: string,
  o: { lang?: Locale; defaultLocale?: Locale; school?: string | null } = {},
): string {
  const base = slug === "home" ? "/" : `/pages/${slug}`;
  const q = new URLSearchParams();
  if (o.school) q.set("school", o.school);
  if (o.lang && o.lang !== o.defaultLocale) q.set("lang", o.lang);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
export function buildNav(doc: SiteDocument, d: SiteData, l: Locale, school?: string | null) {
  return doc.pages
    .filter((p) => p.nav && pageHasContent(p, d, l))
    .map((p) => ({
      slug: p.slug,
      label: tx(p.title, l, doc.locales[0]) || p.slug,
      href: pageHref(p.slug, { lang: l, defaultLocale: doc.locales[0], school }),
    }));
}
