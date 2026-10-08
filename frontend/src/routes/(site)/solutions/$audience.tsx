import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { EvidenceList, PageHeader, Section } from "@/components/sherivs/public-shell";
import { StateView } from "@/components/sherivs/state-view";
import { solutionById } from "@/lib/sherivs/public-content";
import { publicHead } from "@/lib/sherivs/page-head";

export const Route = createFileRoute("/(site)/solutions/$audience")({
  loader: ({ params }) => {
    const solution = solutionById(params.audience);
    if (!solution) throw notFound();
    return { solution };
  },
  head: ({ loaderData }) =>
    loaderData
      ? publicHead({
          path: `/solutions/${loaderData.solution.id}`,
          title: loaderData.solution.title,
          description: loaderData.solution.lead,
          breadcrumbs: true,
        })
      : {},
  component: SolutionPage,
  notFoundComponent: () => (
    <div className="sv-page-wide py-24">
      <StateView
        kind="notFound"
        title="No such solution"
        description="That solution page does not exist."
        actions={
          <Link to="/solutions" className="sv-btn">
            All solutions
          </Link>
        }
      />
    </div>
  ),
});

function SolutionPage() {
  const { solution } = Route.useLoaderData();
  return (
    <>
      <PageHeader path={`/solutions/${solution.id}`} eyebrow="Solution" title={solution.title} lead={solution.lead}>
        <div className="flex flex-wrap gap-3">
          <Link to="/auth" className="sv-btn sv-btn-primary sv-btn-lg">
            Get started
          </Link>
          <Link to="/security" className="sv-btn sv-btn-lg">
            How it is secured
          </Link>
        </div>
      </PageHeader>
      <Section id="overview" title="Overview">
        <div className="sv-prose grid gap-5">
          {solution.body.map((p) => (
            <p key={p.slice(0, 32)} className="sv-body">
              {p}
            </p>
          ))}
        </div>
      </Section>
      <Section id="capabilities" tone="ground" eyebrow="Shipped" title="What is in place">
        <dl className="grid gap-px overflow-hidden rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line)] bg-[color:var(--sv-line)] sm:grid-cols-2">
          {solution.capabilities.map((c) => (
            <div key={c.label} className="sv-ground grid content-start gap-2 p-5">
              <dt className="sv-h4">{c.label}</dt>
              <dd className="sv-small sv-muted">{c.text}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section id="boundary" eyebrow="Boundary" title="What this does not claim">
        <p className="sv-body sv-muted max-w-2xl">{solution.boundary}</p>
        <EvidenceList paths={solution.evidence} />
      </Section>
    </>
  );
}
