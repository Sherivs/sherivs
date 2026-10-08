import { createFileRoute } from "@tanstack/react-router";
import { PlatformSlugPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/platform/reality")({
  component: () => <PlatformSlugPage slug="reality" />,
  head: () => ({
    meta: [
      { title: `Reality — ${PLATFORM_NAME}` },
      { name: "description", content: "Canonical organizational reality, separate from inference." },
    ],
  }),
});
