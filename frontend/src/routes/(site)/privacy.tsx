import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { publicHead } from "@/lib/public-site/seo";
import { LegalDocumentView } from "@/components/public/legal-document";

export const Route = createFileRoute("/(site)/privacy")({
  component: () => <LegalDocumentView slug="/privacy" />,
  head: () =>
    publicHead({
      title: `Privacy notice — ${PLATFORM_NAME}`,
      description: `How Sherivs Technologies Limited handles information about schools, staff, students, guardians, and website visitors.`,
      path: "/privacy",
    }),
});
