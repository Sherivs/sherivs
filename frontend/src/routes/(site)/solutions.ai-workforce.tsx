import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/solutions/ai-workforce")({
  component: Page,
  head: () => ({
    meta: [
      { title: "AI Workforce — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.solutionsWorkforce.lead },
      { property: "og:title", content: "AI Workforce — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.solutionsWorkforce.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.solutionsWorkforce} />;
}
