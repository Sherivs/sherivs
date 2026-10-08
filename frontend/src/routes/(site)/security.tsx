import { createFileRoute, Link } from "@tanstack/react-router";
import { EvidenceList, PageHeader, Section } from "@/components/sherivs/public-shell";
import { SECURITY_PRINCIPLES } from "@/lib/sherivs/public-content";
import { publicHead } from "@/lib/sherivs/page-head";

export const Route = createFileRoute("/(site)/security")({
  component: SecurityPage,
  head: () =>
    publicHead({
      path: "/security",
      title: "Security",
      description:
        "How Sherivs enforces tenant isolation in the database, layers authorization, treats AI output as untrusted and keeps an immutable audit trail.",
      breadcrumbs: true,
    }),
});

function SecurityPage() {
  return (
    <>
      <PageHeader
        path="/security"
        eyebrow="Security"
        title="Enforced below the interface, verified in the repository."
        lead="Each principle below names the part of the codebase that implements it. The interface is never the security boundary."
      />
      <Section id="principles" title="Principles">
        <ol className="grid">
          {SECURITY_PRINCIPLES.map((p, i) => (
            <li key={p.id} className="sv-rule grid gap-4 py-8 lg:grid-cols-12 lg:gap-8">
              <span className="sv-data sv-faint lg:col-span-1">{String(i + 1).padStart(2, "0")}</span>
              <div className="grid gap-2 lg:col-span-5">
                <h3 className="sv-h2">{p.title}</h3>
                <p className="sv-body sv-muted">{p.text}</p>
              </div>
              <div className="lg:col-span-6">
                <EvidenceList paths={p.evidence} />
              </div>
            </li>
          ))}
        </ol>
      </Section>
      <Section
        id="not-claimed"
        tone="ground"
        eyebrow="Not claimed"
        title="What this page does not assert."
        lead="Sherivs does not publish third-party certifications, audit reports or penetration-test results on this site, because none are recorded here. Nothing above should be read as one."
      >
        <p className="sv-small sv-muted">
          Ready to try it? <Link to="/auth" className="sv-link">Create an account</Link>.
        </p>
      </Section>
    </>
  );
}
