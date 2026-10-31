import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { MarketingPage } from "@/components/public/marketing-page";
import { GlassPanel, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/legal/contact")({
  component: LegalContactPage,
  head: () =>
    publicHead({
      title: "Legal contact",
      description:
        "Contact Sherivs Technologies Limited about legal and privacy questions at info@sherivs.com.",
      path: "/legal/contact",
    }),
});

function LegalContactPage() {
  return (
    <MarketingPage
      eyebrow="Legal"
      title="Legal contact"
      lead="No invented registered addresses or telephone numbers. Dedicated legal@ and privacy@ mailboxes have not been owner-confirmed."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/legal/contact", label: "Legal contact" },
      ]}
    >
      <Section labelledBy="legal-mail">
        <PageContainer className="py-16">
          <GlassPanel className="mx-auto max-w-3xl space-y-3 text-sm text-sherivs-muted">
            <h2 id="legal-mail" className="sr-only">
              Addresses
            </h2>
            <p>
              Legal and privacy:{" "}
              <a
                className="text-sherivs-cyan underline-offset-4 hover:underline"
                href={`mailto:${PUBLIC_CONTACTS.info}`}
              >
                {PUBLIC_CONTACTS.info}
              </a>
            </p>
          </GlassPanel>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
