import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/solutions")({
  component: function SherivsPage() {
    return <EditorialPage id="live" framed={false} />;
  },
  head: () => editorialHead("live"),
});
