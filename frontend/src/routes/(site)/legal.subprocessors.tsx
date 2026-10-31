import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { LegalDocumentView } from "@/components/public/legal-document";

export const Route = createFileRoute("/(site)/legal/subprocessors")({
  component: () => <LegalDocumentView slug="/legal/subprocessors" />,
  head: () =>
    publicHead({
      title: "Subprocessors",
      description: "No approved public subprocessors list is on file.",
      path: "/legal/subprocessors",
      noindex: true,
    }),
});
