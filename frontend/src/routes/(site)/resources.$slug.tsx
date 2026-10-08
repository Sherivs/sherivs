import { createFileRoute, notFound } from "@tanstack/react-router";
import { ResourceSlugPage } from "@/components/experience/public-pages";
import { isResourceSlug, publicRouteByPath } from "@/lib/experience/public-catalog";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/resources/$slug")({
  component: ResourceSlugRoute,
  loader: ({ params }) => {
    if (!isResourceSlug(params.slug)) throw notFound();
    return { slug: params.slug };
  },
  head: ({ loaderData }) => {
    const record = publicRouteByPath(`/resources/${loaderData?.slug ?? ""}`);
    return {
      meta: [
        { title: `${record?.title ?? "Resources"} — ${PLATFORM_NAME}` },
        { name: "description", content: record?.description ?? "" },
      ],
    };
  },
});

function ResourceSlugRoute() {
  const { slug } = Route.useLoaderData();
  return <ResourceSlugPage slug={slug} />;
}
