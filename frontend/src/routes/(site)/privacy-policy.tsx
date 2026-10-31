import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { publicHead } from "@/lib/public-site/seo";
import { LegalDocumentView } from "@/components/public/legal-document";

export const Route = createFileRoute("/(site)/privacy-policy")({
  component: () => <LegalDocumentView slug="/privacy-policy" />,
  head: () =>
    publicHead({
      title: `Privacy policy — ${PLATFORM_NAME}`,
      description: `How ${PLATFORM_NAME} handles organizational and personal data.`,
      path: "/privacy-policy",
    }),
});
