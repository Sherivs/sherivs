/**
 * Sherivs content architecture — canonical content contracts.
 *
 * Every piece of public or organization content is a typed, schema-validated record.
 * Pages consume parsed records only; arbitrary data never becomes UI without passing
 * these schemas (Experience Constitution, "governed contracts").
 */
import { z } from "zod";

export const ContentStatusSchema = z.enum(["draft", "in_review", "published", "archived"]);
export type ContentStatus = z.infer<typeof ContentStatusSchema>;

export const ContentAccessSchema = z.enum(["public", "organization", "members", "internal"]);
export type ContentAccess = z.infer<typeof ContentAccessSchema>;

export const ContentKindSchema = z.enum([
  "page",
  "article",
  "blog_post",
  "guide",
  "case_study",
  "announcement",
  "changelog",
  "documentation",
  "faq",
  "glossary",
  "event",
  "program",
  "policy",
  "form",
  "media",
  "help",
  "release_note",
  "system_message",
]);
export type ContentKind = z.infer<typeof ContentKindSchema>;

const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "slug must be lowercase kebab-case");

export const ContentSeoSchema = z.object({
  title: z.string().min(1).max(70).optional(),
  description: z.string().min(50).max(170),
  canonicalPath: z.string().startsWith("/").optional(),
  socialImagePath: z.string().startsWith("/").optional(),
  noIndex: z.boolean().default(false),
});

export const ContentEntrySchema = z.object({
  kind: ContentKindSchema,
  slug,
  title: z.string().min(1).max(140),
  description: z.string().min(1).max(300),
  /** Markdown body. Rendering is the consumer's concern; the schema never executes it. */
  body: z.string().default(""),
  author: z.string().min(1).optional(),
  status: ContentStatusSchema,
  publishedAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  seo: ContentSeoSchema,
  tags: z.array(slug).default([]),
  categories: z.array(slug).default([]),
  locale: z
    .string()
    .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/u)
    .default("en"),
  access: ContentAccessSchema,
  /** Organization that owns the record; absent only for platform (Sherivs) content. */
  organizationRef: z.string().min(1).optional(),
});
export type ContentEntry = z.infer<typeof ContentEntrySchema>;

/** A published record must carry a publish date; drafts must never be public. */
export function isPubliclyRenderable(entry: ContentEntry): boolean {
  return entry.status === "published" && entry.access === "public" && !!entry.publishedAt;
}

/** Words-per-minute reading time, rounded up, never below one minute. */
export function readingTimeMinutes(body: string, wordsPerMinute = 220): number {
  const words = body.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

/** Registry entry for an indexable public route. */
export const PublicPageSchema = z.object({
  path: z.string().startsWith("/"),
  title: z.string().min(1).max(70),
  description: z.string().min(50).max(170),
  changefreq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  priority: z.number().min(0).max(1),
  indexable: z.boolean(),
});
export type PublicPage = z.infer<typeof PublicPageSchema>;
