import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/contact")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Contact — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.contact.lead },
      { property: "og:title", content: "Contact — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.contact.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.contact} />;
}
