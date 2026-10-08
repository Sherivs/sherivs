import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/resources/blog")({
  component: function SherivsPage() {
    return <EditorialPage id="blog" framed={false} />;
  },
  head: () => editorialHead("blog"),
});
