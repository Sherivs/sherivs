import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/solutions/operations")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Operations — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.solutionsOperations.lead },
      { property: "og:title", content: "Operations — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.solutionsOperations.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.solutionsOperations} />;
}
