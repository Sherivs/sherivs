import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { DocPage, DocSection } from "@/components/sherivs/doc-page";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/security")({
  component: SecurityPage,
  head: () => ({
    meta: [
      { title: "Sherivs security and governance" },
      {
        name: "description",
        content:
          "How Sherivs keeps institutions isolated and accountable: tenant isolation in the database, layered authorization, immutable audit records, and policy-checked AI.",
      },
      { property: "og:title", content: "Sherivs security and governance" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/security` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/security` }],
  }),
});

function SecurityPage() {
  return (
    <SherivsPublicShell>
      <DocPage
        title="Security and governance"
        lead="Security in Sherivs is structural: enforced by the platform itself — in the database, in authorization, in audit — not by any single application running on it."
        updated="2026-10-08"
      >
        <DocSection heading="Tenant isolation">
          <p>
            Every request resolves a tenant before anything else. Tenant-sensitive data is isolated
            with PostgreSQL row-level security, so the database itself refuses cross-tenant reads —
            application code is never the only layer standing between one organization and another.
          </p>
        </DocSection>
        <DocSection heading="Layered authorization">
          <p>
            Access decisions combine identity, tenant, role, relationship to the resource, and
            policy. Roles grant membership; policies grant conditions; ownership grants scope.
            Interfaces may hide what you cannot touch, but enforcement always happens on the server.
          </p>
        </DocSection>
        <DocSection heading="Audit and evidence">
          <p>
            Consequential actions write immutable audit records: who acted, under which authority,
            on what, and when. Missions capture evidence at every step, and verification states are
            visible — not implied.
          </p>
        </DocSection>
        <DocSection heading="Governed AI">
          <p>
            Before organizational data reaches any model, the platform checks identity,
            authorization, classification, purpose and minimization. AI output is treated as
            untrusted: critical actions require validation, policy checks and approval before
            execution — then audit after it.
          </p>
        </DocSection>
        <DocSection heading="Sessions and recovery">
          <p>
            Authentication supports passwords, verification flows and organization invitation
            acceptance. Sessions can be reviewed and revoked from account security settings, and
            expired or revoked access fails closed.
          </p>
        </DocSection>
        <DocSection heading="Verify it yourself">
          <p>
            Platform health is public at{" "}
            <Link to="/status" className="underline underline-offset-4">
              /status
            </Link>
            , the kernel contracts behind these guarantees are described at{" "}
            <Link to="/platform" className="underline underline-offset-4">
              /platform
            </Link>
            , and data handling is covered in the{" "}
            <Link to="/legal/privacy" className="underline underline-offset-4">
              privacy notice
            </Link>
            .
          </p>
        </DocSection>
      </DocPage>
    </SherivsPublicShell>
  );
}
