import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/platform/missions")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Missions — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.platformMissions.lead },
      { property: "og:title", content: "Missions — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.platformMissions.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.platformMissions} />;
}
