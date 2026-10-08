import { createFileRoute, notFound } from "@tanstack/react-router";
import { LegalSlugPage } from "@/components/experience/public-pages";
import { isLegalSlug, publicRouteByPath } from "@/lib/experience/public-catalog";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/legal/$slug")({
  component: LegalSlugRoute,
  loader: ({ params }) => {
    if (!isLegalSlug(params.slug)) throw notFound();
    return { slug: params.slug };
  },
  head: ({ loaderData }) => {
    const record = publicRouteByPath(`/legal/${loaderData?.slug ?? ""}`);
    return {
      meta: [
        { title: `${record?.title ?? "Legal"} — ${PLATFORM_NAME}` },
        { name: "description", content: record?.description ?? "" },
      ],
    };
  },
});

function LegalSlugRoute() {
  const { slug } = Route.useLoaderData();
  return <LegalSlugPage slug={slug} />;
}
