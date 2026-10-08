/**
 * Head tags for public pages: title, description, canonical, Open Graph, Twitter,
 * and optional JSON-LD. Canonical URLs always derive from PUBLIC_ORIGIN — never
 * from the request, so a client cannot influence them.
 */
import { BRAND_DESCRIPTION, canonicalUrl, pageTitle } from "@/lib/sherivs/brand";
import { breadcrumbJsonLd, metaTags } from "@/lib/sherivs/content";
import { breadcrumbsFor } from "@/lib/sherivs/routes";

export interface PublicHeadInput {
  readonly path: string;
  readonly title?: string;
  readonly description?: string;
  readonly type?: "website" | "article";
  readonly jsonLd?: readonly object[];
  /** Adds a BreadcrumbList JSON-LD block derived from the route registry. */
  readonly breadcrumbs?: boolean;
}

export function publicHead(input: PublicHeadInput) {
  const canonical = canonicalUrl(input.path);
  const seo = {
    title: pageTitle(input.title),
    description: input.description ?? BRAND_DESCRIPTION,
    canonical,
  };
  const ld: object[] = [...(input.jsonLd ?? [])];
  if (input.breadcrumbs) ld.push(breadcrumbJsonLd(breadcrumbsFor(input.path)));
  return {
    meta: metaTags(seo, input.type ?? "website"),
    links: [{ rel: "canonical", href: canonical }],
    scripts: ld.map((json) => ({
      type: "application/ld+json",
      children: JSON.stringify(json).replace(/</g, "\\u003c"),
    })),
  };
}
