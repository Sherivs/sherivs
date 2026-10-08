import { createFileRoute } from "@tanstack/react-router";
import { SolutionsIndexPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/solutions")({
  component: SolutionsIndexPage,
  head: () => ({
    meta: [
      { title: `Solutions — ${PLATFORM_NAME}` },
      { name: "description", content: "How organizations use Sherivs without assuming a single domain." },
    ],
  }),
});
