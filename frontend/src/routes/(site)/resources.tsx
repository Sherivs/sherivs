import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/resources")({
  component: function SherivsPage() {
    return <EditorialPage id="resources" framed={false} />;
  },
  head: () => editorialHead("resources"),
});
