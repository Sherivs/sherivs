import { createFileRoute, notFound } from "@tanstack/react-router";
import { SiteView } from "@/components/website/site-view";
import { parseSiteSearch, siteHead } from "@/components/website/route-support";
import { getPublicSite } from "@/lib/website/public-site.functions";

/** One blog post on an organization website: /posts/<slug> (published and due posts only; tenant from host). */
export const Route = createFileRoute("/posts/$post")({
  validateSearch: parseSiteSearch,
  loaderDeps: ({ search }) => ({ school: search.school, lang: search.lang }),
  loader: async ({ deps, params }) => {
    const slug = params.post.toLowerCase().slice(0, 80);
    const res = await getPublicSite(deps.school, slug);
    if (!res.site) throw notFound();
    // Unknown, draft or scheduled post: the school's own "not found" page (its chrome, never platform branding).
    return { site: res.site, preview: res.preview, lang: deps.lang };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const d = loaderData;
    const h = siteHead(d.site, "news", d.lang, d.preview, d.site.post);
    return {
      meta: d.site.post ? h.meta : [...h.meta, { name: "robots", content: "noindex" }],
      links: h.links,
    };
  },
  component: PostPage,
});

function PostPage() {
  const d = Route.useLoaderData();
  return (
    <SiteView site={d.site} slug="news" lang={d.lang} preview={d.preview} post={d.site.post} />
  );
}
