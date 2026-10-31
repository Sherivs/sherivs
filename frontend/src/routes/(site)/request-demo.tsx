import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { publicHead } from "@/lib/public-site/seo";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { MarketingPage } from "@/components/public/marketing-page";
import { GlassPanel, PageContainer, PublicButton, Section } from "@/components/public/ui";
import { MailtoForm } from "@/components/public/mailto-form";

export const Route = createFileRoute("/(site)/request-demo")({
  component: RequestDemoPage,
  head: () =>
    publicHead({
      title: `Request a demo — ${PLATFORM_NAME}`,
      description:
        "Request a demo of Sherivs. Tell us about your organization and we will show you what is actually available today.",
      path: "/request-demo",
    }),
});

function RequestDemoPage() {
  return (
    <MarketingPage
      eyebrow="Request a demo"
      title="See Sherivs Scholar with your school in mind"
      lead="Tell us about your school. We will walk through how Sherivs Scholar would work for how you operate — including what is available today."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/request-demo", label: "Request a demo" },
      ]}
    >
      <Section labelledBy="demo-form-heading">
        <PageContainer className="grid gap-8 py-16 lg:grid-cols-2">
          <div className="grid gap-4">
            <GlassPanel>
              <h2 id="demo-form-heading" className="font-display text-xl font-semibold">
                Email the Sherivs team
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-sherivs-muted">
                Direct address:{" "}
                <a
                  className="text-sherivs-cyan underline-offset-4 hover:underline"
                  href={`mailto:${PUBLIC_CONTACTS.hello}?subject=Demo%20request`}
                >
                  {PUBLIC_CONTACTS.hello}
                </a>
              </p>
            </GlassPanel>
            <GlassPanel>
              <h3 className="font-display font-semibold">Start now</h3>
              <p className="mt-2 text-sm text-sherivs-muted">
                The Sherivs team creates your organization&apos;s admin account. That admin then
                invites users by email.
              </p>
              <PublicButton href="/onboarding" variant="secondary" className="mt-3">
                Request an admin account
              </PublicButton>
            </GlassPanel>
            <GlassPanel>
              <h3 className="font-display font-semibold">Already a customer</h3>
              <p className="mt-2 text-sm text-sherivs-muted">Sign in to your workspace.</p>
              <PublicButton href="/auth" variant="secondary" className="mt-3">
                Sign in
              </PublicButton>
            </GlassPanel>
          </div>
          <MailtoForm kind="demo" />
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
