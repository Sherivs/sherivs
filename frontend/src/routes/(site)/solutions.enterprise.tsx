import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/solutions/enterprise")({
  component: function SherivsPage() {
    return <EditorialPage id="base" framed={false} />;
  },
  head: () => editorialHead("base"),
});
