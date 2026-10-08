import { createFileRoute } from "@tanstack/react-router";
import { SecurityPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/security")({
  component: SecurityPage,
  head: () => ({
    meta: [
      { title: `Security — ${PLATFORM_NAME}` },
      { name: "description", content: "Tenant isolation, authorization, audit and AI trust." },
    ],
  }),
});
