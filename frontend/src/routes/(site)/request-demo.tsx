import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/request-demo")({
  component: function SherivsPage() {
    return <EditorialPage id="path" framed={false} />;
  },
  head: () => editorialHead("path"),
});
