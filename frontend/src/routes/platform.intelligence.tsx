import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/platform/intelligence")({
  component: function SherivsPage() {
    return <EditorialPage id="object" framed={true} />;
  },
  head: () => editorialHead("object"),
});
