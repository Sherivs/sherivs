import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/solutions/education")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Education — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.solutionsEducation.lead },
      { property: "og:title", content: "Education — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.solutionsEducation.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.solutionsEducation} />;
}
