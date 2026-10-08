import { createFileRoute } from "@tanstack/react-router";
import { PlatformSlugPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/platform/memory")({
  component: () => <PlatformSlugPage slug="memory" />,
  head: () => ({
    meta: [
      { title: `Memory — ${PLATFORM_NAME}` },
      { name: "description", content: "Scoped organizational memory and knowledge records." },
    ],
  }),
});
