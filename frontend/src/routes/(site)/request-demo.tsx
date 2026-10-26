import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { publicHead } from "@/lib/public-site/seo";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { MarketingPage } from "@/components/public/marketing-page";
import { PageContainer, PublicButton, Section } from "@/components/public/ui";
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
      title="See Sherivs on your organization's reality"
      lead="Tell us about your organization. We will walk through how Sherivs would work for how you operate — including what is available today versus still in development."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/request-demo", label: "Request a demo" },
      ]}
    >
      <Section labelledBy="demo-form-heading">
        <PageContainer className="grid gap-8 py-16 lg:grid-cols-2">
          <div>
            <h2 id="demo-form-heading" className="font-display text-xl font-semibold">
              Email the Sherivs team
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-sherivs-muted">
              Direct address:{" "}
              <a className="text-sherivs-cyan underline-offset-4 hover:underline" href={`mailto:${PUBLIC_CONTACTS.hello}?subject=Demo%20request`}>
                {PUBLIC_CONTACTS.hello}
              </a>
            </p>
            <div className="mt-8 grid gap-4">
              <div className="rounded-[var(--sherivs-radius)] border border-[var(--sherivs-border)] p-5">
                <h3 className="font-display font-semibold">Start now</h3>
                <p className="mt-2 text-sm text-sherivs-muted">
                  The Sherivs team creates your organization&apos;s admin account. That admin then invites users by email.
                </p>
                <PublicButton href="/onboarding" variant="secondary" className="mt-3">
                  Request an admin account
                </PublicButton>
              </div>
              <div className="rounded-[var(--sherivs-radius)] border border-[var(--sherivs-border)] p-5">
                <h3 className="font-display font-semibold">Already a customer</h3>
                <p className="mt-2 text-sm text-sherivs-muted">Sign in to your workspace.</p>
                <Link
                  to="/auth"
                  className="mt-3 inline-flex rounded-md border border-[var(--sherivs-border-strong)] px-4 py-2 text-sm font-semibold hover:bg-white/5"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
          <MailtoForm kind="demo" />
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
