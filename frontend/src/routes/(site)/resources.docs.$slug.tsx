import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocumentPage } from "@/components/sherivs/editorial-page";
import { documentBySlug } from "@/lib/sherivs/pages";
import { PLATFORM_ORIGIN } from "@/lib/platform";

export const Route = createFileRoute("/(site)/resources/docs/$slug")({
  beforeLoad: ({ params }) => {
    if (!documentBySlug(params.slug)) throw notFound();
  },
  component: function DocRoute() {
    const { slug } = Route.useParams();
    return <DocumentPage slug={slug} />;
  },
  head: ({ params }) => {
    const doc = documentBySlug(params.slug);
    if (!doc) return { meta: [{ title: "Not found — Sherivs" }] };
    return {
      meta: [
        { title: `${doc.title} — Sherivs` },
        { name: "description", content: doc.description },
        { property: "og:title", content: `${doc.title} — Sherivs` },
        { property: "og:description", content: doc.description },
        { property: "og:type", content: "article" },
        { property: "og:url", content: `${PLATFORM_ORIGIN}${doc.path}` },
      ],
      links: [{ rel: "canonical", href: `${PLATFORM_ORIGIN}${doc.path}` }],
    };
  },
});
