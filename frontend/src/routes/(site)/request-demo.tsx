import { createFileRoute } from "@tanstack/react-router";
import { RequestDemoPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/request-demo")({
  component: RequestDemoPage,
  head: () => ({
    meta: [
      { title: `Request a demo — ${PLATFORM_NAME}` },
      { name: "description", content: "Start on the real authentication and provisioning flows." },
    ],
  }),
});
