import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { helpBySlug, type HelpArticle } from "@/lib/public-site/help";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { GlassPanel, PageContainer, Section, StatusBadge } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/help/$slug")({
  loader: ({ params }) => {
    const article = helpBySlug(params.slug);
    if (!article) throw notFound();
    if (article.listed === false) throw redirect({ to: "/help" });
    return { article };
  },
  head: ({ loaderData }) =>
    publicHead({
      title: loaderData?.article.title ?? "Help",
      description: loaderData?.article.summary ?? "Sherivs help",
      path: `/help/${loaderData?.article.slug ?? ""}`,
    }),
  component: HelpArticlePage,
});

function HelpArticlePage() {
  const { article } = Route.useLoaderData() as { article: HelpArticle };
  return (
    <MarketingPage
      eyebrow={article.category}
      title={article.title}
      lead={article.summary}
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/help", label: "Help" },
        { href: `/help/${article.slug}`, label: article.title },
      ]}
      actions={<StatusBadge status={article.status} />}
    >
      <Section labelledBy="help-body">
        <PageContainer className="py-16">
          <GlassPanel className="mx-auto max-w-[var(--sherivs-prose)] space-y-8">
            <h2 id="help-body" className="sr-only">
              Article
            </h2>
            {article.body.map((block, index) => (
              <div key={block.heading ?? index}>
                {block.heading ? (
                  <h3 className="font-display text-lg font-semibold">{block.heading}</h3>
                ) : null}
                {block.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="mt-2 text-sm leading-relaxed text-sherivs-muted sm:text-base"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            ))}
          </GlassPanel>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
