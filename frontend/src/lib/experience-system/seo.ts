/**
 * Sherivs SEO — head metadata for public routes, derived from the route
 * registry so titles, descriptions and canonicals cannot drift from navigation.
 */
import { SHERIVS_BRAND, canonicalUrl, pageTitle } from "./sherivs-brand";
import { PUBLIC_ROUTES } from "./public-routes";

export interface PublicHeadInput {
  readonly path: string;
  readonly title?: string;
  readonly description?: string;
  /** Set for pages that must not be indexed (e.g. an unknown content kind). */
  readonly noindex?: boolean;
}

type MetaTag = Record<string, string>;
type LinkTag = Record<string, string>;

export interface PublicHead {
  readonly meta: MetaTag[];
  readonly links: LinkTag[];
}

export function publicHead(input: PublicHeadInput): PublicHead {
  const entry = PUBLIC_ROUTES.find((r) => r.path === input.path);
  const rawTitle = input.title ?? entry?.title;
  const title = input.path === "/" ? pageTitle() : pageTitle(rawTitle);
  const description = input.description ?? entry?.description ?? SHERIVS_BRAND.description;
  const url = canonicalUrl(input.path);
  const meta: MetaTag[] = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: url },
    { property: "og:site_name", content: SHERIVS_BRAND.name },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
  if (input.noindex) meta.push({ name: "robots", content: "noindex" });
  return { meta, links: [{ rel: "canonical", href: url }] };
}
