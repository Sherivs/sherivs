import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { DocPage, DocSection } from "@/components/sherivs/doc-page";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/request-demo")({
  component: RequestDemoPage,
  head: () => ({
    meta: [
      { title: "Request a Sherivs demo" },
      {
        name: "description",
        content:
          "See Sherivs on your organization's reality: how to start an evaluation, what it covers, and what happens next.",
      },
      { property: "og:title", content: "Request a Sherivs demo" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/request-demo` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/request-demo` }],
  }),
});

function RequestDemoPage() {
  return (
    <SherivsPublicShell>
      <DocPage
        title="Request a demo"
        lead="A Sherivs evaluation starts from your organization's reality — not from a slide deck. This page does not collect information into a void: every next step below is a real route."
        updated="2026-10-08"
      >
        <DocSection heading="What an evaluation covers">
          <p>
            Modeling one part of your organization on the platform: its people and roles, one
            operational workflow, and the evidence that workflow should produce. You will see
            capability-driven workspaces, the mission lifecycle, and governed AI assistance
            operating inside real authority boundaries.
          </p>
        </DocSection>
        <DocSection heading="Start now">
          <p>
            <Link to="/auth" className="underline underline-offset-4">
              Create an account
            </Link>{" "}
            to enter the platform today — evaluation tiers are available without negotiation. For a
            guided conversation first, bring this page to your leadership and then{" "}
            <Link to="/contact" className="underline underline-offset-4">
              follow the contact paths
            </Link>
            .
          </p>
        </DocSection>
        <DocSection heading="Before you decide">
          <p>
            Review{" "}
            <Link to="/security" className="underline underline-offset-4">
              security and governance
            </Link>
            ,{" "}
            <Link to="/pricing" className="underline underline-offset-4">
              pricing
            </Link>
            , and the{" "}
            <Link to="/platform" className="underline underline-offset-4">
              kernel detail
            </Link>
            . Sherivs makes no claim on this site it cannot show you inside the product.
          </p>
        </DocSection>
      </DocPage>
    </SherivsPublicShell>
  );
}
