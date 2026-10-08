import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { EvidenceList, PageHeader, Section } from "@/components/sherivs/public-shell";
import { CAPABILITIES, capabilityById } from "@/lib/sherivs/public-content";
import { publicHead } from "@/lib/sherivs/page-head";
import { StateView } from "@/components/sherivs/state-view";

export const Route = createFileRoute("/(site)/platform/$capability")({
  loader: ({ params }) => {
    const capability = capabilityById(params.capability);
    if (!capability) throw notFound();
    return { capability };
  },
  head: ({ loaderData }) =>
    loaderData
      ? publicHead({
          path: `/platform/${loaderData.capability.id}`,
          title: loaderData.capability.title,
          description: loaderData.capability.lead,
          breadcrumbs: true,
        })
      : {},
  component: CapabilityPage,
  notFoundComponent: () => (
    <div className="sv-page-wide py-24">
      <StateView
        kind="notFound"
        title="No such capability"
        description="That platform capability does not exist."
        actions={
          <Link to="/platform" className="sv-btn">
            All capabilities
          </Link>
        }
      />
    </div>
  ),
});

function CapabilityPage() {
  const { capability } = Route.useLoaderData();
  const related = capability.related
    .map((id) => CAPABILITIES.find((c) => c.id === id))
    .filter((c): c is (typeof CAPABILITIES)[number] => Boolean(c));
  return (
    <>
      <PageHeader
        path={`/platform/${capability.id}`}
        eyebrow="Platform capability"
        title={capability.title}
        lead={capability.lead}
      />
      <Section id="overview" title="What it is">
        <div className="sv-prose grid gap-5">
          {capability.body.map((p) => (
            <p key={p.slice(0, 32)} className="sv-body">
              {p}
            </p>
          ))}
        </div>
      </Section>
      <Section id="guarantees" tone="ground" eyebrow="Guarantees" title="What it guarantees">
        <dl className="grid gap-px overflow-hidden rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line)] bg-[color:var(--sv-line)] md:grid-cols-3">
          {capability.guarantees.map((g) => (
            <div key={g.label} className="sv-ground grid content-start gap-2 p-5">
              <dt className="sv-h4">{g.label}</dt>
              <dd className="sv-small sv-muted">{g.text}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section id="boundary" eyebrow="Boundary" title="Where it stops">
        <p className="sv-body sv-muted max-w-2xl">{capability.boundary}</p>
        <EvidenceList paths={capability.evidence} />
      </Section>
      {related.length > 0 ? (
        <Section id="related" tone="ground" title="Related capabilities">
          <ul className="flex flex-wrap gap-3">
            {related.map((r) => (
              <li key={r.id}>
                <Link to="/platform/$capability" params={{ capability: r.id }} className="sv-btn">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
