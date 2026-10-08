import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, pageHead } from "@/components/sherivs/editorial-page";
import { publicPageById } from "@/lib/experience/public-pages";

const page = publicPageById("pricing");

export const Route = createFileRoute("/pricing")({
  component: function SherivsPublicRoute() {
    return <EditorialPage page={page} />;
  },
  head: () => pageHead(page),
});
