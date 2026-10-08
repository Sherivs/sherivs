import { createFileRoute } from "@tanstack/react-router";
import { PlatformSlugPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/platform/missions")({
  component: () => <PlatformSlugPage slug="missions" />,
  head: () => ({
    meta: [
      { title: `Missions — ${PLATFORM_NAME}` },
      { name: "description", content: "Governed work from proposal through verified outcome." },
    ],
  }),
});
