import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, editorialHead } from "@/components/sherivs/editorial-page";

export const Route = createFileRoute("/(site)/contact")({
  component: function SherivsPage() {
    return <EditorialPage id="contact" framed={false} />;
  },
  head: () => editorialHead("contact"),
});
