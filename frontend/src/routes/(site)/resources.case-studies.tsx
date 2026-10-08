import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/resources/case-studies")({
  component: function SherivsPage() {
    return <EditorialPage id="cases" framed={false} />;
  },
  head: () => editorialHead("cases"),
});
