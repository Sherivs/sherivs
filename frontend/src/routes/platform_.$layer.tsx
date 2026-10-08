import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  LAYER_AVAILABILITY_DETAIL,
  LAYER_AVAILABILITY_LABEL,
  PLATFORM_LAYERS,
  findPlatformLayer,
} from "@/content/sherivs/platform-layers";
import { publicPageHead } from "@/content/sherivs/seo";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { ActionLink, PageHero, Plane, RuledList, SectionHeading, StatusDot } from "@/components/sherivs/primitives";
import { SystemState } from "@/components/sherivs/system-state";

/**
 * One platform layer at /platform/<slug>. Unknown slugs are a real 404, never an empty
 * template. Copy comes from the layer registry; nothing here is layer-specific JSX.
 */
export const Route = createFileRoute("/platform_/$layer")({
  loader: ({ params }) => {
    const layer = findPlatformLayer(params.layer);
    if (!layer) throw notFound();
    return { slug: layer.slug };
  },
  head: ({ params }) =>
    findPlatformLayer(params.layer) ? publicPageHead(`/platform/${params.layer}`) : { meta: [{ title: "Not found — Sherivs" }] },
  component: LayerPage,
  notFoundComponent: LayerNotFound,
});

function LayerNotFound() {
  return (
    <SherivsPublicShell>
      <div className="sx-container py-28">
        <SystemState
          kind="not-found"
          headingLevel="h1"
          title="That platform layer does not exist"
          description="The platform has seven layers. Choose one from the platform overview."
          actions={<ActionLink to="/platform">Platform overview</ActionLink>}
        />
      </div>
    </SherivsPublicShell>
  );
}

function LayerPage() {
  const { slug } = Route.useLoaderData();
  const layer = findPlatformLayer(slug);
  if (!layer) return <LayerNotFound />;
  const position = PLATFORM_LAYERS.findIndex((candidate) => candidate.slug === layer.slug);
  const previous = PLATFORM_LAYERS[position - 1];
  const next = PLATFORM_LAYERS[position + 1];

  return (
    <SherivsPublicShell>
      <PageHero
        id="layer-heading"
        label={
          <span className="flex flex-wrap items-center gap-3">
            <Link to="/platform" className="sx-link">
              Platform
            </Link>
            <span aria-hidden="true">/</span>
            <span>Layer {layer.index}</span>
          </span>
        }
        title={layer.name}
        lead={layer.statement}
        aside={
          <div className="border-l border-sx-line-strong pl-5">
            <StatusDot
              tone={layer.availability === "in_service" ? "verification" : "observation"}
              label={LAYER_AVAILABILITY_LABEL[layer.availability]}
            />
            <p className="sx-small mt-3 text-sx-muted">{LAYER_AVAILABILITY_DETAIL[layer.availability]}</p>
          </div>
        }
      />

      <Plane labelledBy="problem-heading">
        <SectionHeading id="problem-heading" index="01" label="The problem" title={layer.problem} />
      </Plane>

      <Plane tone="raised" labelledBy="capabilities-heading">
        <SectionHeading id="capabilities-heading" index="02" label="What the layer does" title={`${layer.name}, in practice`} />
        <div className="mt-14 lg:ml-[33.333%]">
          <RuledList items={layer.capabilities.map((capability) => ({ title: capability.title, detail: capability.detail }))} />
        </div>
      </Plane>

      <Plane tone="ink" labelledBy="guarantees-heading">
        <SectionHeading id="guarantees-heading" index="03" label="Guarantees" title="Rules this layer will not break" />
        <ul className="mt-14 grid gap-px border border-sx-line bg-sx-line lg:ml-[33.333%]">
          {layer.guarantees.map((guarantee) => (
            <li key={guarantee} className="bg-sx-surface-1 px-6 py-5 text-sx-strong">
              {guarantee}
            </li>
          ))}
        </ul>
      </Plane>

      <nav aria-label="Platform layers" className="border-t border-sx-line">
        <div className="sx-container grid gap-px bg-sx-line sm:grid-cols-2">
          {previous ? (
            <Link
              to="/platform/$layer"
              params={{ layer: previous.slug }}
              className="group flex flex-col gap-2 bg-sx-surface-0 py-10 pr-6"
            >
              <span className="sx-label flex items-center gap-2">
                <ArrowLeft aria-hidden="true" className="size-3.5" /> Previous layer
              </span>
              <span className="sx-h3 group-hover:text-sx-signal">{previous.name}</span>
            </Link>
          ) : (
            <Link to="/platform" className="group flex flex-col gap-2 bg-sx-surface-0 py-10 pr-6">
              <span className="sx-label flex items-center gap-2">
                <ArrowLeft aria-hidden="true" className="size-3.5" /> Back to
              </span>
              <span className="sx-h3 group-hover:text-sx-signal">Platform overview</span>
            </Link>
          )}
          {next ? (
            <Link
              to="/platform/$layer"
              params={{ layer: next.slug }}
              className="group flex flex-col items-end gap-2 bg-sx-surface-0 py-10 pl-6 text-right"
            >
              <span className="sx-label flex items-center gap-2">
                Next layer <ArrowRight aria-hidden="true" className="size-3.5" />
              </span>
              <span className="sx-h3 group-hover:text-sx-signal">{next.name}</span>
            </Link>
          ) : (
            <Link to="/security" className="group flex flex-col items-end gap-2 bg-sx-surface-0 py-10 pl-6 text-right">
              <span className="sx-label flex items-center gap-2">
                Continue to <ArrowRight aria-hidden="true" className="size-3.5" />
              </span>
              <span className="sx-h3 group-hover:text-sx-signal">Security model</span>
            </Link>
          )}
        </div>
      </nav>
    </SherivsPublicShell>
  );
}
