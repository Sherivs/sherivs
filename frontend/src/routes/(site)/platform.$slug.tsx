import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { Container, DefinitionRows, LinkButton, SvLink } from "@/components/sherivs/primitives";
import { platformPage, PLATFORM_PAGES } from "@/lib/experience-system/public-content";
import { publicHead } from "@/lib/experience-system/seo";

export const Route = createFileRoute("/(site)/platform/$slug")({
  loader: ({ params }) => {
    const page = platformPage(params.slug);
    if (!page) throw notFound();
    return page;
  },
  head: ({ params }) => {
    const page = platformPage(params.slug);
    return publicHead({
      path: `/platform/${params.slug}`,
      title: page?.title,
      description: page?.summary,
      noindex: !page,
    });
  },
  component: PlatformPartPage,
});

function PlatformPartPage() {
  const page = Route.useLoaderData();
  const related = page.related
    .map((slug) => PLATFORM_PAGES.find((p) => p.slug === slug))
    .filter((p): p is (typeof PLATFORM_PAGES)[number] => p !== undefined);

  return (
    <>
      <PageTitle
        path={`/platform/${page.slug}`}
        eyebrow={`Platform · ${page.title}`}
        plane={page.plane}
        title={page.summary}
        lead={page.lead}
      />
      <Container className="py-12 sm:py-16">
        <h2 className="sv-h2 mb-6">How it works</h2>
        <DefinitionRows
          rows={page.principles.map((p, i) => ({
            key: String(i),
            term: p.title,
            detail: p.body,
            plane: page.plane,
          }))}
        />
      </Container>
      <Container className="pb-12 sm:pb-16">
        <section aria-labelledby="boundaries" className="border-l-2 border-sv-border-strong pl-6">
          <h2 id="boundaries" className="sv-h3">
            What this will not do
          </h2>
          <ul className="mt-4 grid gap-3 text-sv-text-muted">
            {page.boundaries.map((b) => (
              <li key={b} className="max-w-[68ch]">
                {b}
              </li>
            ))}
          </ul>
        </section>
      </Container>
      <Container className="pb-16 sm:pb-24">
        <nav aria-label="Related" className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="sv-label text-sv-text-subtle">Related</span>
          {related.map((r) => (
            <SvLink key={r.slug} to={`/platform/${r.slug}`} className="text-sv-accent-text">
              {r.title}
            </SvLink>
          ))}
          <LinkButton to="/platform" variant="ghost" className="ml-auto">
            All platform parts
          </LinkButton>
        </nav>
      </Container>
    </>
  );
}
