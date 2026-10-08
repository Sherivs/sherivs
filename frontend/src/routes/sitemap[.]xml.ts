import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { BRAND } from "@/lib/experience/brand";
import { sitemapRoutes } from "@/lib/experience/route-architecture";

/** Canonical public origin. Organization sites are addressed with ?school=<slug>. */
const BASE_URL = BRAND.origin;

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        // Public plane: only LIVE, indexable routes declared in the route architecture.
        const entries: SitemapEntry[] = sitemapRoutes().map((route) => ({
          path: route.path,
          changefreq: route.path === "/" ? "weekly" : "monthly",
          priority: route.path === "/" ? "1.0" : route.primaryNav ? "0.8" : "0.6",
        }));
        entries.push({ path: "/auth", changefreq: "monthly", priority: "0.3" });

        // Tenant public sites, addressed via ?school=<slug>
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
                path: `/?school=${encodeURIComponent(row.slug)}`,
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
            `    <loc>${BASE_URL}${e.path}</loc>`,
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
