import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/platform/memory")({
  component: function SherivsPage() {
    return <EditorialPage id="separate" framed={true} />;
  },
  head: () => editorialHead("separate"),
});
