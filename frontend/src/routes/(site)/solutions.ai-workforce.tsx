import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/solutions/ai-workforce")({
  component: function SherivsPage() {
    return <EditorialPage id="honest" framed={false} />;
  },
  head: () => editorialHead("honest"),
});
