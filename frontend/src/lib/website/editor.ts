/**
 * Pure, immutable editing operations for the website builder (SPEC §7). Every operation returns a new
 * document; the builder saves it with optimistic concurrency (draft_rev) and validates before saving.
 */
import { BLOCK_MAP } from "./catalog";
import type { Block, Locale, Localized, Page, Section, SiteDocument, Theme } from "./types";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let seq = 0;
/** Ids only need to be unique within a document; time + counter keeps them readable and collision-free. */
export function newId(prefix: string, doc?: SiteDocument): string {
  const taken = new Set<string>();
  if (doc)
    for (const p of doc.pages) {
      taken.add(p.id);
      for (const s of p.sections) {
        taken.add(s.id);
        for (const b of s.blocks) taken.add(b.id);
      }
    }
  let id = "";
  do id = `${prefix}-${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  while (taken.has(id));
  return id;
}
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}
function mapPage(doc: SiteDocument, pageId: string, fn: (p: Page) => Page): SiteDocument {
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? fn(p) : p)) };
}
function mapBlock(doc: SiteDocument, blockId: string, fn: (b: Block) => Block): SiteDocument {
  return {
    ...doc,
    pages: doc.pages.map((p) => ({
      ...p,
      sections: p.sections.map((s) => ({
        ...s,
        blocks: s.blocks.map((b) => (b.id === blockId ? fn(b) : b)),
      })),
    })),
  };
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "page"
  );
}

export function addPage(
  doc: SiteDocument,
  title: string,
  locale: Locale,
): { doc: SiteDocument; pageId: string } {
  let slug = slugify(title);
  const used = new Set(doc.pages.map((p) => p.slug));
  for (let i = 2; used.has(slug); i++) slug = `${slugify(title).slice(0, 44)}-${i}`;
  const id = newId("p", doc);
  const page: Page = {
    id,
    slug,
    title: { [locale]: title.trim().slice(0, 80) },
    nav: true,
    sections: [],
  };
  return { doc: { ...doc, pages: [...doc.pages, page] }, pageId: id };
}
export function removePage(doc: SiteDocument, pageId: string): SiteDocument {
  const p = doc.pages.find((x) => x.id === pageId);
  if (!p || p.slug === "home") return doc; // home is required
  return { ...doc, pages: doc.pages.filter((x) => x.id !== pageId) };
}
export function movePage(doc: SiteDocument, pageId: string, dir: -1 | 1): SiteDocument {
  const i = doc.pages.findIndex((p) => p.id === pageId);
  if (i <= 0 && dir === -1) return doc;
  if (doc.pages[i + dir]?.slug === "home") return doc; // home stays first
  return { ...doc, pages: move(doc.pages, i, i + dir) };
}
export function updatePage(
  doc: SiteDocument,
  pageId: string,
  patch: Partial<Pick<Page, "nav" | "slug">> & {
    title?: [Locale, string];
    description?: [Locale, string];
  },
): SiteDocument {
  return mapPage(doc, pageId, (p) => {
    const next: Page = { ...p };
    if (patch.nav !== undefined) next.nav = patch.nav;
    if (
      patch.slug !== undefined &&
      p.slug !== "home" &&
      SLUG_RE.test(patch.slug) &&
      patch.slug !== "home" &&
      !doc.pages.some((x) => x.id !== pageId && x.slug === patch.slug)
    )
      next.slug = patch.slug;
    if (patch.title) next.title = { ...p.title, [patch.title[0]]: patch.title[1] };
    if (patch.description)
      next.description = { ...(p.description ?? {}), [patch.description[0]]: patch.description[1] };
    return next;
  });
}

/** Adds a block in its own new section (the generator's layout model) at the end of the page or after a section. */
export function addBlock(
  doc: SiteDocument,
  pageId: string,
  type: string,
  afterSectionId?: string,
): { doc: SiteDocument; blockId: string } {
  const def = BLOCK_MAP[type];
  if (!def) return { doc, blockId: "" };
  const blockId = newId("b", doc);
  const block: Block = {
    id: blockId,
    type,
    ...(def.variants[0] ? { variant: def.variants[0] } : {}),
    props: {},
  };
  const section: Section = {
    id: newId("s", doc),
    background: type === "stats" || type === "cta" ? "brand" : "default",
    layout: "stack",
    blocks: [block],
  };
  return {
    doc: mapPage(doc, pageId, (p) => {
      const at = afterSectionId
        ? p.sections.findIndex((s) => s.id === afterSectionId) + 1
        : p.sections.length;
      const sections = p.sections.slice();
      sections.splice(at <= 0 ? sections.length : at, 0, section);
      return { ...p, sections };
    }),
    blockId,
  };
}
export function removeSection(doc: SiteDocument, pageId: string, sectionId: string): SiteDocument {
  return mapPage(doc, pageId, (p) => ({
    ...p,
    sections: p.sections.filter((s) => s.id !== sectionId),
  }));
}
export function moveSection(
  doc: SiteDocument,
  pageId: string,
  sectionId: string,
  dir: -1 | 1,
): SiteDocument {
  return mapPage(doc, pageId, (p) => {
    const i = p.sections.findIndex((s) => s.id === sectionId);
    return { ...p, sections: move(p.sections, i, i + dir) };
  });
}
export function updateSection(
  doc: SiteDocument,
  pageId: string,
  sectionId: string,
  patch: Partial<Pick<Section, "background" | "layout">>,
): SiteDocument {
  return mapPage(doc, pageId, (p) => ({
    ...p,
    sections: p.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
  }));
}
export function toggleBlock(doc: SiteDocument, blockId: string): SiteDocument {
  return mapBlock(doc, blockId, (b) => {
    const { hidden, ...rest } = b;
    return hidden ? rest : { ...rest, hidden: true };
  });
}
export function setVariant(doc: SiteDocument, blockId: string, variant: string): SiteDocument {
  return mapBlock(doc, blockId, (b) =>
    BLOCK_MAP[b.type]?.variants.includes(variant) ? { ...b, variant } : b,
  );
}
/** Sets one prop. Localized fields write only the active locale; empty values are removed (never stored as ""). */
export function setProp(
  doc: SiteDocument,
  blockId: string,
  key: string,
  value: unknown,
  locale?: Locale,
): SiteDocument {
  return mapBlock(doc, blockId, (b) => {
    const props = { ...b.props };
    if (locale) {
      const cur = { ...((props[key] as Localized | undefined) ?? {}) };
      if (typeof value === "string" && value.length) cur[locale] = value;
      else delete cur[locale];
      if (Object.keys(cur).length) props[key] = cur;
      else delete props[key];
    } else if (
      value === "" ||
      value === undefined ||
      value === null ||
      (Array.isArray(value) && !value.length)
    )
      delete props[key];
    else props[key] = value;
    return { ...b, props };
  });
}
export function setTheme(doc: SiteDocument, patch: Partial<Theme>): SiteDocument {
  const theme = { ...doc.theme, ...patch };
  if (!theme.logo) delete theme.logo;
  return { ...doc, theme };
}
/** First locale is the default; at least one stays. */
export function setLocales(doc: SiteDocument, locales: Locale[]): SiteDocument {
  const uniq = [...new Set(locales)];
  return uniq.length ? { ...doc, locales: uniq } : doc;
}
export function findBlock(
  doc: SiteDocument,
  blockId: string,
): { page: Page; section: Section; block: Block } | null {
  for (const page of doc.pages)
    for (const section of page.sections)
      for (const block of section.blocks) if (block.id === blockId) return { page, section, block };
  return null;
}
export const cloneDoc = clone;
