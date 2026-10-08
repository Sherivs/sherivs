import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/platform/memory")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Memory — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.platformMemory.lead },
      { property: "og:title", content: "Memory — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.platformMemory.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.platformMemory} />;
}
