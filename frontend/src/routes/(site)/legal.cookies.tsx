import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/legal/cookies")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Cookies — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.cookies.lead },
      { property: "og:title", content: "Cookies — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.cookies.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.cookies} />;
}
