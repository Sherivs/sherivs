import { createFileRoute } from "@tanstack/react-router";
import { EnterprisePage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/enterprise")({
  component: EnterprisePage,
  head: () => ({
    meta: [
      { title: `Enterprise — ${PLATFORM_NAME}` },
      { name: "description", content: "How institutions adopt Sherivs." },
    ],
  }),
});
