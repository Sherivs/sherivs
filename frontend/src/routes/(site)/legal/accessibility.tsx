import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Section } from "@/components/sherivs/public-shell";
import { publicHead } from "@/lib/sherivs/page-head";

export const Route = createFileRoute("/(site)/legal/accessibility")({
  component: AccessibilityPage,
  head: () =>
    publicHead({
      path: "/legal/accessibility",
      title: "Accessibility statement",
      description: "Sherivs's accessibility target, what is verified automatically, and known limitations.",
      breadcrumbs: true,
    }),
});

const COMMITMENTS = [
  "The interface targets WCAG 2.2 level AA.",
  "Colour pairs are checked in automated tests for at least 4.5:1 (text) and 3:1 (interface components) in the light and dark themes, and a high-contrast mode is available.",
  "Meaning is never carried by colour alone: statement kinds, states and statuses always include text.",
  "Every interactive control is reachable by keyboard, has a visible focus indicator, and touch targets meet a 44px minimum on coarse pointers.",
  "Motion respects the reduced-motion preference. A moving indicator appears only while a request is genuinely in progress.",
  "Pages are designed to reflow from 360px wide to large desktop displays without horizontal scrolling.",
];

const LIMITATIONS = [
  "Automated checks cover the design tokens and structure; they do not replace testing with assistive technology, which has not been completed for every authenticated screen.",
  "Some authenticated screens predate the Sherivs design system and inherit its tokens but have not each been audited individually.",
  "Some tenant-supplied content (for example a school's own news) is authored by that organization and is outside Sherivs's control.",
];

function AccessibilityPage() {
  return (
    <>
      <PageHeader
        path="/legal/accessibility"
        eyebrow="Legal"
        title="Accessibility statement"
        lead="What we commit to, what we check, and where we know we are not finished."
      />
      <Section id="commitments" title="Commitments">
        <ul className="sv-body sv-prose grid list-disc gap-3 pl-6">
          {COMMITMENTS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Section>
      <Section id="limitations" tone="ground" title="Known limitations">
        <ul className="sv-body sv-prose grid list-disc gap-3 pl-6">
          {LIMITATIONS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="sv-small sv-muted max-w-2xl">
          No public accessibility feedback channel is published yet; this statement will be updated when one exists.
        </p>
      </Section>
    </>
  );
}
