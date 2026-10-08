import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/solutions")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Solutions — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.solutions.lead },
      { property: "og:title", content: "Solutions — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.solutions.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.solutions} />;
}
