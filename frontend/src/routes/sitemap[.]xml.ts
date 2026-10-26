import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { hostnameFromHostHeader } from "@/lib/experience/experience-host";
import { fetchPublicSite, siteTarget } from "@/lib/website/public-site.functions";
import { siteSitemapUrls } from "@/lib/website/seo";
import { PUBLIC_SITEMAP_PATHS } from "@/lib/public-site/navigation";
import { publishedArticles } from "@/lib/public-site/articles";
import { HELP_ARTICLES } from "@/lib/public-site/help";

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BASE_URL = "https://sherivs.com";

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Organization website host (custom domain or <slug>.sherivs.com): that site's own pages only.
        const host = hostnameFromHostHeader(
          request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
        );
        const { target, preview } = siteTarget(host, null);
        if (target && !preview) {
          let locs: string[] = [];
          try {
            const site = await fetchPublicSite(target);
            if (site) locs = siteSitemapUrls(site);
          } catch {
            locs = [];
          }
          const body = [
            `<?xml version="1.0" encoding="UTF-8"?>`,
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
            ...locs.map((l) => `  <url><loc>${xmlEscape(l)}</loc></url>`),
            `</urlset>`,
          ].join("\n");
          return new Response(body, {
            headers: {
              "Content-Type": "application/xml",
              "Cache-Control": "public, max-age=600",
              Vary: "Host",
            },
          });
        }
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/auth", changefreq: "monthly", priority: "0.3" },
          ...PUBLIC_SITEMAP_PATHS.filter((path) => path !== "/").map((path) => ({
            path,
            changefreq: "weekly" as const,
            priority: path === "/request-demo" ? "0.9" : "0.6",
          })),
          ...publishedArticles().map((article) => ({
            path: `/insights/${article.slug}`,
            changefreq: "monthly" as const,
            priority: "0.5",
          })),
          ...HELP_ARTICLES.map((article) => ({
            path: `/help/${article.slug}`,
            changefreq: "monthly" as const,
            priority: "0.4",
          })),
        ];

        // Organization sites live on their own hosts (each serves its own sitemap); list their roots here.
        try {
          const url = process.env.SUPABASE_URL;
          const key = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (url && key) {
            const sb = createClient(url, key, { auth: { persistSession: false } });
            const { data } = await sb
              .from("schools")
              .select("slug, updated_at")
              .eq("is_active", true);
            for (const row of (data ?? []) as Array<{ slug: string; updated_at: string | null }>) {
              entries.push({
                path: `https://${encodeURIComponent(row.slug)}.sherivs.com/`,
                lastmod: row.updated_at ?? undefined,
                changefreq: "weekly",
                priority: "0.8",
              });
            }
          }
        } catch {
          // sitemap should never fail the build — fall back to static entries
        }

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${xmlEscape(e.path.startsWith("https://") ? e.path : BASE_URL + e.path)}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
