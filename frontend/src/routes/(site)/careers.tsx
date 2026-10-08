import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/careers")({
  component: function SherivsPage() {
    return <EditorialPage id="identity" framed={false} />;
  },
  head: () => editorialHead("identity"),
});
