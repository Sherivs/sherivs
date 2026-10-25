import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { hostnameFromHostHeader } from "@/lib/experience/experience-host";
import { classifyTenantHost } from "@/lib/tenant";

/**
 * robots configuration (served dynamically; there is no static public/robots.txt so this route always wins).
 * Platform: sherivs.com. Internal operating surfaces (the
 * command centre, platform architecture pages, authenticated workspaces) are
 * excluded from indexing; the public company site is fully indexable.
 */

const BODY = [
  "User-agent: *",
  "Allow: /",
  "Disallow: /auth",
  "Disallow: /platform",
  "Disallow: /platform/org",
  "Disallow: /command-centre",
  "Disallow: /admin",
  "Disallow: /super-admin",
  "Disallow: /runtime",
  "Disallow: /marketplace",
  "Disallow: /reality",
  "",
  `Sitemap: https://sherivs.com/sitemap.xml`,
  "",
].join("\n");

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Organization websites (custom domain / subdomain) point crawlers at their own sitemap.
        const host = hostnameFromHostHeader(
          request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
        );
        const tenant = classifyTenantHost(host).kind !== "platform";
        // Organization websites get their own robots file: only the school's pages, its own sitemap and feed.
        const body = tenant
          ? [
              "User-agent: *",
              "Allow: /",
              "Disallow: /auth",
              "Disallow: /admin",
              "Disallow: /portal",
              "",
              `Sitemap: https://${host}/sitemap.xml`,
              "",
            ].join("\n")
          : BODY;
        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            Vary: "Host",
          },
        });
      },
    },
  },
});
