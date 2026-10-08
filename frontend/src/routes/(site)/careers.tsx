import { createFileRoute } from "@tanstack/react-router";
import { CareersPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/careers")({
  component: CareersPage,
  head: () => ({
    meta: [
      { title: `Careers — ${PLATFORM_NAME}` },
      { name: "description", content: "Open roles. None are listed until they are published." },
    ],
  }),
});
