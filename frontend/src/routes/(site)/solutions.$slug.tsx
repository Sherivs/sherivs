import { createFileRoute, notFound } from "@tanstack/react-router";
import { SolutionSlugPage } from "@/components/experience/public-pages";
import { isSolutionSlug, publicRouteByPath } from "@/lib/experience/public-catalog";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/solutions/$slug")({
  component: SolutionsSlugRoute,
  loader: ({ params }) => {
    if (!isSolutionSlug(params.slug)) throw notFound();
    return { slug: params.slug };
  },
  head: ({ loaderData }) => {
    const record = publicRouteByPath(`/solutions/${loaderData?.slug ?? ""}`);
    return {
      meta: [
        { title: `${record?.title ?? "Solutions"} — ${PLATFORM_NAME}` },
        { name: "description", content: record?.description ?? "" },
      ],
    };
  },
});

function SolutionsSlugRoute() {
  const { slug } = Route.useLoaderData();
  return <SolutionSlugPage slug={slug} />;
}
