import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/platform/reality")({
  component: function SherivsPage() {
    return <EditorialPage id="doc-reality" framed={true} />;
  },
  head: () => editorialHead("doc-reality"),
});
