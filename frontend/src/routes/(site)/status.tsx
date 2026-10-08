import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/status")({
  component: function SherivsPage() {
    return <EditorialPage id="steps" framed={false} />;
  },
  head: () => editorialHead("steps"),
});
