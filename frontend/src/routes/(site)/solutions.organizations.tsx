import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/solutions/organizations")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Organizations — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.solutionsOrganizations.lead },
      { property: "og:title", content: "Organizations — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.solutionsOrganizations.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.solutionsOrganizations} />;
}
