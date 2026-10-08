import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import {
  buildSitemapXml,
  platformSitemapEntries,
  type SitemapEntry,
} from "@/content/sherivs/sitemap";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const entries: SitemapEntry[] = platformSitemapEntries();

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
                priority: 0.8,
              });
            }
          }
        } catch {
          // sitemap should never fail the build — fall back to static entries
        }

        const xml = buildSitemapXml(entries);

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
