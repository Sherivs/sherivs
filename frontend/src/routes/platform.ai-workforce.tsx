import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/platform/ai-workforce")({
  component: function SherivsPage() {
    return <EditorialPage id="rule" framed={true} />;
  },
  head: () => editorialHead("rule"),
});
