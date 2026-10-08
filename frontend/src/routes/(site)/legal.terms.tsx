import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/legal/terms")({
  component: function SherivsPage() {
    return <EditorialPage id="controls" framed={false} />;
  },
  head: () => editorialHead("controls"),
});
