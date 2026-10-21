import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { buildGeneratedSiteView } from "@/lib/surfaces/generated-site-view";
import { customTenantColors } from "@/lib/brand/tenant-colors";

const CACHE = "public, max-age=600";

/**
 * The web app manifest is SERVED, not shipped: it is generated from the
 * organization class (or a bound tenant's own brand when `?school=<slug>` is
 * given) by the same engine that renders the site, so shortcuts can never
 * disagree with navigation.
 *
 * Governance: an invalid manifest is never served. If validation fails, the
 * response degrades to a minimal, valid, brand-less manifest and says so in a
 * header, because an uninstallable manifest is a silent product failure.
 */
export const Route = createFileRoute("/manifest.webmanifest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const orgType = url.searchParams.get("class") ?? "school";
        const slug = url.searchParams.get("school");

        let brand: { name?: string; primaryColor?: string; secondaryColor?: string } = {};
        if (slug) {
          try {
            const supaUrl = process.env.SUPABASE_URL;
            const key = process.env.SUPABASE_PUBLISHABLE_KEY;
            if (supaUrl && key) {
              const sb = createClient(supaUrl, key, { auth: { persistSession: false } });
              const { data } = await sb
                .from("schools")
                .select("name, primary_color, secondary_color")
                .eq("slug", slug)
                .eq("is_active", true)
                .maybeSingle();
              const row = data as {
                name?: string;
                primary_color?: string | null;
                secondary_color?: string | null;
              } | null;
              if (row?.name) {
                brand = {
                  name: row.name,
                  primaryColor: customTenantColors(row.primary_color, row.secondary_color).primary ?? undefined,
                  secondaryColor: row.secondary_color ?? undefined,
                };
              }
            }
          } catch {
            // A manifest must never fail because a read failed — fall back to the class.
          }
        }

        const view = buildGeneratedSiteView({
          orgType,
          brand: brand.name ? brand : undefined,
          tenantId: slug,
        });

        if (!view.installable) {
          const fallback = buildGeneratedSiteView({ orgType: "school", tenantId: null });
          return new Response(JSON.stringify(fallback.manifest), {
            status: 200,
            headers: {
              "Content-Type": "application/manifest+json; charset=utf-8",
              "Cache-Control": CACHE,
              "x-sherivs-manifest": "fallback",
              // Former header name, kept for one release.
              "x-coregrid-manifest": "fallback",
            },
          });
        }

        return new Response(JSON.stringify(view.manifest), {
          status: 200,
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": CACHE,
            "x-sherivs-manifest": "generated",
            "x-sherivs-org-class": orgType,
            // Former header names, kept for one release.
            "x-coregrid-manifest": "generated",
            "x-coregrid-org-class": orgType,
          },
        });
      },
    },
  },
});
