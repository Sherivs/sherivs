import { createFileRoute, Link } from "@tanstack/react-router";
import { HELP_CATEGORIES, listedHelpArticles } from "@/lib/public-site/help";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section, StatusBadge } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/help/")({
  component: HelpIndex,
  head: () =>
    publicHead({
      title: "Help center",
      description:
        "Getting started, accounts, organizations, Scholar, integrations, and troubleshooting — limited to implemented functionality.",
      path: "/help",
    }),
});

function HelpIndex() {
  return (
    <MarketingPage
      eyebrow="Help"
      title="Help center"
      lead="Only instructions that match implemented Scholar functionality."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/help", label: "Help" },
      ]}
    >
      <Section labelledBy="help-index">
        <PageContainer className="space-y-10 py-16">
          <h2 id="help-index" className="sr-only">
            Help categories
          </h2>
          {HELP_CATEGORIES.map((category) => {
            const articles = listedHelpArticles().filter(
              (article) => article.category === category,
            );
            if (!articles.length) return null;
            return (
              <div key={category}>
                <h3 className="font-display text-lg font-semibold">{category}</h3>
                <ul className="mt-3 grid gap-3">
                  {articles.map((article) => (
                    <li key={article.slug}>
                      <Link
                        to="/help/$slug"
                        params={{ slug: article.slug }}
                        className="sherivs-glass-card flex items-start justify-between gap-3 rounded-[var(--sherivs-radius)] p-4 transition-transform duration-[var(--sherivs-motion-fast)] hover:-translate-y-0.5"
                      >
                        <span>
                          <span className="font-medium">{article.title}</span>
                          <span className="mt-1 block text-sm text-sherivs-muted">
                            {article.summary}
                          </span>
                        </span>
                        <StatusBadge status={article.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
