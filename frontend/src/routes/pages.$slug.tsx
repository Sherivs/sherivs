import { createFileRoute, notFound } from "@tanstack/react-router";
import { SiteView } from "@/components/website/site-view";
import { parseSiteSearch, siteHead } from "@/components/website/route-support";
import { getPublicSite } from "@/lib/website/public-site.functions";

/** Inner pages of an organization website: /pages/<slug> on the school's domain or subdomain. */
export const Route = createFileRoute("/pages/$slug")({
  validateSearch: parseSiteSearch,
  loaderDeps: ({ search }) => ({ school: search.school, lang: search.lang }),
  loader: async ({ deps, params }) => {
    const res = await getPublicSite(deps.school);
    if (!res.site) throw notFound();
    return {
      site: res.site,
      preview: res.preview,
      lang: deps.lang,
      slug: params.slug.slice(0, 48),
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const h = siteHead(loaderData.site, loaderData.slug, loaderData.lang, loaderData.preview);
    return { meta: h.meta, links: h.links };
  },
  component: SitePage,
});

function SitePage() {
  const d = Route.useLoaderData();
  const h = siteHead(d.site, d.slug, d.lang, d.preview);
  return (
    <SiteView site={d.site} slug={d.slug} lang={d.lang} preview={d.preview} jsonLd={h.jsonLd} />
  );
}
