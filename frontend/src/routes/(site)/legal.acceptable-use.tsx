import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { LegalDocumentView } from "@/components/public/legal-document";

export const Route = createFileRoute("/(site)/legal/acceptable-use")({
  component: () => <LegalDocumentView slug="/legal/acceptable-use" />,
  head: () =>
    publicHead({
      title: "Acceptable use",
      description: "Draft acceptable use policy for Sherivs. Pending legal review.",
      path: "/legal/acceptable-use",
      noindex: true,
    }),
});
