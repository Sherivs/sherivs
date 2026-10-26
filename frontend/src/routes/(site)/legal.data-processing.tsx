import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { LegalDocumentView } from "@/components/public/legal-document";

export const Route = createFileRoute("/(site)/legal/data-processing")({
  component: () => <LegalDocumentView slug="/legal/data-processing" />,
  head: () =>
    publicHead({
      title: "Data-processing terms",
      description: "Placeholder for a future Sherivs data-processing addendum. Not in force.",
      path: "/legal/data-processing",
      noindex: true,
    }),
});
