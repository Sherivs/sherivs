import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { PlaneStack } from "@/components/sherivs/diagrams";
import { Container, DefinitionRows, LinkButton, SvLink } from "@/components/sherivs/primitives";
import { PLATFORM_PAGES } from "@/lib/experience-system/public-content";
import { publicHead } from "@/lib/experience-system/seo";

export const Route = createFileRoute("/(site)/platform/")({
  component: PlatformOverview,
  head: () => publicHead({ path: "/platform" }),
});

function PlatformOverview() {
  return (
    <>
      <PageTitle
        path="/platform"
        eyebrow="Platform"
        title="One governed platform, in seven parts."
        lead="Sherivs is built around four planes — Reality, Intelligence, Action, Evidence — and the governance that runs through all of them. Each part below is a property of the platform, not an add-on."
      />
      <Container className="grid gap-12 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <DefinitionRows
          rows={PLATFORM_PAGES.map((p) => ({
            key: p.slug,
            plane: p.plane,
            term: (
              <SvLink to={`/platform/${p.slug}`} className="no-underline hover:underline">
                {p.title}
              </SvLink>
            ),
            detail: p.summary,
          }))}
        />
        <aside aria-label="The four planes" className="lg:sticky lg:top-24 lg:self-start">
          <PlaneStack />
        </aside>
      </Container>
      <Container className="pb-16 sm:pb-24">
        <LinkButton to="/security" variant="secondary">
          Read the security model
          <ArrowRight aria-hidden="true" className="size-4" />
        </LinkButton>
      </Container>
    </>
  );
}
