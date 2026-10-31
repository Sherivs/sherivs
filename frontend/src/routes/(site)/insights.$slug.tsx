import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { articleBySlug, publishedArticles, type PublicArticle } from "@/lib/public-site/articles";
import { publicHead, articleJsonLd } from "@/lib/public-site/seo";
import { JsonLd } from "@/components/public/json-ld";
import { Breadcrumbs, GlassPanel, PageContainer } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/insights/$slug")({
  loader: ({ params }) => {
    const article = articleBySlug(params.slug);
    if (!article) throw notFound();
    if (!article.published) throw redirect({ to: "/insights" });
    return { article };
  },
  head: ({ loaderData }) => {
    const article = loaderData?.article;
    if (!article)
      return publicHead({
        title: "Insights",
        description: "Article",
        path: "/insights",
        noindex: true,
      });
    return publicHead({
      title: article.seoTitle,
      description: article.seoDescription,
      path: `/insights/${article.slug}`,
      ogType: "article",
    });
  },
  component: InsightArticle,
});

function InsightArticle() {
  const { article } = Route.useLoaderData() as { article: PublicArticle };
  const related = article.relatedSlugs
    .map((slug) => publishedArticles().find((item) => item.slug === slug))
    .filter(Boolean);

  return (
    <article>
      <JsonLd
        data={articleJsonLd({
          title: article.title,
          summary: article.summary,
          path: `/insights/${article.slug}`,
          publishedAt: article.publishedAt,
          updatedAt: article.updatedAt,
        })}
      />
      <PageContainer className="py-8">
        <Breadcrumbs
          items={[
            { href: "/", label: "Home" },
            { href: "/insights", label: "Insights" },
            { href: `/insights/${article.slug}`, label: article.title },
          ]}
        />
        <GlassPanel enter className="mx-auto mt-8 max-w-3xl px-6 py-10 sm:px-10 sm:py-14">
          <p className="sherivs-kicker">{article.category}</p>
          <h1 className="sherivs-display sherivs-enter-2 mt-3 max-w-3xl text-3xl font-bold sm:text-4xl">
            {article.title}
          </h1>
          <p className="sherivs-enter-3 mt-4 max-w-2xl text-sm text-sherivs-muted">
            {article.author.name} · {article.author.role} · Published {article.publishedAt}
            {article.updatedAt !== article.publishedAt ? ` · Updated ${article.updatedAt}` : ""}
          </p>
          <p className="sherivs-enter-3 mt-6 max-w-2xl text-base leading-relaxed text-sherivs-muted">
            {article.summary}
          </p>
        </GlassPanel>
        <GlassPanel className="mx-auto mt-6 max-w-[var(--sherivs-prose)] space-y-8">
          {article.sections.map((section, index) => (
            <section key={section.heading ?? index}>
              {section.heading ? (
                <h2 className="font-display text-xl font-semibold">{section.heading}</h2>
              ) : null}
              {section.paragraphs.map((paragraph) => (
                <p
                  key={paragraph}
                  className="mt-3 text-sm leading-relaxed text-sherivs-muted sm:text-base"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
          {related.length ? (
            <aside>
              <h2 className="font-display text-lg font-semibold">Related</h2>
              <ul className="mt-3 grid gap-2">
                {related.map((item) =>
                  item ? (
                    <li key={item.slug}>
                      <Link
                        to="/insights/$slug"
                        params={{ slug: item.slug }}
                        className="text-sherivs-cyan underline-offset-4 hover:underline"
                      >
                        {item.title}
                      </Link>
                    </li>
                  ) : null,
                )}
              </ul>
            </aside>
          ) : null}
        </GlassPanel>
      </PageContainer>
    </article>
  );
}
