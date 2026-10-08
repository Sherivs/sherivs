import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/legal/accessibility")({
  component: function SherivsPage() {
    return <EditorialPage id="storage" framed={false} />;
  },
  head: () => editorialHead("storage"),
});
