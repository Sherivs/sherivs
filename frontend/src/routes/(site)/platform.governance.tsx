import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/platform/governance")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Governance — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.platformGovernance.lead },
      { property: "og:title", content: "Governance — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.platformGovernance.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.platformGovernance} />;
}
