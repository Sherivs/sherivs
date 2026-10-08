import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/legal/privacy")({
  component: function SherivsPage() {
    return <EditorialPage id="legal-privacy" framed={false} />;
  },
  head: () => editorialHead("legal-privacy"),
});
