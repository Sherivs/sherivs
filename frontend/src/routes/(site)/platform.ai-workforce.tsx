import { createFileRoute } from "@tanstack/react-router";
import { PlatformSlugPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/platform/ai-workforce")({
  component: () => <PlatformSlugPage slug="ai-workforce" />,
  head: () => ({
    meta: [
      { title: `AI workforce — ${PLATFORM_NAME}` },
      { name: "description", content: "Governed AI workers with identity, authority and evidence." },
    ],
  }),
});
