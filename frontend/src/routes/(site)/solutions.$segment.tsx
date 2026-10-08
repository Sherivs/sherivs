import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { publicPageHead } from "@/content/sherivs/seo";
import { findSolutionSegment } from "@/content/sherivs/solutions";
import { findPlatformLayer, LAYER_AVAILABILITY_LABEL } from "@/content/sherivs/platform-layers";
import { INSTALLED_RUNTIMES } from "@/lib/runtime/installed-runtimes";
import {
  ActionLink,
  PageHero,
  Plane,
  RuledList,
  SectionHeading,
} from "@/components/sherivs/primitives";
import { SystemState } from "@/components/sherivs/system-state";

/** One solution segment at /solutions/<slug>; unknown slugs are a real 404. */
export const Route = createFileRoute("/(site)/solutions/$segment")({
  loader: ({ params }) => {
    const segment = findSolutionSegment(params.segment);
    if (!segment) throw notFound();
    return { slug: segment.slug };
  },
  head: ({ params }) =>
    findSolutionSegment(params.segment)
      ? publicPageHead(`/solutions/${params.segment}`)
      : { meta: [{ title: "Not found — Sherivs" }] },
  component: SegmentPage,
  notFoundComponent: SegmentNotFound,
});

function SegmentNotFound() {
  return (
    <div className="sx-container py-28">
      <SystemState
        kind="not-found"
        headingLevel="h1"
        title="That solution does not exist"
        description="Sherivs lists a solution only when the platform serves it today."
        actions={<ActionLink to="/solutions">All solutions</ActionLink>}
      />
    </div>
  );
}

function SegmentPage() {
  const { slug } = Route.useLoaderData();
  const segment = findSolutionSegment(slug);
  if (!segment) return <SegmentNotFound />;
  const runtime = segment.runtimeId
    ? INSTALLED_RUNTIMES.find((candidate) => candidate.id === segment.runtimeId)
    : undefined;
  const layers = segment.layers.map(findPlatformLayer).filter((layer) => layer !== undefined);

  return (
    <>
      <PageHero
        id="segment-heading"
        label={
          <span className="flex flex-wrap items-center gap-3">
            <Link to="/solutions" className="sx-link">
              Solutions
            </Link>
            <span aria-hidden="true">/</span>
            <span>{segment.name}</span>
          </span>
        }
        title={segment.tagline}
        lead={segment.summary}
      >
        <ActionLink to="/auth">Create an account</ActionLink>
        <ActionLink to="/pricing" variant="secondary">
          See plans
        </ActionLink>
      </PageHero>

      <Plane labelledBy="outcomes-heading">
        <SectionHeading
          id="outcomes-heading"
          index="01"
          label="What you get"
          title="In the order you will use it"
        />
        <div className="mt-14 lg:ml-[33.333%]">
          <RuledList
            items={segment.outcomes.map((outcome, position) => ({
              meta: String(position + 1).padStart(2, "0"),
              title: outcome.title,
              detail: outcome.detail,
            }))}
          />
        </div>
      </Plane>

      {runtime && (
        <Plane tone="ink" labelledBy="runtime-heading">
          <SectionHeading
            id="runtime-heading"
            index="02"
            label="Installed runtime"
            title={runtime.brandName}
            lead={runtime.summary}
          />
          <dl className="mt-14 grid border-t border-sx-line-strong sm:grid-cols-2 lg:ml-[33.333%]">
            <div className="border-b border-sx-line py-4 pr-6">
              <dt className="sx-label">Runtime</dt>
              <dd className="mt-1 text-sx-strong">{runtime.description}</dd>
            </div>
            <div className="border-b border-sx-line py-4 pr-6">
              <dt className="sx-label">Relationship to the core</dt>
              <dd className="mt-1 text-sx-strong">
                Installed on the platform; the core stays valid without it
              </dd>
            </div>
          </dl>
        </Plane>
      )}

      <Plane tone="raised" labelledBy="layers-heading">
        <SectionHeading
          id="layers-heading"
          index={runtime ? "03" : "02"}
          label="Platform layers"
          title="The layers this work leans on most"
        />
        <ul className="mt-14 border-t border-sx-line-strong lg:ml-[33.333%]">
          {layers.map((layer) => (
            <li key={layer.slug} className="border-b border-sx-line">
              <Link
                to="/platform/$layer"
                params={{ layer: layer.slug }}
                className="group flex flex-wrap items-baseline justify-between gap-4 py-5"
              >
                <span>
                  <span className="font-medium text-sx-strong group-hover:text-sx-signal">
                    {layer.name}
                  </span>
                  <span className="sx-small ml-3 text-sx-muted">{layer.statement}</span>
                </span>
                <span className="sx-label text-[0.625rem]">
                  {LAYER_AVAILABILITY_LABEL[layer.availability]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Plane>
    </>
  );
}
