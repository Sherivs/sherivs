import { createFileRoute } from "@tanstack/react-router";
import { FAQ_ITEMS } from "@/lib/public-site/faq";
import { faqJsonLd, publicHead } from "@/lib/public-site/seo";
import { JsonLd } from "@/components/public/json-ld";
import { FaqAccordion } from "@/components/public/faq-accordion";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/faq")({
  component: FaqPage,
  head: () =>
    publicHead({
      title: "FAQs",
      description:
        "Answers about Sherivs Scholar, campuses, AI assistance, privacy, onboarding, and support.",
      path: "/faq",
    }),
});

function FaqPage() {
  return (
    <MarketingPage
      eyebrow="Resources"
      title="Frequently asked questions"
      lead="Direct links use #question-id. Answers stay inside what Sherivs Scholar actually offers."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/faq", label: "FAQ" },
      ]}
    >
      <JsonLd
        data={faqJsonLd(
          FAQ_ITEMS.map((item) => ({ question: item.question, answer: item.answer })),
        )}
      />
      <Section labelledBy="faq-body">
        <PageContainer className="py-16">
          <h2 id="faq-body" className="sr-only">
            Questions
          </h2>
          <FaqAccordion items={FAQ_ITEMS} />
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
