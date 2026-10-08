import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/about")({
  component: function SherivsPage() {
    return <EditorialPage id="about" framed={false} />;
  },
  head: () => editorialHead("about"),
});
