import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/sherivs/primitives";
import { CtaLink, PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";
import { SOLUTION_SEGMENTS } from "@/lib/experience/public-content";

const DESCRIPTION =
  "Sherivs for organizations, enterprises, education and governed AI workforces — one platform core, extended by installed runtimes.";

export const Route = createFileRoute("/(site)/solutions/")({
  component: SolutionsOverview,
  head: () => ({
    meta: [
      { title: pageTitle("Solutions") },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: pageTitle("Solutions") },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: canonicalUrl("/solutions") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/solutions") }],
  }),
});

function SolutionsOverview() {
  return (
    <>
      <PublicPageIntro eyebrow="Solutions" title="One governed core. Installed for your kind of organization." lead={DESCRIPTION}>
        <CtaLink to="/pricing" variant="secondary">
          Pricing
        </CtaLink>
        <CtaLink to="/auth">Create account</CtaLink>
      </PublicPageIntro>

      <PublicSection labelledBy="segments-heading">
        <h2 id="segments-heading" className="sr-only">
          Solution segments
        </h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {SOLUTION_SEGMENTS.map((segment) => (
            <li key={segment.slug}>
              <Link
                to="/solutions/$segment"
                params={{ segment: segment.slug }}
                className="sh-interactive sh-focus group block h-full rounded-[var(--sh-radius-lg)]"
              >
                <Panel className="h-full">
                  <p className="sh-label">{segment.audience}</p>
                  <p className="sh-h3 mt-3">{segment.title}</p>
                  <p className="sh-small mt-2 text-ink-2">{segment.summary}</p>
                  <span className="sh-small mt-5 inline-flex items-center gap-1.5 font-semibold text-signal">
                    Read <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Panel>
              </Link>
            </li>
          ))}
        </ul>
      </PublicSection>
    </>
  );
}
