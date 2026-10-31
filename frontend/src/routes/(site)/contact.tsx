import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { publicHead } from "@/lib/public-site/seo";
import {
  COMPANY_LOCATION_LINE,
  EMAIL_ROUTING,
  MAIL_DELIVERY_NOTE,
} from "@/lib/public-site/company";
import { PUBLIC_CONTACTS, publishedCompanySocial } from "@/lib/public-site/contacts";
import { CompanySocialLinks } from "@/components/public/company-social-links";
import { MarketingPage } from "@/components/public/marketing-page";
import { GlassPanel, PageContainer, Section } from "@/components/public/ui";
import { MailtoForm } from "@/components/public/mailto-form";

export const Route = createFileRoute("/(site)/contact")({
  component: ContactPage,
  head: () =>
    publicHead({
      title: `Contact — ${PLATFORM_NAME}`,
      description:
        "Contact Sherivs Technologies Limited — general inquiries to info@sherivs.com, demos and partnerships to hello@sherivs.com, support to support@sherivs.com.",
      path: "/contact",
    }),
});

function ContactPage() {
  return (
    <MarketingPage
      eyebrow="Contact"
      title={`Talk to ${PLATFORM_NAME}`}
      lead={`${COMPANY_LOCATION_LINE}. Choose the mailbox that matches your inquiry. No invented offices or phone numbers.`}
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/contact", label: "Contact" },
      ]}
    >
      <Section labelledBy="contact-channels">
        <PageContainer className="grid gap-8 py-16 lg:grid-cols-2">
          <GlassPanel className="space-y-4">
            <h2 id="contact-channels" className="font-display text-xl font-semibold">
              Direct addresses
            </h2>
            <p className="text-sm text-sherivs-muted">
              General &amp; administration:{" "}
              <a
                className="text-sherivs-cyan underline-offset-4 hover:underline"
                href={`mailto:${PUBLIC_CONTACTS.info}`}
              >
                {PUBLIC_CONTACTS.info}
              </a>
              <span className="block mt-1">{EMAIL_ROUTING.info.purpose}.</span>
            </p>
            <p className="text-sm text-sherivs-muted">
              Demos, prospects, partnerships:{" "}
              <a
                className="text-sherivs-cyan underline-offset-4 hover:underline"
                href={`mailto:${PUBLIC_CONTACTS.hello}`}
              >
                {PUBLIC_CONTACTS.hello}
              </a>
              <span className="block mt-1">{EMAIL_ROUTING.hello.purpose}.</span>
            </p>
            <p className="text-sm text-sherivs-muted">
              Existing-customer support:{" "}
              <a
                className="text-sherivs-cyan underline-offset-4 hover:underline"
                href={`mailto:${PUBLIC_CONTACTS.support}`}
              >
                {PUBLIC_CONTACTS.support}
              </a>
              <span className="block mt-1">{EMAIL_ROUTING.support.purpose}.</span>
            </p>
            <p className="text-sm text-sherivs-muted">{MAIL_DELIVERY_NOTE}</p>
            {publishedCompanySocial().length > 0 ? (
              <div className="space-y-2 pt-2">
                <h3 className="font-display text-base font-semibold">Public profiles</h3>
                <CompanySocialLinks variant="list" />
              </div>
            ) : null}
          </GlassPanel>
          <MailtoForm kind="contact" />
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
