import { createFileRoute, notFound } from "@tanstack/react-router";
import { SiteView } from "@/components/website/site-view";
import { parseSiteSearch } from "@/components/website/site-search";
import { getPublicSite } from "@/lib/website/public-site.functions";

/** Inner pages of an organization website: /pages/<slug> on the school's domain or subdomain. */
export const Route = createFileRoute("/pages/$slug")({
  validateSearch: parseSiteSearch,
  loaderDeps: ({ search }) => ({ school: search.school, lang: search.lang }),
  loader: async ({ deps, params }) => {
    const res = await getPublicSite(deps.school);
    if (!res.site) throw notFound();
    const slug = params.slug.slice(0, 48);
    const { siteHead } = await import("@/components/website/route-support");
    return {
      site: res.site,
      preview: res.preview,
      lang: deps.lang,
      slug,
      jsonLd: siteHead(res.site, slug, deps.lang, res.preview).jsonLd,
    };
  },
  head: async ({ loaderData }) => {
    if (!loaderData) return {};
    const { siteHead } = await import("@/components/website/route-support");
    const h = siteHead(loaderData.site, loaderData.slug, loaderData.lang, loaderData.preview);
    return { meta: h.meta, links: h.links };
  },
  component: SitePage,
});

function SitePage() {
  const d = Route.useLoaderData();
  return (
    <SiteView site={d.site} slug={d.slug} lang={d.lang} preview={d.preview} jsonLd={d.jsonLd} />
  );
}
