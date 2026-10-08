import { createFileRoute } from "@tanstack/react-router";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { Container, DefinitionRows } from "@/components/sherivs/primitives";
import { publicHead } from "@/lib/experience-system/seo";

export const Route = createFileRoute("/(site)/legal/accessibility")({
  component: AccessibilityPage,
  head: () => publicHead({ path: "/legal/accessibility" }),
});

function AccessibilityPage() {
  return (
    <>
      <PageTitle
        path="/legal/accessibility"
        eyebrow="Accessibility"
        title="Accessibility commitments and current status."
        lead="Sherivs targets WCAG 2.2 level AA for its own interface. This page states what is built and verified, and what is not yet."
      />
      <Container className="py-12 sm:py-16">
        <h2 className="sv-h2 mb-6">Built and automatically checked</h2>
        <DefinitionRows
          rows={[
            {
              key: "contrast",
              term: "Color contrast",
              detail:
                "Design tokens for text and interactive color are checked against WCAG contrast ratios in light, dark and high-contrast themes on every test run. Organization brand colors are adjusted so text on them stays readable.",
            },
            {
              key: "keyboard",
              term: "Keyboard and focus",
              detail:
                "A skip link is the first focusable element, focus is always visible, and navigation menus are built on accessible primitives.",
            },
            {
              key: "motion",
              term: "Reduced motion",
              detail: "Animation is disabled or reduced when the system prefers reduced motion.",
            },
            {
              key: "semantics",
              term: "Landmarks and headings",
              detail: "Pages use landmarks, one level-one heading and labelled sections.",
            },
          ]}
        />
      </Container>
      <Container className="pb-16 sm:pb-24">
        <section aria-labelledby="gaps" className="border-l-2 border-sv-border-strong pl-6">
          <h2 id="gaps" className="sv-h3">
            Not yet done
          </h2>
          <ul className="mt-4 grid max-w-[68ch] gap-3 text-sv-text-muted">
            <li>No independent accessibility audit has been performed.</li>
            <li>Screen-reader testing across assistive technologies has not been completed.</li>
            <li>
              A channel for reporting accessibility barriers has not been published; none is listed rather
              than inventing one.
            </li>
          </ul>
        </section>
      </Container>
    </>
  );
}
