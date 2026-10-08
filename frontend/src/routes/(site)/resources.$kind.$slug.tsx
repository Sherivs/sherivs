import { createFileRoute, notFound } from "@tanstack/react-router";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { Container, SvLink } from "@/components/sherivs/primitives";
import {
  CONTENT_KIND_LABELS,
  PUBLISHED_CONTENT,
  articleJsonLd,
  contentPath,
  findPublicContent,
  readingTimeMinutes,
  relatedContent,
  serializeJsonLd,
} from "@/lib/experience-system/content";
import { publicHead } from "@/lib/experience-system/seo";
import { asContentKind } from "./resources.$kind";

export const Route = createFileRoute("/(site)/resources/$kind/$slug")({
  loader: ({ params }) => {
    const kind = asContentKind(params.kind);
    const item = kind ? findPublicContent(PUBLISHED_CONTENT, new Date(), kind, params.slug) : undefined;
    if (!item) throw notFound();
    return item;
  },
  head: ({ params, loaderData }) =>
    publicHead({
      path: `/resources/${params.kind}/${params.slug}`,
      title: loaderData?.seo.title ?? loaderData?.title,
      description: loaderData?.seo.description ?? loaderData?.description,
      noindex: !loaderData,
    }),
  component: ArticlePage,
});

function ArticlePage() {
  const item = Route.useLoaderData();
  const related = relatedContent(PUBLISHED_CONTENT, new Date(), item);
  return (
    <>
      <PageTitle
        path={`/resources/${item.kind}/${item.slug}`}
        currentLabel={item.title}
        eyebrow={CONTENT_KIND_LABELS[item.kind]}
        title={item.title}
        lead={item.description}
      />
      <Container className="py-12 sm:py-16">
        <article className="sv-reading space-y-5">
          <p className="sv-small text-sv-text-subtle">
            {item.author.name}
            {item.publishedAt && (
              <>
                {" · "}
                <time dateTime={item.publishedAt}>{new Date(item.publishedAt).toDateString()}</time>
              </>
            )}
            {` · ${readingTimeMinutes(item.body)} min read`}
          </p>
          {item.body.map((p, i) => (
            <p key={i} className="text-sv-text">
              {p}
            </p>
          ))}
        </article>
        {related.length > 0 && (
          <nav aria-label="Related" className="mt-12 grid gap-2">
            <span className="sv-label text-sv-text-subtle">Related</span>
            {related.map((r) => (
              <SvLink key={`${r.kind}-${r.slug}`} to={contentPath(r)} className="text-sv-accent-text">
                {r.title}
              </SvLink>
            ))}
          </nav>
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd(item)) }}
        />
      </Container>
    </>
  );
}
