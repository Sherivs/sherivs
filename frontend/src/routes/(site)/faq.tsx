import { createFileRoute } from "@tanstack/react-router";
import { FAQ_ITEMS } from "@/lib/public-site/faq";
import { faqJsonLd, publicHead } from "@/lib/public-site/seo";
import { JsonLd } from "@/components/public/json-ld";
import { FaqList } from "@/components/public/faq-list";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/faq")({
  component: FaqPage,
  head: () =>
    publicHead({
      title: "FAQs",
      description: "Answers about Sherivs, product availability, AI workers, digital twins, security, and onboarding.",
      path: "/faq",
    }),
});

function FaqPage() {
  return (
    <MarketingPage
      eyebrow="Resources"
      title="Frequently asked questions"
      lead="Direct links use #question-id. Answers stay inside what the product actually offers."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/faq", label: "FAQ" },
      ]}
    >
      <JsonLd
        data={faqJsonLd(FAQ_ITEMS.map((item) => ({ question: item.question, answer: item.answer })))}
      />
      <Section labelledBy="faq-body">
        <PageContainer className="py-16">
          <h2 id="faq-body" className="sr-only">
            Questions
          </h2>
          <FaqList />
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
