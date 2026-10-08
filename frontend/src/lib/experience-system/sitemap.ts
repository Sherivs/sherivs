/**
 * Sherivs public sitemap entries, derived from the route registry and the
 * published-content registry. A route appears only if it is LIVE; resources
 * appear only when something is actually published.
 */
import { LIVE_PUBLIC_ROUTES } from "./public-routes";
import { contentPath, publicContent, type ContentItem } from "./content";

export interface PublicSitemapEntry {
  readonly path: string;
  readonly lastmod?: string;
  readonly changefreq: "weekly" | "monthly" | "yearly";
  readonly priority: string;
}

export function buildPublicSitemapEntries(
  registry: readonly ContentItem[],
  now: Date,
): readonly PublicSitemapEntry[] {
  const published = publicContent(registry, now);
  const entries: PublicSitemapEntry[] = [];
  for (const route of LIVE_PUBLIC_ROUTES) {
    if (route.path === "/resources" && published.length === 0) continue;
    entries.push({
      path: route.path,
      changefreq: route.changefreq ?? "monthly",
      priority: (route.priority ?? 0.5).toFixed(1),
    });
  }
  for (const item of published) {
    entries.push({
      path: contentPath(item),
      lastmod: (item.updatedAt ?? item.publishedAt)?.slice(0, 10),
      changefreq: "monthly",
      priority: "0.5",
    });
  }
  return entries;
}
