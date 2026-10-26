import { createFileRoute, Link } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { POSITIONING_TAGLINE } from "@/lib/public-site/company";
import { ARTICLE_CATEGORIES, categoryToSlug, publishedArticles } from "@/lib/public-site/articles";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section } from "@/components/public/ui";
import { Callout } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/insights/")({
  component: InsightsIndex,
  head: () =>
    publicHead({
      title: "Insights",
      description: `${POSITIONING_TAGLINE}. Essays on institutional computing, AI workforces, digital twins, and governed intelligence.`,
      path: "/insights",
    }),
});

function InsightsIndex() {
  const articles = publishedArticles();
  return (
    <MarketingPage
      eyebrow="Insights"
      title="Insights"
      lead={`${POSITIONING_TAGLINE}. Company essays on institutional computing, AI workforces, digital twins, and governed intelligence. Organization blogs remain on each tenant host at /blog.`}
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/insights", label: "Insights" },
      ]}
    >
      <Section labelledBy="article-index">
        <PageContainer className="space-y-8 py-16">
          <h2 id="article-index" className="sr-only">
            Articles
          </h2>
          <Callout title="Not a tenant blog">
            School and organization posts continue to live at /blog on their own sites. This index
            is the Sherivs company publication.
          </Callout>
          <ul className="flex flex-wrap gap-2 text-xs">
            {ARTICLE_CATEGORIES.map((category) => (
              <li key={category}>
                <Link
                  to="/insights/category/$slug"
                  params={{ slug: categoryToSlug(category) }}
                  className="rounded-full border border-[var(--sherivs-border)] px-3 py-1 text-sherivs-muted hover:text-sherivs-white"
                >
                  {category}
                </Link>
              </li>
            ))}
          </ul>
          <ul className="grid gap-4">
            {articles.map((article) => (
              <li key={article.slug}>
                <Link
                  to="/insights/$slug"
                  params={{ slug: article.slug }}
                  className="block rounded-[var(--sherivs-radius)] border border-[var(--sherivs-border)] p-5 hover:bg-white/5"
                >
                  <p className="text-xs uppercase tracking-widest text-sherivs-cyan">{article.category}</p>
                  <h3 className="mt-2 font-display text-lg font-semibold">{article.title}</h3>
                  <p className="mt-2 text-sm text-sherivs-muted">{article.summary}</p>
                  <p className="mt-3 text-xs text-sherivs-muted">
                    {article.publishedAt} · {article.author.name}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
