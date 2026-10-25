import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { hostnameFromHostHeader } from "@/lib/experience/experience-host";
import { fetchPublicSite, siteTarget } from "@/lib/website/public-site.functions";
import { siteRss } from "@/lib/website/seo";

/** RSS feed of an organization website's published posts (its own host only; no ?school= on feeds). */
export const Route = createFileRoute("/rss.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const host = hostnameFromHostHeader(
          request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
        );
        const { target, preview } = siteTarget(host, null);
        const site = target && !preview ? await fetchPublicSite(target).catch(() => null) : null;
        if (!site) return new Response("Not found", { status: 404 });
        return new Response(siteRss(site), {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
            Vary: "Host",
          },
        });
      },
    },
  },
});
