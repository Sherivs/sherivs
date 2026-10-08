import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";

/**
 * Public Privacy Policy page.
 *
 * PLACEHOLDER NOTICE: this page states Sherivs' actual data-handling
 * principles at the level the product currently implements (tenant isolation,
 * server-authoritative access, audit). It is not legal advice and must be
 * replaced with a formal legal privacy policy before regulated deployment.
 */

export const Route = createFileRoute("/(site)/privacy-policy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: `Privacy policy — ${PLATFORM_NAME}` },
      {
        name: "description",
        content: `How ${PLATFORM_NAME} handles organizational and personal data.`,
      },
      { property: "og:title", content: `Privacy policy — ${PLATFORM_NAME}` },
      { property: "og:type", content: "website" },
    ],
  }),
});

function PrivacyPage() {
  return (
    <section aria-labelledby="privacy-heading" className="border-b border-border">
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Legal
        </p>
        <h1
          id="privacy-heading"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Privacy policy
        </h1>

        <div className="mt-8 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-muted-foreground">
          PLACEHOLDER: this summary reflects the platform&apos;s implemented data-handling
          principles. A formal legal privacy policy must replace this page before regulated
          deployment.
        </div>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              Data belongs to organizations
            </h2>
            <p className="mt-2">
              Your organization&apos;s data — people, records, communications, documents — belongs
              to your organization. Sherivs processes it to operate the platform on your behalf.
            </p>
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Tenant isolation</h2>
            <p className="mt-2">
              Each organization&apos;s data is isolated at the database layer. Access is enforced by
              the platform, based on identity, role, and policy — not by the application interface
              alone.
            </p>
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Access & audit</h2>
            <p className="mt-2">
              Access to organizational data requires authenticated identity and explicit
              authorization. Important actions produce audit records: what happened, who did it, and
              under which authority.
            </p>
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">AI processing</h2>
            <p className="mt-2">
              AI capabilities operate on organizational data only within defined responsibilities,
              permissions, and verification boundaries. AI output is never silently treated as
              canonical truth.
            </p>
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Questions</h2>
            <p className="mt-2">
              Privacy questions can be sent to{" "}
              <a
                href="mailto:privacy@sherivs.com"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                privacy@sherivs.com
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
