import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { DocPage, DocSection } from "@/components/sherivs/doc-page";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/legal/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Sherivs terms of use" },
      {
        name: "description",
        content:
          "The rules for using Sherivs: authority, acceptable use, AI limits, and availability.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/legal/terms` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/legal/terms` }],
  }),
});

function TermsPage() {
  return (
    <SherivsPublicShell>
      <DocPage
        title="Terms of use"
        lead="Sherivs is governed infrastructure. Using it means operating inside the authority your organization grants you — the platform enforces that, and these terms state it."
        updated="2026-10-08"
      >
        <DocSection heading="Authority">
          <p>
            Your organization administrator grants your membership, roles and permissions. You may
            act only within them; attempts beyond them fail closed and are auditable. Invitations,
            sessions and devices are part of your account security surface — keep them yours.
          </p>
        </DocSection>
        <DocSection heading="Acceptable use">
          <p>
            Do not attempt to access other tenants, escalate your own permissions, extract data
            beyond your authorization, interfere with platform integrity, or use Sherivs to harm,
            deceive or surveil people outside your lawful authority. Violations may lead to
            suspension by your administrator or the platform.
          </p>
        </DocSection>
        <DocSection heading="AI outputs are advisory">
          <p>
            AI workers and assistants produce labeled intelligence — observations, inferences,
            recommendations — not verified fact. Critical actions require human approval where
            policy demands it. Verify consequential outputs against canonical records before acting
            on them.
          </p>
        </DocSection>
        <DocSection heading="Availability and change">
          <p>
            Sherivs targets continuous availability and publishes live health at{" "}
            <Link to="/status" className="underline underline-offset-4">
              /status
            </Link>
            . Capabilities evolve under contracted governance; material changes to these terms will
            be dated on this page.
          </p>
        </DocSection>
      </DocPage>
    </SherivsPublicShell>
  );
}
