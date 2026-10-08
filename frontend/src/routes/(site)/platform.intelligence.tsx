import { createFileRoute } from "@tanstack/react-router";
import { PlatformSlugPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/platform/intelligence")({
  component: () => <PlatformSlugPage slug="intelligence" />,
  head: () => ({
    meta: [
      { title: `Intelligence — ${PLATFORM_NAME}` },
      { name: "description", content: "Jarvis and governed AI assistance." },
    ],
  }),
});
