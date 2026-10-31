import { createFileRoute } from "@tanstack/react-router";
import { publicHead } from "@/lib/public-site/seo";
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { MarketingPage } from "@/components/public/marketing-page";
import { GlassPanel, PageContainer, Section } from "@/components/public/ui";

export const Route = createFileRoute("/(site)/accessibility")({
  component: AccessibilityPage,
  head: () =>
    publicHead({
      title: "Accessibility",
      description:
        "Sherivs public site accessibility statement. WCAG 2.2 AA is the design objective.",
      path: "/accessibility",
    }),
});

function AccessibilityPage() {
  return (
    <MarketingPage
      eyebrow="Trust"
      title="Accessibility"
      lead="The public website targets WCAG 2.2 AA. This is a design objective, not a certified audit result."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/accessibility", label: "Accessibility" },
      ]}
    >
      <Section labelledBy="a11y-body">
        <PageContainer className="py-16">
          <GlassPanel className="mx-auto max-w-3xl space-y-4 text-sm leading-relaxed text-sherivs-muted">
            <h2
              id="a11y-body"
              className="font-display text-xl font-semibold text-[var(--sherivs-ink)]"
            >
              What we implement
            </h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>Semantic landmarks, headings, and skip link to main content</li>
              <li>Keyboard-accessible navigation, including mobile disclosure menus</li>
              <li>Visible focus indicators on the public chrome</li>
              <li>Form labels, validation, and live status messages</li>
              <li>prefers-reduced-motion support for decorative motion</li>
            </ul>
            <p>
              Report barriers to{" "}
              <a
                className="text-sherivs-cyan underline-offset-4 hover:underline"
                href={`mailto:${PUBLIC_CONTACTS.support}`}
              >
                {PUBLIC_CONTACTS.support}
              </a>
              .
            </p>
          </GlassPanel>
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
