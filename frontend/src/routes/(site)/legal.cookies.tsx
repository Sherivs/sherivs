import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/legal/cookies")({
  component: function SherivsPage() {
    return <EditorialPage id="use" framed={false} />;
  },
  head: () => editorialHead("use"),
});
