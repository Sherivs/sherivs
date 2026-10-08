import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { SystemState } from "@/components/sherivs/states";
import { Container, DefinitionRows, SvLink } from "@/components/sherivs/primitives";
import {
  CONTENT_KIND_LABELS,
  PUBLIC_CONTENT_KINDS,
  PUBLISHED_CONTENT,
  contentPath,
  paginate,
  publicContent,
  type PublicContentKind,
} from "@/lib/experience-system/content";
import { publicHead } from "@/lib/experience-system/seo";

const PAGE_SIZE = 10;

function asKind(value: string): PublicContentKind | undefined {
  return PUBLIC_CONTENT_KINDS.find((k) => k === value);
}

export const Route = createFileRoute("/(site)/resources/$kind/")({
  validateSearch: (search: Record<string, unknown>): { page: number } => ({
    page: Math.max(1, Math.trunc(Number(search.page)) || 1),
  }),
  loader: ({ params }) => {
    const kind = asKind(params.kind);
    if (!kind) throw notFound();
    return kind;
  },
  head: ({ params }) => {
    const kind = asKind(params.kind);
    const empty = !kind || publicContent(PUBLISHED_CONTENT, new Date(), kind).length === 0;
    return publicHead({
      path: `/resources/${params.kind}`,
      title: kind ? CONTENT_KIND_LABELS[kind] : "Resources",
      description: kind ? `${CONTENT_KIND_LABELS[kind]} published by Sherivs.` : undefined,
      noindex: empty,
    });
  },
  component: KindPage,
});

function KindPage() {
  const kind = Route.useLoaderData();
  const { page } = Route.useSearch();

  const label = CONTENT_KIND_LABELS[kind];
  const all = publicContent(PUBLISHED_CONTENT, new Date(), kind);
  const paged = paginate(all, page, PAGE_SIZE);

  return (
    <>
      <PageTitle path={`/resources/${kind}`} currentLabel={label} eyebrow="Resources" title={label} />
      <Container className="py-12 sm:py-16">
        {all.length === 0 ? (
          <SystemState
            kind="empty"
            title={`No ${label.toLowerCase()} published yet`}
            description="Nothing in this category has been approved for publication."
          />
        ) : (
          <>
            <DefinitionRows
              rows={paged.items.map((i) => ({
                key: i.slug,
                term: (
                  <SvLink to={contentPath(i)} className="no-underline hover:underline">
                    {i.title}
                  </SvLink>
                ),
                detail: i.description,
              }))}
            />
            {paged.pageCount > 1 && (
              <nav aria-label="Pagination" className="mt-8 flex gap-4">
                {paged.page > 1 && (
                  <SvLink to={`/resources/${kind}`} search={{ page: paged.page - 1 }} className="text-sv-accent-text">
                    Newer
                  </SvLink>
                )}
                {paged.page < paged.pageCount && (
                  <SvLink to={`/resources/${kind}`} search={{ page: paged.page + 1 }} className="text-sv-accent-text">
                    Older
                  </SvLink>
                )}
              </nav>
            )}
          </>
        )}
      </Container>
    </>
  );
}
