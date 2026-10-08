import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";

/**
 * Public "Request a demo" page — the primary engagement path for prospective
 * organizations (Sherivs public onboarding journey, step 1).
 *
 * No fake submissions: the action is a real email link to the Sherivs team.
 * No demo credentials are exposed anywhere on this surface.
 */

export const Route = createFileRoute("/(site)/request-demo")({
  component: RequestDemoPage,
  head: () => ({
    meta: [
      { title: `Request a demo — ${PLATFORM_NAME}` },
      {
        name: "description",
        content:
          "Request a demo of Sherivs — the intelligent operating platform for organizations. Tell us about your organization and we'll show you how Sherivs would work for you.",
      },
      { property: "og:title", content: `Request a demo — ${PLATFORM_NAME}` },
      { property: "og:type", content: "website" },
    ],
  }),
});

function RequestDemoPage() {
  return (
    <section aria-labelledby="request-demo-heading" className="border-b border-border">
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Request a demo
        </p>
        <h1
          id="request-demo-heading"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          See Sherivs on your organization&apos;s reality
        </h1>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Tell us about your organization and we&apos;ll walk you through how Sherivs connects your
          people, knowledge, workflows, communications, data, and AI workforce into one intelligent
          operating environment.
        </p>

        <div className="mt-10 rounded-xl border border-border p-6">
          <h2 className="font-display text-lg font-semibold">Email the Sherivs team</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Write to us with a few lines about your organization — industry, size, and what you
            would like to run on Sherivs — and we&apos;ll schedule a walkthrough.
          </p>
          <a
            href="mailto:hello@sherivs.com?subject=Demo%20request"
            className="mt-4 inline-flex rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            hello@sherivs.com
          </a>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-5">
            <h2 className="font-display text-base font-semibold">Start now</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Create your organization&apos;s account and begin onboarding.
            </p>
            <Link
              to="/auth"
              className="mt-3 inline-flex rounded-md border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Create your organization
            </Link>
          </div>
          <div className="rounded-xl border border-border p-5">
            <h2 className="font-display text-base font-semibold">Already a customer</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Sign in to your organization&apos;s workspace.
            </p>
            <Link
              to="/auth"
              className="mt-3 inline-flex rounded-md border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
