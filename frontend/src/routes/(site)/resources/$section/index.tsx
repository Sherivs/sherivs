import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { PageHeader, Section } from "@/components/sherivs/public-shell";
import { StateView } from "@/components/sherivs/state-view";
import {
  CONTENT_SECTIONS,
  SECTION_META,
  contentPath,
  paginate,
  readingTimeMinutes,
  visibleItems,
  type ContentSection,
} from "@/lib/sherivs/content";
import { PUBLISHED_CONTENT } from "@/lib/sherivs/content-registry";
import { publicHead } from "@/lib/sherivs/page-head";

const Search = z.object({
  page: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
  tag: z.string().max(60).optional().catch(undefined),
});

function isSection(value: string): value is ContentSection {
  return (CONTENT_SECTIONS as readonly string[]).includes(value);
}

export const Route = createFileRoute("/(site)/resources/$section/")({
  validateSearch: Search,
  beforeLoad: ({ params }) => {
    if (!isSection(params.section)) throw notFound();
  },
  head: ({ params }) =>
    isSection(params.section)
      ? publicHead({
          path: `/resources/${params.section}`,
          title: SECTION_META[params.section].title,
          description: SECTION_META[params.section].description,
          breadcrumbs: true,
        })
      : {},
  component: SectionPage,
  notFoundComponent: () => (
    <div className="sv-page-wide py-24">
      <StateView
        kind="notFound"
        title="No such section"
        description="That resources section does not exist."
        actions={
          <Link to="/resources" className="sv-btn">
            All resources
          </Link>
        }
      />
    </div>
  ),
});

function SectionPage() {
  const { section } = Route.useParams() as { section: ContentSection };
  const { page, tag } = Route.useSearch();
  const meta = SECTION_META[section];
  const all = visibleItems(PUBLISHED_CONTENT, section);
  const tags = [...new Set(all.flatMap((i) => i.tags))].sort();
  const filtered = tag ? all.filter((i) => i.tags.includes(tag)) : all;
  const paged = paginate(filtered, page ?? 1, 10);

  return (
    <>
      <PageHeader path={`/resources/${section}`} eyebrow="Resources" title={meta.title} lead={meta.description} />
      <Section id="entries" title={tag ? `Tagged “${tag}”` : "Published"}>
        {tags.length > 1 ? (
          <ul aria-label="Filter by tag" className="flex flex-wrap gap-2">
            <li>
              <Link
                to="/resources/$section"
                params={{ section }}
                search={{}}
                className="sv-btn"
                aria-current={!tag ? "true" : undefined}
              >
                All
              </Link>
            </li>
            {tags.map((t) => (
              <li key={t}>
                <Link
                  to="/resources/$section"
                  params={{ section }}
                  search={{ tag: t }}
                  className="sv-btn"
                  aria-current={tag === t ? "true" : undefined}
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {all.length === 0 ? (
          <StateView kind="empty" title={meta.emptyTitle} description={meta.emptyBody} />
        ) : paged.items.length === 0 ? (
          <StateView kind="empty" title="No entries with that tag" description="Try another tag or clear the filter." />
        ) : (
          <ul className="grid">
            {paged.items.map((item) => (
              <li key={item.slug} className="sv-rule">
                <Link to={contentPath(item)} className="sv-focusable grid gap-2 py-6">
                  <span className="sv-label sv-faint">
                    <time dateTime={item.publishedAt}>{item.publishedAt}</time> · {readingTimeMinutes(item)} min read
                  </span>
                  <span className="sv-h2">{item.title}</span>
                  <span className="sv-body sv-muted max-w-2xl">{item.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {paged.pageCount > 1 ? (
          <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
            {paged.page > 1 ? (
              <Link to="/resources/$section" params={{ section }} search={{ page: paged.page - 1, tag }} className="sv-btn">
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="sv-small sv-muted">
              Page {paged.page} of {paged.pageCount}
            </span>
            {paged.page < paged.pageCount ? (
              <Link to="/resources/$section" params={{ section }} search={{ page: paged.page + 1, tag }} className="sv-btn">
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </Section>
    </>
  );
}
