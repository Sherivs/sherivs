import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { hostnameFromHostHeader } from "@/lib/experience/experience-host";
import { fetchPublicSite, siteTarget } from "@/lib/website/public-site.functions";
import { siteIconSvg } from "@/lib/website/seo";

/** Monogram favicon in the school's brand colours, for sites without their own icon or logo. */
export const Route = createFileRoute("/site-icon.svg")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const host = hostnameFromHostHeader(
          request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
        );
        const url = new URL(request.url);
        const { target } = siteTarget(host, url.searchParams.get("school"));
        const site = target ? await fetchPublicSite(target).catch(() => null) : null;
        if (!site) return new Response("Not found", { status: 404 });
        return new Response(siteIconSvg(site), {
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
            "X-Content-Type-Options": "nosniff",
            Vary: "Host",
          },
        });
      },
    },
  },
});
