import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";

/**
 * Public Terms of Service page.
 *
 * PLACEHOLDER NOTICE: this page summarizes the platform's operating terms at
 * the level the product currently implements. It is not legal advice and must
 * be replaced with formal legal terms before regulated deployment.
 */

export const Route = createFileRoute("/(site)/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: `Terms of service — ${PLATFORM_NAME}` },
      {
        name: "description",
        content: `The terms under which organizations use the ${PLATFORM_NAME} platform.`,
      },
      { property: "og:title", content: `Terms of service — ${PLATFORM_NAME}` },
      { property: "og:type", content: "website" },
    ],
  }),
});

function TermsPage() {
  return (
    <section aria-labelledby="terms-heading" className="border-b border-border">
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Legal
        </p>
        <h1
          id="terms-heading"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Terms of service
        </h1>

        <div className="mt-8 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-muted-foreground">
          PLACEHOLDER: this summary reflects the platform&apos;s operating principles. Formal legal
          terms of service must replace this page before regulated deployment.
        </div>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">The service</h2>
            <p className="mt-2">
              {PLATFORM_NAME} provides an intelligent operating platform for organizations,
              delivered as a cloud-hosted environment provisioned per organization.
            </p>
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Accounts & authority
            </h2>
            <p className="mt-2">
              An organization&apos;s administrator is responsible for the accounts, roles, and
              policies configured within its workspace. Access to organizational data is governed by
              the platform&apos;s authorization model — identity, role, and policy.
            </p>
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">AI capabilities</h2>
            <p className="mt-2">
              AI capabilities operate within defined responsibilities, permissions, and verification
              boundaries. Critical actions require validation before execution; AI output does not
              replace organizational judgment or override canonical records.
            </p>
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Your data</h2>
            <p className="mt-2">
              Your organization&apos;s data belongs to your organization. On termination of the
              service, provisions for data export and deletion apply.
            </p>
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Questions</h2>
            <p className="mt-2">
              Terms questions can be sent to{" "}
              <a
                href="mailto:legal@sherivs.com"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                legal@sherivs.com
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
