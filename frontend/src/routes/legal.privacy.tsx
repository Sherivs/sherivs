import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { DocPage, DocSection } from "@/components/sherivs/doc-page";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/legal/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Sherivs privacy notice" },
      {
        name: "description",
        content:
          "How Sherivs handles personal and organizational data: isolation, minimization, and administrator control.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/legal/privacy` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/legal/privacy` }],
  }),
});

function PrivacyPage() {
  return (
    <SherivsPublicShell>
      <DocPage
        title="Privacy notice"
        lead="Sherivs is built so that privacy is a platform property — enforced by isolation and authorization — not a promise kept by convention."
        updated="2026-10-08"
      >
        <DocSection heading="What data Sherivs holds">
          <p>
            Account identity (name, email, authentication factors), organization membership and
            roles, and the operational records your organization creates in its workspaces — people,
            calendars, communications, files, missions and audit entries.
          </p>
        </DocSection>
        <DocSection heading="Isolation by default">
          <p>
            Tenant data is isolated at the database layer with row-level security. One organization
            cannot read another&apos;s records, and members see only what their roles and the
            organization&apos;s policies entitle them to.
          </p>
        </DocSection>
        <DocSection heading="AI and your data">
          <p>
            Organizational data reaches AI systems only after identity, authorization,
            classification, purpose and minimization checks. AI output is labeled by kind —
            observation, inference, recommendation — and never silently overwrites canonical
            records.
          </p>
        </DocSection>
        <DocSection heading="What Sherivs does not do">
          <p>
            Sherivs does not sell personal or organizational data, does not use tenant records for
            advertising, and runs no third-party advertising trackers on authenticated surfaces.
          </p>
        </DocSection>
        <DocSection heading="Control and deletion">
          <p>
            Members manage their profile, preferences and sessions in account settings. Organization
            administrators manage membership and retention for their tenant; deletion requests flow
            through them, and expired or revoked access fails closed. Members of an organization
            should direct privacy questions to their administrator first — see{" "}
            <Link to="/contact" className="underline underline-offset-4">
              contact paths
            </Link>
            .
          </p>
        </DocSection>
      </DocPage>
    </SherivsPublicShell>
  );
}
