import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { DocPage, DocSection } from "@/components/sherivs/doc-page";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/legal/accessibility")({
  component: AccessibilityPage,
  head: () => ({
    meta: [
      { title: "Sherivs accessibility statement" },
      {
        name: "description",
        content:
          "Sherivs targets WCAG 2.2 AA: keyboard operability, screen-reader semantics, contrast, and reduced motion.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/legal/accessibility` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/legal/accessibility` }],
  }),
});

function AccessibilityPage() {
  return (
    <SherivsPublicShell>
      <DocPage
        title="Accessibility statement"
        lead="Sherivs targets WCAG 2.2 AA across public and authenticated surfaces. Accessibility is a release gate, not a backlog item."
        updated="2026-10-08"
      >
        <DocSection heading="What is built in">
          <p>
            Full keyboard operability with visible focus, semantic landmarks and headings,
            screen-reader announcements for dynamic states, sufficient color contrast, text scaling
            without breakage, honored prefers-reduced-motion, and touch targets sized for real
            hands.
          </p>
        </DocSection>
        <DocSection heading="Known limits">
          <p>
            Data-dense operational views are the hardest surfaces to make fully accessible; they
            carry table semantics, keyboard navigation and text alternatives first, with richer
            visualization second. If any surface blocks you, that is a defect — report it.
          </p>
        </DocSection>
        <DocSection heading="Report a barrier">
          <p>
            Members should tell their organization administrator, who can escalate with tenant
            context. General reports can follow the{" "}
            <Link to="/contact" className="underline underline-offset-4">
              contact paths
            </Link>
            . Include the page address, what you were trying to do, and the assistive technology you
            use.
          </p>
        </DocSection>
      </DocPage>
    </SherivsPublicShell>
  );
}
