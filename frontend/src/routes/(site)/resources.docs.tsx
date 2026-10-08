import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/resources/docs")({
  component: function SherivsPage() {
    return <EditorialPage id="shelves" framed={false} />;
  },
  head: () => editorialHead("shelves"),
});
