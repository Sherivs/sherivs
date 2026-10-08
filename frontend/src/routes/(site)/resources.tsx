import { createFileRoute } from "@tanstack/react-router";
import { ResourcesIndexPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/resources")({
  component: ResourcesIndexPage,
  head: () => ({
    meta: [
      { title: `Resources — ${PLATFORM_NAME}` },
      { name: "description", content: "Documentation and publishing indexes." },
    ],
  }),
});
