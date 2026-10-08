import { createFileRoute } from "@tanstack/react-router";
import { EditorialPage, pageHead } from "@/components/sherivs/editorial-page";
import { publicPageById } from "@/lib/experience/public-pages";

const page = publicPageById("platform-reality");

export const Route = createFileRoute("/platform_/reality")({
  component: function SherivsPublicRoute() {
    return <EditorialPage page={page} />;
  },
  head: () => pageHead(page),
});
