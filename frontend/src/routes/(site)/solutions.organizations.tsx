import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/solutions/organizations")({
  component: function SherivsPage() {
    return <EditorialPage id="classes" framed={false} />;
  },
  head: () => editorialHead("classes"),
});
