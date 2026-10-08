import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { ExperienceEquation } from "@/components/sherivs/diagrams";
import { Container, DefinitionRows, LinkButton } from "@/components/sherivs/primitives";
import { publicHead } from "@/lib/experience-system/seo";

export const Route = createFileRoute("/(site)/solutions/organizations")({
  component: OrganizationsSolution,
  head: () => publicHead({ path: "/solutions/organizations" }),
});

function OrganizationsSolution() {
  return (
    <>
      <PageTitle
        path="/solutions/organizations"
        eyebrow="Solutions · Organizations"
        plane="reality"
        title="A workspace that is derived, not drawn."
        lead="Each person gets a workspace projected from the roles and policies their organization defines. Nothing is forced on anyone: the organization composes the surfaces it actually uses."
      />
      <Container className="py-12 sm:py-16">
        <h2 className="sv-h2 mb-6">What you get</h2>
        <DefinitionRows
          rows={[
            {
              key: "tenant",
              term: "Your own tenant",
              detail:
                "Your organization's data is isolated from every other organization by the database itself, not only by application code.",
            },
            {
              key: "workspace",
              term: "Role-projected workspaces",
              detail:
                "Navigation and pages are generated from capabilities, roles and permissions. A person sees what their role allows and nothing more.",
            },
            {
              key: "public",
              term: "A generated public presence",
              detail:
                "Your organization's public site, manifest and installable app are generated from the same reality model, in your own brand colors.",
              note: "Brand colors are validated and contrast-adjusted so text on them stays readable.",
            },
            {
              key: "workforce",
              term: "A governed AI workforce",
              detail:
                "Workers with owners, scopes and lifecycles take on missions inside authority you grant, and their results are verified before they are accepted.",
            },
          ]}
        />
      </Container>
      <Container className="py-12 sm:py-16">
        <h2 className="sv-h2 mb-6">How a workspace is composed</h2>
        <ExperienceEquation />
      </Container>
      <Container className="pb-16 sm:pb-24">
        <div className="flex flex-wrap gap-3">
          <LinkButton to="/auth">Create account</LinkButton>
          <LinkButton to="/platform/governance" variant="secondary">
            How governance works
          </LinkButton>
        </div>
      </Container>
    </>
  );
}
