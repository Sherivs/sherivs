import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { Container, DefinitionRows, SvLink } from "@/components/sherivs/primitives";
import { publicHead } from "@/lib/experience-system/seo";

export const Route = createFileRoute("/(site)/solutions/")({
  component: SolutionsOverview,
  head: () => publicHead({ path: "/solutions" }),
});

function SolutionsOverview() {
  return (
    <>
      <PageTitle
        path="/solutions"
        eyebrow="Solutions"
        title="The same governed kernel, shaped by what you run."
        lead="Sherivs does not ship a different product per industry. It adapts one platform to your organization's reality, and installs a domain runtime where one exists."
      />
      <Container className="py-12 sm:py-16">
        <h2 className="sv-h2 mb-6">Where Sherivs applies today</h2>
        <DefinitionRows
          rows={[
            {
              key: "organizations",
              plane: "reality",
              term: (
                <SvLink to="/solutions/organizations" className="no-underline hover:underline">
                  For organizations
                </SvLink>
              ),
              detail:
                "A capability-driven workspace and public presence generated from your organization's own reality, roles and permissions.",
            },
            {
              key: "education",
              plane: "action",
              term: (
                <SvLink to="/solutions/education" className="no-underline hover:underline">
                  Education — Sherivs Scholar
                </SvLink>
              ),
              detail:
                "The education runtime: school public sites, admissions, role workspaces and fee payments on the Sherivs kernel.",
            },
          ]}
        />
        <p className="sv-small mt-8 max-w-[68ch] text-sv-text-subtle">
          Other industries are not listed because no runtime exists for them yet. Pages are published only
          for capabilities that are real.
        </p>
      </Container>
    </>
  );
}
