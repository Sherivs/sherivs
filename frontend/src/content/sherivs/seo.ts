/**
 * Sherivs public SEO — route head metadata derived from the public page registry.
 *
 * A public route never hand-writes its title, description or canonical URL; it asks for
 * its registry entry, so the sitemap, navigation and page metadata cannot disagree.
 */
import { PLATFORM_NAME, PLATFORM_PAGE_DESCRIPTION, platformUrl } from "@/lib/platform";
import { findPublicPage } from "./site-map";

type MetaTag =
  | { title: string }
  | { name: string; content: string }
  | { property: string; content: string };

export interface PublicHead {
  meta: MetaTag[];
  links: { rel: string; href: string }[];
}

export function publicPageHead(path: string): PublicHead {
  const page = findPublicPage(path);
  if (!page) {
    throw new Error(`publicPageHead: ${path} is not registered in PUBLIC_PAGES`);
  }
  const url = platformUrl(page.path);
  const meta: MetaTag[] = [
    { title: page.title },
    { name: "description", content: page.description },
    { property: "og:title", content: page.title },
    { property: "og:description", content: page.description },
    { property: "og:url", content: url },
    { property: "og:type", content: "website" },
    { name: "twitter:title", content: page.title },
    { name: "twitter:description", content: page.description },
  ];
  if (!page.indexable) meta.push({ name: "robots", content: "noindex" });
  return { meta, links: [{ rel: "canonical", href: url }] };
}

/** schema.org Organization record for the Sherivs home page — facts only, no ratings or counts. */
export function organizationJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: PLATFORM_NAME,
    url: platformUrl("/"),
    description: PLATFORM_PAGE_DESCRIPTION,
  });
}
