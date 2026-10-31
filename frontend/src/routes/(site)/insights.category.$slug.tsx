import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import {
  articlesByCategory,
  categoryFromSlug,
  categoryToSlug,
  type ArticleCategory,
  type PublicArticle,
} from "@/lib/public-site/articles";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/insights/category/$slug")({
  loader: ({ params }) => {
    const category = categoryFromSlug(params.slug);
    if (!category) throw notFound();
    const articles = articlesByCategory(category);
    if (articles.length === 0) throw redirect({ to: "/insights" });
    return { category, articles };
  },
  head: ({ loaderData }) =>
    publicHead({
      title: loaderData?.category ?? "Category",
      description: `Sherivs insights in ${loaderData?.category ?? "this category"}.`,
      path: `/insights/category/${loaderData ? categoryToSlug(loaderData.category) : ""}`,
    }),
  component: InsightCategory,
});

function InsightCategory() {
  const { category, articles } = Route.useLoaderData() as {
    category: ArticleCategory;
    articles: readonly PublicArticle[];
  };
  return (
    <MarketingPage
      eyebrow="Insights"
      title={category}
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/insights", label: "Insights" },
        { href: `/insights/category/${Route.useParams().slug}`, label: category },
      ]}
    >
      <Section labelledBy="cat-list">
        <PageContainer className="py-16">
          <h2 id="cat-list" className="sr-only">
            Articles in {category}
          </h2>
          {articles.length === 0 ? (
            <p className="text-sm text-sherivs-muted">
              No published articles in this category yet.
            </p>
          ) : (
            <ul className="sherivs-stagger grid gap-4">
              {articles.map((article) => (
                <li key={article.slug}>
                  <Link
                    to="/insights/$slug"
                    params={{ slug: article.slug }}
                    className="sherivs-glass-card block rounded-[var(--sherivs-radius)] p-5 transition-transform duration-[var(--sherivs-motion-fast)] hover:-translate-y-0.5"
                  >
                    <h3 className="font-display text-lg font-semibold">{article.title}</h3>
                    <p className="mt-2 text-sm text-sherivs-muted">{article.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
