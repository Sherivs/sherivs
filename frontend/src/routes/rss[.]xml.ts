import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { buildRss } from "@/lib/sherivs/content";
import { PUBLISHED_CONTENT } from "@/lib/sherivs/content-registry";

export const Route = createFileRoute("/rss.xml")({
  server: {
    handlers: {
      GET: async () =>
        new Response(buildRss(PUBLISHED_CONTENT), {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
