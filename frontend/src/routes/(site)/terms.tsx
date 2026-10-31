import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { publicHead } from "@/lib/public-site/seo";
import { LegalDocumentView } from "@/components/public/legal-document";

export const Route = createFileRoute("/(site)/terms")({
  component: () => <LegalDocumentView slug="/terms" />,
  head: () =>
    publicHead({
      title: `Terms of service — ${PLATFORM_NAME}`,
      description: `Terms for using ${PLATFORM_NAME}.`,
      path: "/terms",
    }),
});
