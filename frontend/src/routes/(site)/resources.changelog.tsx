import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/resources/changelog")({
  component: function SherivsPage() {
    return <EditorialPage id="changelog" framed={false} />;
  },
  head: () => editorialHead("changelog"),
});
