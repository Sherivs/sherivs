/**
 * Sherivs sitemap builder. Public platform pages come from the public page registry;
 * organization public sites are appended by the route from active tenant rows.
 */
import { platformUrl } from "@/lib/platform";
import { PUBLIC_PAGES } from "./site-map";

export interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

export function platformSitemapEntries(): SitemapEntry[] {
  return PUBLIC_PAGES.filter((page) => page.indexable).map((page) => ({
    path: page.path,
    changefreq: page.changefreq,
    priority: page.priority,
  }));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

export function buildSitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries.map((entry) =>
    [
      `  <url>`,
      `    <loc>${escapeXml(platformUrl(entry.path))}</loc>`,
      entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : null,
      entry.changefreq ? `    <changefreq>${entry.changefreq}</changefreq>` : null,
      entry.priority !== undefined ? `    <priority>${entry.priority.toFixed(1)}</priority>` : null,
      `  </url>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}
