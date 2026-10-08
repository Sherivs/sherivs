import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/platform/integrations")({
  component: function SherivsPage() {
    return <EditorialPage id="layers" framed={true} />;
  },
  head: () => editorialHead("layers"),
});
