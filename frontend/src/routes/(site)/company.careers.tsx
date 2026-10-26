import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/company/careers")({
  component: CareersPage,
  head: () =>
    publicHead({
      title: "Careers",
      description: "Sherivs is not listing public openings on this site. You can still write to the team.",
      path: "/company/careers",
    }),
});

function CareersPage() {
  return (
    <MarketingPage
      eyebrow="Company"
      title="Careers"
      lead="There are no public job listings on this website."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/about", label: "Company" },
        { href: "/company/careers", label: "Careers" },
      ]}
    >
      <Section labelledBy="careers-body">
        <PageContainer className="max-w-3xl py-16 text-sm leading-relaxed text-sherivs-muted sm:text-base">
          <h2 id="careers-body" className="sr-only">
            Careers
          </h2>
          <p>
            If you want to work on institutional computing, write to{" "}
            <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.info}`}>
              {PUBLIC_CONTACTS.info}
            </a>
            . We will not invent roles, locations, or headcount to fill this page.
          </p>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
