import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { Container, DefinitionRows, LinkButton } from "@/components/sherivs/primitives";
import { SHERIVS_BRAND } from "@/lib/experience-system/sherivs-brand";
import { publicHead } from "@/lib/experience-system/seo";

export const Route = createFileRoute("/(site)/solutions/education")({
  component: EducationSolution,
  head: () => publicHead({ path: "/solutions/education" }),
});

function EducationSolution() {
  const scholar = SHERIVS_BRAND.products.scholar;
  return (
    <>
      <PageTitle
        path="/solutions/education"
        eyebrow={`Solutions · ${scholar.name}`}
        plane="action"
        title={`${scholar.name}: the education runtime on Sherivs.`}
        lead="A school inherits the platform's governed core — identity, tenancy, security, workspaces, AI — and brings only its own education domain. It is a runtime on Sherivs, not a separate product line."
      />
      <Container className="py-12 sm:py-16">
        <h2 className="sv-h2 mb-6">What Scholar provides today</h2>
        <DefinitionRows
          rows={[
            {
              key: "site",
              term: "School public site",
              detail:
                "Each school has a public site with news, events, a blog and admissions, served on its own subdomain in its own brand colors.",
            },
            {
              key: "roles",
              term: "Role workspaces",
              detail:
                "Administrators, bursars, teachers, parents, students and drivers each get a workspace projected from their role.",
            },
            {
              key: "admissions",
              term: "Admissions",
              detail: "A public admissions flow that feeds the school's own records.",
            },
            {
              key: "payments",
              term: "Payments and receipts",
              detail:
                "Fee payments and receipts with signature validation, idempotency and an audit trail on the server.",
            },
          ]}
        />
        <p className="sv-small mt-8 max-w-[68ch] text-sv-text-subtle">
          Remove Scholar and the Sherivs platform stays fully valid. The education vocabulary lives in the
          runtime layer, never in the platform.
        </p>
      </Container>
      <Container className="pb-16 sm:pb-24">
        <LinkButton to="/auth">Create account</LinkButton>
      </Container>
    </>
  );
}
