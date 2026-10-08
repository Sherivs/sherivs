import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/solutions/education")({
  component: function SherivsPage() {
    return <EditorialPage id="contract" framed={false} />;
  },
  head: () => editorialHead("contract"),
});
