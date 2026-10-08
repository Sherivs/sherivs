import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { Container, DefinitionRows } from "@/components/sherivs/primitives";
import { publicHead } from "@/lib/experience-system/seo";
import { SECURITY_GUARANTEES } from "./-content/site-content";

export const Route = createFileRoute("/(site)/security")({
  component: SecurityPage,
  head: () => publicHead({ path: "/security" }),
});

function SecurityPage() {
  return (
    <>
      <PageTitle
        path="/security"
        eyebrow="Security"
        plane="evidence"
        title="Security enforced below the interface."
        lead="Security is continuous: observe, evaluate, decide, enforce, audit, re-evaluate. These guarantees are properties of the platform itself, not of any single application on it."
      />
      <Container className="py-12 sm:py-16">
        <h2 className="sv-h2 mb-6">What the platform commits to</h2>
        <DefinitionRows
          rows={SECURITY_GUARANTEES.map((g) => ({
            key: g.id,
            term: g.title,
            detail: g.description,
          }))}
        />
      </Container>
      <Container className="pb-16 sm:pb-24">
        <section aria-labelledby="not-claimed" className="border-l-2 border-sv-border-strong pl-6">
          <h2 id="not-claimed" className="sv-h3">
            What Sherivs does not claim
          </h2>
          <ul className="mt-4 grid max-w-[68ch] gap-3 text-sv-text-muted">
            <li>No compliance certification or independent audit is claimed on this site.</li>
            <li>No uptime figure is promised here. Live health is shown on the status page.</li>
            <li>
              A public vulnerability-disclosure channel has not been published yet, so none is listed rather
              than inventing one.
            </li>
          </ul>
        </section>
      </Container>
    </>
  );
}
