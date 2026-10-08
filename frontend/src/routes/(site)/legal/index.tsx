import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, Section } from "@/components/sherivs/public-shell";
import { StateView } from "@/components/sherivs/state-view";
import { publicHead } from "@/lib/sherivs/page-head";
import { withheldPublicRoutes } from "@/lib/sherivs/routes";

export const Route = createFileRoute("/(site)/legal/")({
  component: LegalIndex,
  head: () =>
    publicHead({
      path: "/legal",
      title: "Legal",
      description: "Sherivs legal and accessibility statements.",
      breadcrumbs: true,
    }),
});

function LegalIndex() {
  const pending = withheldPublicRoutes().filter((r) => r.path.startsWith("/legal/"));
  return (
    <>
      <PageHeader
        path="/legal"
        eyebrow="Legal"
        title="Legal and accessibility."
        lead="Only statements that have been written and approved are published here."
      />
      <Section id="published" title="Published">
        <ul className="grid">
          <li className="sv-rule py-5">
            <Link to="/legal/accessibility" className="sv-focusable grid gap-1">
              <span className="sv-h3">Accessibility statement</span>
              <span className="sv-small sv-muted">Our commitments, how they are tested, and known limitations.</span>
            </Link>
          </li>
        </ul>
      </Section>
      <Section id="pending" tone="ground" title="Not yet published">
        <StateView
          kind="empty"
          title="Policies awaiting approval"
          description={`${pending.map((p) => p.title).join(", ")} ${pending.length === 1 ? "has" : "have"} not been published. Legal text requires counsel approval and is not drafted by the product team.`}
        />
      </Section>
    </>
  );
}
