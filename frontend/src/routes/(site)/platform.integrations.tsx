import { createFileRoute } from "@tanstack/react-router";
import { PlatformSlugPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/platform/integrations")({
  component: () => <PlatformSlugPage slug="integrations" />,
  head: () => ({
    meta: [
      { title: `Integrations — ${PLATFORM_NAME}` },
      { name: "description", content: "Provider adapters the platform actually wires." },
    ],
  }),
});
