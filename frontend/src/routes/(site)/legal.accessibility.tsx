import { createFileRoute } from "@tanstack/react-router";
import { Panel } from "@/components/sherivs/primitives";
import { PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";

/**
 * Accessibility statement. States the design targets Sherivs builds to and
 * what is enforced in code today. It does not claim a completed audit.
 */
const DESCRIPTION =
  "Sherivs builds to WCAG 2.2 AA: keyboard operability, visible focus, 4.5:1 text contrast, reduced-motion support, 44px touch targets and semantic landmarks on every surface.";

const COMMITMENTS = [
  { title: "Keyboard first", detail: "Every interactive element is reachable and operable by keyboard; a skip link precedes the header on every page." },
  { title: "Visible focus", detail: "Focus rings are drawn from the design-token layer and are never removed; they do not depend on hover." },
  { title: "Contrast", detail: "Body text targets a minimum 4.5:1 ratio in both themes; a `prefers-contrast: more` override strengthens borders and text." },
  { title: "Motion", detail: "Entrance and live-state animations respect `prefers-reduced-motion`; animation never carries meaning that is not also conveyed in text." },
  { title: "Touch targets", detail: "Primary controls meet a 44 × 44 CSS-pixel minimum; the mobile navigation uses full-height rows." },
  { title: "Structure", detail: "Pages use `header`, `nav`, `main` and `footer` landmarks, one `h1`, labelled sections and labelled lists." },
  { title: "No image-only meaning", detail: "The public site uses no raster images; brand marks are SVG with accessible names." },
  { title: "Honest states", detail: "Loading, empty, error, offline, forbidden and not-found states are announced with the right ARIA roles." },
];

export const Route = createFileRoute("/(site)/legal/accessibility")({
  component: AccessibilityStatement,
  head: () => ({
    meta: [
      { title: pageTitle("Accessibility") },
      { name: "description", content: DESCRIPTION },
      { property: "og:url", content: canonicalUrl("/legal/accessibility") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/legal/accessibility") }],
  }),
});

function AccessibilityStatement() {
  return (
    <>
      <PublicPageIntro eyebrow="Legal · Accessibility" title="Accessibility statement." lead={DESCRIPTION} />
      <PublicSection labelledBy="commitments-heading">
        <h2 id="commitments-heading" className="sh-h3">
          What we build to
        </h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {COMMITMENTS.map((item) => (
            <li key={item.title}>
              <Panel className="h-full p-4">
                <p className="sh-h4">{item.title}</p>
                <p className="sh-small mt-1 text-ink-2">{item.detail}</p>
              </Panel>
            </li>
          ))}
        </ul>
      </PublicSection>
      <PublicSection tight className="bg-plane-1" labelledBy="scope-heading">
        <h2 id="scope-heading" className="sh-h3">
          Scope and status
        </h2>
        <p className="sh-small sh-prose mt-2 text-ink-2">
          These targets apply to the Sherivs public website and application shell. Organization
          workspaces built before the Sherivs experience system are being migrated to the same
          standard. No third-party accessibility audit has been completed yet; this statement
          describes design and engineering targets, not a certification.
        </p>
      </PublicSection>
    </>
  );
}
