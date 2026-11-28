/**
 * Website review gate (ADR-164): generated standard texts (school rules, policies, privacy and safeguarding
 * notices) are boilerplate, not the school's answers. They are emitted marked `review: "pending"`, and a
 * site with any pending block cannot be published (the database refuses it in `website_publish`). The school
 * reads each text and accepts or removes it. Pure functions over a SiteDocument; nothing here mutates its input.
 */
import { generateSite, type Facts } from "./generator";
import type { Block, Page, SiteDocument } from "./types";

export interface PendingBlock {
  readonly pageSlug: string;
  readonly pageTitle: string;
  readonly blockId: string;
  readonly type: string;
  /** What the school is being asked to read: item titles with their text, in the site's first language. */
  readonly entries: readonly { readonly title: string; readonly text: string }[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const first = (v: unknown, locale: string): string => {
  if (typeof v === "string") return v;
  if (!isObj(v)) return "";
  const hit = v[locale] ?? v.en ?? Object.values(v).find((x) => typeof x === "string");
  return typeof hit === "string" ? hit : "";
};

/** Reads `policies` items and `rules` groups into plain title and text pairs for the review screen. */
export function entriesOf(block: Block, locale: string): { title: string; text: string }[] {
  const props = block.props;
  const list = Array.isArray(props.items) ? props.items : Array.isArray(props.groups) ? props.groups : [];
  return list.filter(isObj).map((x) => ({
    title: first(x.title, locale),
    text: first(x.body ?? x.rules ?? x.summary, locale),
  }));
}

export function pendingReviewBlocks(doc: SiteDocument): PendingBlock[] {
  const out: PendingBlock[] = [];
  for (const p of doc.pages)
    for (const s of p.sections)
      for (const b of s.blocks)
        if (b.review === "pending")
          out.push({
            pageSlug: p.slug,
            pageTitle: p.title[doc.locales[0] ?? "en"] ?? p.title.en ?? p.slug,
            blockId: b.id,
            type: b.type,
            entries: entriesOf(b, doc.locales[0] ?? "en"),
          });
  return out;
}

export interface PublishReadiness {
  readonly ready: boolean;
  readonly pending: number;
}
export function publishReadiness(doc: SiteDocument): PublishReadiness {
  const pending = pendingReviewBlocks(doc).length;
  return { ready: pending === 0, pending };
}

function mapBlocks(doc: SiteDocument, f: (b: Block) => Block | null): SiteDocument {
  return {
    ...doc,
    pages: doc.pages
      .map((p) => ({
        ...p,
        sections: p.sections
          .map((s) => ({ ...s, blocks: s.blocks.map(f).filter((b): b is Block => b !== null) }))
          .filter((s) => s.blocks.length > 0),
      }))
      // A page that lost all its content leaves the site, except the required home page.
      .filter((p) => p.slug === "home" || p.sections.length > 0),
  };
}

/** Marks the named pending blocks (or all of them) as read and accepted by the school. */
export function acceptReview(doc: SiteDocument, ids: readonly string[] | "all"): SiteDocument {
  return mapBlocks(doc, (b) =>
    b.review === "pending" && (ids === "all" || ids.includes(b.id))
      ? { ...b, review: "accepted" }
      : b,
  );
}

/** Removes the named pending blocks (only pending ones; a school's own content is never touched here). */
export function removePending(doc: SiteDocument, ids: readonly string[] | "all"): SiteDocument {
  return mapBlocks(doc, (b) =>
    b.review === "pending" && (ids === "all" || ids.includes(b.id)) ? null : b,
  );
}

function allIds(doc: SiteDocument): Set<string> {
  const ids = new Set<string>();
  for (const p of doc.pages) {
    ids.add(p.id);
    for (const s of p.sections) {
      ids.add(s.id);
      for (const b of s.blocks) ids.add(b.id);
    }
  }
  return ids;
}

export interface AddStandardResult {
  readonly doc: SiteDocument;
  readonly added: boolean;
  readonly reason?: "already_present" | "nothing_to_add" | "id_clash";
}

/**
 * Offers the standard texts for review by appending the generated rules and policies page, every block
 * pending. Never replaces or edits an existing page of that name; never adds a second copy.
 */
export function addStandardTexts(doc: SiteDocument, facts: Facts): AddStandardResult {
  if (doc.pages.some((p) => p.slug === "policies")) return { doc, added: false, reason: "already_present" };
  const generated = generateSite(facts, { standardTexts: "pending" });
  const page: Page | undefined = generated.pages.find((p) => p.slug === "policies");
  if (!page) return { doc, added: false, reason: "nothing_to_add" };
  const taken = allIds(doc);
  const clash = [page.id, ...page.sections.flatMap((s) => [s.id, ...s.blocks.map((b) => b.id)])].some((id) => taken.has(id));
  if (clash) return { doc, added: false, reason: "id_clash" };
  return { doc: { ...doc, pages: [...doc.pages, page] }, added: true };
}
