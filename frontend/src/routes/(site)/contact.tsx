import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { publicHead } from "@/lib/public-site/seo";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section } from "@/components/public/ui";
import { MailtoForm } from "@/components/public/mailto-form";

export const Route = createFileRoute("/(site)/contact")({
  component: ContactPage,
  head: () =>
    publicHead({
      title: `Contact — ${PLATFORM_NAME}`,
      description: "Contact the Sherivs team — demos, product questions, and support.",
      path: "/contact",
    }),
});

function ContactPage() {
  return (
    <MarketingPage
      eyebrow="Contact"
      title={`Talk to ${PLATFORM_NAME}`}
      lead="No fabricated offices, phone numbers, or team pages. Use the addresses we actually operate."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/contact", label: "Contact" },
      ]}
    >
      <Section labelledBy="contact-channels">
        <PageContainer className="grid gap-8 py-16 lg:grid-cols-2">
          <div className="space-y-4">
            <h2 id="contact-channels" className="font-display text-xl font-semibold">
              Direct addresses
            </h2>
            <p className="text-sm text-sherivs-muted">
              Demos & sales:{" "}
              <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.sales}`}>
                {PUBLIC_CONTACTS.sales}
              </a>
            </p>
            <p className="text-sm text-sherivs-muted">
              Support:{" "}
              <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.support}`}>
                {PUBLIC_CONTACTS.support}
              </a>
            </p>
            <p className="text-sm text-sherivs-muted">
              The form opens your email client. It does not claim a ticket was created.
            </p>
          </div>
          <MailtoForm kind="contact" />
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
