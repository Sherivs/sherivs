import { createFileRoute } from "@tanstack/react-router";
import { CompanyPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/company")({
  component: CompanyPage,
  head: () => ({
    meta: [
      { title: `Company — ${PLATFORM_NAME}` },
      { name: "description", content: "How the company is presented publicly." },
    ],
  }),
});
