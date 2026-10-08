import { createFileRoute } from "@tanstack/react-router";
import { SherivsInteriorPage } from "@/components/sherivs-public/interior";
import { PUBLIC_PAGES } from "./-content/pages";

export const Route = createFileRoute("/(site)/request-demo")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Request a demo — Sherivs" },
      { name: "description", content: PUBLIC_PAGES.requestDemo.lead },
      { property: "og:title", content: "Request a demo — Sherivs" },
      { property: "og:description", content: PUBLIC_PAGES.requestDemo.lead },
      { property: "og:type", content: "website" },
    ],
  }),
});

function Page() {
  return <SherivsInteriorPage page={PUBLIC_PAGES.requestDemo} />;
}
