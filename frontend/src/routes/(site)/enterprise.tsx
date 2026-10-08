import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/enterprise")({
  component: function SherivsPage() {
    return <EditorialPage id="guarantees" framed={false} />;
  },
  head: () => editorialHead("guarantees"),
});
