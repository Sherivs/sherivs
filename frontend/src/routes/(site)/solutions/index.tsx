import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader, Section } from "@/components/sherivs/public-shell";
import { SOLUTIONS } from "@/lib/sherivs/public-content";
import { publicHead } from "@/lib/sherivs/page-head";

export const Route = createFileRoute("/(site)/solutions/")({
  component: SolutionsIndex,
  head: () =>
    publicHead({
      path: "/solutions",
      title: "Solutions",
      description: "How different organizations run on one governed Sherivs core, starting with education.",
      breadcrumbs: true,
    }),
});

function SolutionsIndex() {
  return (
    <>
      <PageHeader
        path="/solutions"
        eyebrow="Solutions"
        title="One governed core. Domains installed on top."
        lead="Sherivs does not hard-code an industry. A domain arrives as a runtime; the platform beneath it stays the same."
      />
      <Section id="solutions" title="Where to start">
        <ul className="grid gap-px overflow-hidden rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line)] bg-[color:var(--sv-line)] md:grid-cols-2">
          {SOLUTIONS.map((s) => (
            <li key={s.id} className="sv-ground">
              <Link
                to="/solutions/$audience"
                params={{ audience: s.id }}
                className="sv-focusable grid h-full content-start gap-3 p-6 hover:bg-[color:color-mix(in_oklab,var(--sv-text)_4%,transparent)]"
              >
                <h2 className="sv-h2">{s.title}</h2>
                <p className="sv-small sv-muted">{s.lead}</p>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
