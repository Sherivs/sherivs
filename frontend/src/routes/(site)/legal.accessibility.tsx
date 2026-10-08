import { createFileRoute } from "@tanstack/react-router";
import { publicPageHead } from "@/content/sherivs/seo";
import { Plane, RuledList, SectionHeading } from "@/components/sherivs/primitives";

/**
 * Sherivs accessibility statement at /legal/accessibility. States the target standard,
 * what is in place, and the known gaps — including that no independent audit exists yet.
 */
export const Route = createFileRoute("/(site)/legal/accessibility")({
  component: AccessibilityStatement,
  head: () => publicPageHead("/legal/accessibility"),
});

const IN_PLACE = [
  {
    title: "Structure",
    detail: "A skip link, one main landmark per page, labelled navigation regions and an ordered heading outline on every public page.",
  },
  {
    title: "Keyboard",
    detail: "Every link, menu and control on the public site is reachable and operable by keyboard, with a visible focus indicator.",
  },
  {
    title: "Contrast",
    detail: "Text and interface colors are defined as tokens whose contrast ratios are checked by automated tests in light and dark themes.",
  },
  {
    title: "Motion",
    detail: "Animation and transitions are removed when your system asks for reduced motion. No content depends on motion.",
  },
  {
    title: "Forced colors",
    detail: "Brand marks, focus rings and dividers remain visible in Windows high-contrast and other forced-color modes.",
  },
  {
    title: "Targets and zoom",
    detail: "Mobile navigation targets are at least 44 by 44 pixels, and layouts reflow from 360-pixel screens without horizontal scrolling.",
  },
] as const;

const KNOWN_GAPS = [
  {
    title: "No independent audit yet",
    detail: "Sherivs has not commissioned a third-party accessibility audit. This statement reflects our own testing.",
  },
  {
    title: "Signed-in workspaces",
    detail: "Workspace screens predate the current design system and have not all been re-tested against WCAG 2.2 AA.",
  },
  {
    title: "Automated checks",
    detail: "Automated accessibility scanning is not yet part of every build; contrast and structure are checked by unit tests.",
  },
] as const;

function AccessibilityStatement() {
  return (
    <>
      <Plane labelledBy="a11y-heading" className="border-t-0">
        <SectionHeading
          id="a11y-heading"
          as="h1"
          label="Legal · Accessibility"
          title="Accessibility statement"
          lead="Sherivs builds to the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA. This page says what is in place, what is not yet, and how to tell us about a barrier."
        />
      </Plane>
      <Plane tone="raised" labelledBy="in-place-heading">
        <SectionHeading id="in-place-heading" index="01" label="In place" title="What the public site does today" />
        <div className="mt-14">
          <RuledList columns={2} items={IN_PLACE} />
        </div>
      </Plane>
      <Plane labelledBy="gaps-heading">
        <SectionHeading id="gaps-heading" index="02" label="Known gaps" title="What is not done yet" />
        <div className="mt-14 lg:ml-[33.333%]">
          <RuledList items={KNOWN_GAPS} />
        </div>
      </Plane>
      <Plane tone="raised" labelledBy="report-heading">
        <SectionHeading
          id="report-heading"
          index="03"
          label="Report a barrier"
          title="Tell us where it failed"
          lead="Organization administrators can report an accessibility barrier through Support in their Sherivs workspace. Include the page address, what you were trying to do and the assistive technology you use."
        />
      </Plane>
    </>
  );
}
