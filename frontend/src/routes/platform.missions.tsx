import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/platform/missions")({
  component: function SherivsPage() {
    return <EditorialPage id="bounds" framed={true} />;
  },
  head: () => editorialHead("bounds"),
});
