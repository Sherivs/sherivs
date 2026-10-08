import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/legal/privacy")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Privacy — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.privacy.lead },
      { property: "og:title", content: "Privacy — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.privacy.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.privacy} />;
}
