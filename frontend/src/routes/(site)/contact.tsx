import { createFileRoute } from "@tanstack/react-router";
import { ContactPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/contact")({
  component: ContactPage,
  head: () => ({
    meta: [
      { title: `Contact — ${PLATFORM_NAME}` },
      { name: "description", content: "How to reach Sherivs through real account surfaces." },
    ],
  }),
});
