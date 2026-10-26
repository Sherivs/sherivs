import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { MarketingPage } from "@/components/public/marketing-page";
import { Callout, PageContainer, Section } from "@/components/public/ui";
import { MailtoForm } from "@/components/public/mailto-form";

export const Route = createFileRoute("/(site)/support")({
  component: SupportPage,
  head: () =>
    publicHead({
      title: "Support",
      description: "Contact Sherivs support. The public form opens your email client; it does not invent a ticket.",
      path: "/support",
    }),
});

function SupportPage() {
  return (
    <MarketingPage
      eyebrow="Support"
      title="Support"
      lead="Existing customers can write to support, or use in-workspace support where it is enabled."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/support", label: "Support" },
      ]}
    >
      <Section labelledBy="support-form-heading">
        <PageContainer className="grid gap-8 py-16 lg:grid-cols-2">
          <div>
            <h2 id="support-form-heading" className="font-display text-xl font-semibold">
              Email support
            </h2>
            <p className="mt-3 text-sm text-sherivs-muted">
              Direct address:{" "}
              <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.support}`}>
                {PUBLIC_CONTACTS.support}
              </a>
            </p>
            <div className="mt-6">
              <Callout title="No silent tickets">
                There is no public helpdesk API wired to this page. Submitting the form opens your
                mail client. Success means the message was handed to your mail app — not that a
                ticket exists until we receive it.
              </Callout>
            </div>
          </div>
          <MailtoForm kind="support" />
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
