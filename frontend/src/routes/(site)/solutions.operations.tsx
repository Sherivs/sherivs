import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/solutions/operations")({
  component: function SherivsPage() {
    return <EditorialPage id="scope" framed={false} />;
  },
  head: () => editorialHead("scope"),
});
