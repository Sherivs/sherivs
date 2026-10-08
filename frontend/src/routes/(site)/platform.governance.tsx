import { createFileRoute } from "@tanstack/react-router";
import { PlatformSlugPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/platform/governance")({
  component: () => <PlatformSlugPage slug="governance" />,
  head: () => ({
    meta: [
      { title: `Governance — ${PLATFORM_NAME}` },
      { name: "description", content: "Authorization, evidence, audit and policy." },
    ],
  }),
});
