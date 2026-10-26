import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/legal/contact")({
  component: LegalContactPage,
  head: () =>
    publicHead({
      title: "Legal contact",
      description: "Contact Sherivs legal and privacy teams at verified email addresses.",
      path: "/legal/contact",
    }),
});

function LegalContactPage() {
  return (
    <MarketingPage
      eyebrow="Legal"
      title="Legal contact"
      lead="No invented registered addresses. Use the mailboxes we actually operate."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/legal/contact", label: "Legal contact" },
      ]}
    >
      <Section labelledBy="legal-mail">
        <PageContainer className="max-w-3xl space-y-3 py-16 text-sm text-sherivs-muted">
          <h2 id="legal-mail" className="sr-only">
            Addresses
          </h2>
          <p>
            Legal:{" "}
            <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.legal}`}>
              {PUBLIC_CONTACTS.legal}
            </a>
          </p>
          <p>
            Privacy:{" "}
            <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.privacy}`}>
              {PUBLIC_CONTACTS.privacy}
            </a>
          </p>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
