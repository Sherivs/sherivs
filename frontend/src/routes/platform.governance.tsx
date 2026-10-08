import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/platform/governance")({
  component: function SherivsPage() {
    return <EditorialPage id="states" framed={true} />;
  },
  head: () => editorialHead("states"),
});
