import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { LegalDocumentView } from "@/components/public/legal-document";

export const Route = createFileRoute("/(site)/legal/cookies")({
  component: () => <LegalDocumentView slug="/legal/cookies" />,
  head: () =>
    publicHead({
      title: "Cookie policy",
      description: "Draft cookie notice for the Sherivs public site.",
      path: "/legal/cookies",
      noindex: true,
    }),
});
