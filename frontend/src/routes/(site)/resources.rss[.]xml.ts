import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { PUBLISHED_CONTENT, buildRssFeed } from "@/lib/experience-system/content";

export const Route = createFileRoute("/(site)/resources/rss.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildRssFeed(PUBLISHED_CONTENT, new Date()), {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        }),
    },
  },
});
