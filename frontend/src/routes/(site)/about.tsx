import { createFileRoute } from "@tanstack/react-router";
import { AboutPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/about")({
  component: AboutPage,
  head: () => ({
    meta: [
      { title: `About — ${PLATFORM_NAME}` },
      { name: "description", content: "What Sherivs is." },
    ],
  }),
});
