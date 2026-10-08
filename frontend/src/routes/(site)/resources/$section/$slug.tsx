import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Breadcrumbs } from "@/components/sherivs/public-shell";
import { ContentBody } from "@/components/sherivs/content-body";
import { StateView } from "@/components/sherivs/state-view";
import {
  CONTENT_SECTIONS,
  SECTION_META,
  articleJsonLd,
  contentPath,
  isPubliclyVisible,
  readingTimeMinutes,
  relatedItems,
  seoFor,
  type ContentItem,
  type ContentSection,
} from "@/lib/sherivs/content";
import { PUBLISHED_CONTENT } from "@/lib/sherivs/content-registry";
import { publicHead } from "@/lib/sherivs/page-head";

function find(section: string, slug: string): ContentItem | undefined {
  if (!(CONTENT_SECTIONS as readonly string[]).includes(section)) return undefined;
  return PUBLISHED_CONTENT.find((i) => i.section === section && i.slug === slug && isPubliclyVisible(i));
}

export const Route = createFileRoute("/(site)/resources/$section/$slug")({
  loader: ({ params }) => {
    const item = find(params.section, params.slug);
    if (!item) throw notFound();
    return { item };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { item } = loaderData;
    const seo = seoFor(item);
    return publicHead({
      path: contentPath(item),
      title: seo.title.replace(/ — Sherivs$/, ""),
      description: seo.description,
      type: "article",
      jsonLd: [articleJsonLd(item)],
      breadcrumbs: true,
    });
  },
  component: ArticlePage,
  notFoundComponent: () => (
    <div className="sv-page-wide py-24">
      <StateView
        kind="notFound"
        title="No such entry"
        description="That page does not exist, or has not been published."
        actions={
          <Link to="/resources" className="sv-btn">
            All resources
          </Link>
        }
      />
    </div>
  ),
});

function ArticlePage() {
  const { item } = Route.useLoaderData();
  const section = item.section as ContentSection;
  const related = relatedItems(PUBLISHED_CONTENT, item);
  return (
    <article className="sv-page-wide grid gap-10 py-10 sm:py-14" aria-labelledby="article-title">
      <Breadcrumbs
        trail={[
          { label: "Sherivs", href: "/" },
          { label: "Resources", href: "/resources" },
          { label: SECTION_META[section].title, href: `/resources/${section}` },
          { label: item.title },
        ]}
      />
      <header className="grid max-w-3xl gap-4">
        <p className="sv-label sv-faint">
          <time dateTime={item.publishedAt}>{item.publishedAt}</time> · {readingTimeMinutes(item)} min read
          {item.updatedAt !== item.publishedAt ? (
            <>
              {" "}
              · Updated <time dateTime={item.updatedAt}>{item.updatedAt}</time>
            </>
          ) : null}
        </p>
        <h1 id="article-title" className="sv-h1 sv-hero">
          {item.title}
        </h1>
        <p className="sv-body sv-muted text-lg">{item.description}</p>
      </header>
      <ContentBody blocks={item.body} />
      {related.length > 0 ? (
        <aside aria-labelledby="related-heading" className="sv-rule pt-8">
          <h2 id="related-heading" className="sv-h3">
            Related
          </h2>
          <ul className="mt-4 grid gap-3">
            {related.map((r) => (
              <li key={`${r.section}/${r.slug}`}>
                <Link to={contentPath(r)} className="sv-link">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </article>
  );
}
