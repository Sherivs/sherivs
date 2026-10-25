/** Mirror of SQL public._website_validate (the database is authoritative); used for instant editor feedback. */
import { BLOCK_MAP } from "./catalog";
import { PAIRING_KEYS } from "./theme";
import { LOCALES, type SiteDocument } from "./types";

export const LIMITS = {
  bytes: 600_000,
  pages: 60,
  sectionsPerPage: 40,
  blocksPerSection: 20,
  blocks: 1500,
} as const;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const BAD_URL = /"\s*(javascript|vbscript|data|file)\s*:/i;

export function validateDocument(doc: unknown): string[] {
  const e: string[] = [];
  const d = doc as SiteDocument;
  if (!d || typeof d !== "object" || d.schema !== 1)
    return ["document must be an object with schema 1"];
  const raw = JSON.stringify(d);
  if (new TextEncoder().encode(raw).length > LIMITS.bytes) e.push("site is too large");
  if (BAD_URL.test(raw)) e.push("script or data URLs are not allowed");
  if (
    !Array.isArray(d.locales) ||
    !d.locales.length ||
    d.locales.some((l) => !(LOCALES as readonly string[]).includes(l))
  )
    e.push("locales must be en, ha, yo, ig or pcm");
  if (!d.theme || !HEX.test(d.theme.primary) || !HEX.test(d.theme.secondary))
    e.push("theme colours must be #rrggbb");
  if (d.theme?.pairing && !PAIRING_KEYS.includes(d.theme.pairing)) e.push("unknown font pairing");
  if (d.theme?.dark && !["auto", "light", "dark"].includes(d.theme.dark))
    e.push("invalid dark mode");
  for (const u of [d.theme?.logo, d.theme?.crest, d.seo?.favicon, d.seo?.og_image])
    if (u && !/^(https:\/\/|\/)[^\s"<>]{0,500}$/.test(u))
      e.push("image links must start with https:// or /");
  if (!Array.isArray(d.pages) || d.pages.length < 1 || d.pages.length > LIMITS.pages)
    return [...e, `1 to ${LIMITS.pages} pages`];
  const slugs = new Set<string>();
  const ids = new Set<string>();
  let blocks = 0;
  for (const p of d.pages) {
    if (!SLUG.test(p.slug ?? ""))
      e.push(`page slug "${p.slug}" must be lowercase letters, digits and dashes`);
    if (slugs.has(p.slug)) e.push(`duplicate page "${p.slug}"`);
    slugs.add(p.slug);
    if (!ID.test(p.id ?? "") || ids.has(p.id)) e.push(`bad or duplicate id ${p.id}`);
    ids.add(p.id);
    if (!Array.isArray(p.sections) || p.sections.length > LIMITS.sectionsPerPage) {
      e.push(`page "${p.slug}": too many sections`);
      continue;
    }
    for (const s of p.sections) {
      if (!ID.test(s.id ?? "") || ids.has(s.id)) e.push(`bad or duplicate id ${s.id}`);
      ids.add(s.id);
      if (!Array.isArray(s.blocks) || s.blocks.length > LIMITS.blocksPerSection) {
        e.push(`page "${p.slug}": too many blocks in a section`);
        continue;
      }
      for (const b of s.blocks) {
        blocks++;
        if (!ID.test(b.id ?? "") || ids.has(b.id)) e.push(`bad or duplicate id ${b.id}`);
        ids.add(b.id);
        const def = BLOCK_MAP[b.type];
        if (!def) e.push(`unknown block "${b.type}"`);
        else if (b.variant && !def.variants.includes(b.variant))
          e.push(`${b.type}: unknown variant "${b.variant}"`);
        if (!b.props || typeof b.props !== "object" || Array.isArray(b.props))
          e.push(`${b.type}: props must be an object`);
      }
    }
  }
  if (!slugs.has("home")) e.push('a page with slug "home" is required');
  if (blocks > LIMITS.blocks) e.push("too many blocks");
  return e;
}
