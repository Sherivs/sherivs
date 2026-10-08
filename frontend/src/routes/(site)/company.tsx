import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/company")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Company — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.company.lead },
      { property: "og:title", content: "Company — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.company.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.company} />;
}
