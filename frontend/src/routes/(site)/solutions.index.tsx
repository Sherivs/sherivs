import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { publicPageHead } from "@/content/sherivs/seo";
import { SOLUTION_SEGMENTS } from "@/content/sherivs/solutions";
import { PageHero, Plane, SectionHeading } from "@/components/sherivs/primitives";

/**
 * Sherivs solutions overview at /solutions. Lists only segments the platform serves
 * today; a sector appears here when its runtime is installed, not before.
 */
export const Route = createFileRoute("/(site)/solutions/")({
  component: SolutionsPage,
  head: () => publicPageHead("/solutions"),
});

function SolutionsPage() {
  return (
    <>
      <PageHero
        id="solutions-heading"
        label="Solutions"
        title="One platform core. Runtimes for the sectors that need their own language."
        lead="Every organization gets the same governed core. A sector runtime adds the vocabulary, records and workflows of that sector without changing the core underneath."
      />
      <Plane labelledBy="segments-heading">
        <SectionHeading
          id="segments-heading"
          label="Served today"
          title="Who Sherivs serves today"
          lead="Other sectors use the platform core directly until a runtime for them is installed. This list grows only when a runtime ships."
        />
        <ul className="mt-16 border-t border-sx-line-strong">
          {SOLUTION_SEGMENTS.map((segment) => (
            <li key={segment.slug} className="border-b border-sx-line">
              <Link
                to="/solutions/$segment"
                params={{ segment: segment.slug }}
                className="group grid gap-4 py-10 md:grid-cols-12 md:gap-10"
              >
                <span className="md:col-span-4">
                  <span className="sx-h2 block group-hover:text-sx-signal">{segment.name}</span>
                  <span className="sx-small mt-3 block text-sx-muted">{segment.tagline}</span>
                </span>
                <span className="sx-body text-sx-text md:col-span-7">{segment.summary}</span>
                <ArrowUpRight
                  aria-hidden="true"
                  className="hidden size-5 text-sx-muted group-hover:text-sx-signal md:col-span-1 md:block md:justify-self-end"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Plane>
    </>
  );
}
