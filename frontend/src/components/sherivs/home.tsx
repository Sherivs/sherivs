/**
 * Sherivs public homepage — a twelve-movement narrative, read top to bottom as
 * reality → intelligence → action → evidence. Composition only: copy lives in
 * content/sherivs/home.ts, runtimes come from the installed-runtime registry.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import {
  ARCHITECTURE_PRINCIPLES,
  EXPERIENCE_INPUTS,
  HOME_MOVEMENTS,
  INTELLIGENCE_COMPONENTS,
  REALITY_ENTITIES,
} from "@/content/sherivs/home";
import { PLATFORM_LAYERS, LAYER_AVAILABILITY_LABEL } from "@/content/sherivs/platform-layers";
import { SOLUTION_SEGMENTS } from "@/content/sherivs/solutions";
import { organizationJsonLd } from "@/content/sherivs/seo";
import { INSTALLED_RUNTIMES } from "@/lib/runtime/installed-runtimes";
import { PLATFORM_TAGLINE } from "@/lib/platform";
import { SherivsMark } from "./brand";
import {
  AuthorizationDecision,
  IntelligenceKinds,
  MissionChain,
  ProvenanceRecord,
  RealityStrata,
  WorkerAnatomy,
} from "./diagrams";
import { ActionLink, Plane, RuledList, SectionHeading, SectionIndex } from "./primitives";

const M = HOME_MOVEMENTS;

function Introduction() {
  return (
    <section
      aria-labelledby="introduction-heading"
      data-sx-plane="ink"
      className="sx-atmosphere relative overflow-hidden"
    >
      <div
        aria-hidden="true"
        className="sx-field absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_70%_10%,black,transparent_70%)]"
      />
      <div className="sx-container relative grid gap-16 pt-20 pb-20 sm:pt-28 lg:grid-cols-12 lg:gap-10 lg:pt-36 lg:pb-32">
        <div className="lg:col-span-7">
          <SectionIndex index={M.introduction.index} label={PLATFORM_TAGLINE} />
          <h1 id="introduction-heading" className="sx-display mt-8">
            {M.introduction.title}
          </h1>
          <p className="sx-body-lg mt-8 max-w-[56ch]">{M.introduction.lead}</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <ActionLink to="/platform">Explore the platform</ActionLink>
            <ActionLink to="/auth" variant="secondary">
              Create an account
            </ActionLink>
          </div>
        </div>
        <div className="lg:col-span-5 lg:pt-16">
          <RealityStrata />
        </div>
      </div>
    </section>
  );
}

function Category() {
  return (
    <Plane labelledBy="category-heading">
      <SectionHeading
        id="category-heading"
        index={M.category.index}
        label={M.category.label}
        title={M.category.title}
        lead={M.category.lead}
      />
      <div className="mt-16 grid gap-px border border-sx-line bg-sx-line lg:ml-[33.333%] lg:grid-cols-2">
        <div className="bg-sx-surface-0 p-6 sm:p-8">
          <p className="sx-label">Without the layer</p>
          <ul className="mt-5 grid gap-3 sx-small text-sx-muted">
            <li>Truth is whichever system was updated last.</li>
            <li>Access rules live in hidden buttons and memory.</li>
            <li>AI acts with borrowed credentials and no record.</li>
            <li>Nobody can reconstruct why a decision was made.</li>
          </ul>
        </div>
        <div className="bg-sx-surface-1 p-6 sm:p-8">
          <p className="sx-label text-sx-signal">With Sherivs</p>
          <ul className="mt-5 grid gap-3 sx-small text-sx-text">
            <li>One canonical record, owned and versioned.</li>
            <li>Every decision resolved by policy and audited.</li>
            <li>AI workers with identities, scopes and leases.</li>
            <li>Every outcome traced to verified evidence.</li>
          </ul>
        </div>
      </div>
    </Plane>
  );
}

function Reality() {
  return (
    <Plane tone="raised" labelledBy="reality-heading" field>
      <SectionHeading
        id="reality-heading"
        index={M.reality.index}
        label={M.reality.label}
        title={M.reality.title}
        lead={M.reality.lead}
      />
      <dl className="mt-16 grid grid-cols-2 border-t border-sx-line-strong md:grid-cols-4">
        {REALITY_ENTITIES.map((entity) => (
          <div
            key={entity.name}
            className="border-b border-sx-line bg-sx-surface-2/80 py-6 pr-4 md:pr-8"
          >
            <dt className="font-[family-name:var(--font-sx-display)] text-lg font-semibold text-sx-strong">
              {entity.name}
            </dt>
            <dd className="sx-caption mt-1.5">{entity.detail}</dd>
          </div>
        ))}
      </dl>
    </Plane>
  );
}

function Intelligence() {
  return (
    <Plane labelledBy="intelligence-heading">
      <SectionHeading
        id="intelligence-heading"
        index={M.intelligence.index}
        label={M.intelligence.label}
        title={M.intelligence.title}
        lead={M.intelligence.lead}
      />
      <div className="mt-16 grid gap-16 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <RuledList
            items={INTELLIGENCE_COMPONENTS.map((c) => ({ title: c.name, detail: c.detail }))}
          />
        </div>
        <div className="lg:col-span-7">
          <p className="sx-label mb-6">Every response is separated into six kinds</p>
          <IntelligenceKinds />
        </div>
      </div>
    </Plane>
  );
}

function Workforce() {
  return (
    <Plane tone="ink" labelledBy="workforce-heading">
      <SectionHeading
        id="workforce-heading"
        index={M.workforce.index}
        label={M.workforce.label}
        title={M.workforce.title}
        lead={M.workforce.lead}
      />
      <div className="mt-16 grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-4">
          <ol className="grid gap-0 border-l border-sx-line-strong">
            {[
              "Proposed",
              "Reviewed",
              "Approved",
              "Deployed",
              "Monitored",
              "Suspended",
              "Retired",
            ].map((state, position) => (
              <li key={state} className="relative py-2.5 pl-6">
                <span
                  aria-hidden="true"
                  className="absolute left-[-4.5px] top-1/2 size-2 -translate-y-1/2 rounded-full border border-sx-line-strong bg-sx-surface-0"
                />
                <span className="sx-data text-sx-muted">
                  {String(position + 1).padStart(2, "0")}
                </span>
                <span className="ml-3 text-sm text-sx-text">{state}</span>
              </li>
            ))}
          </ol>
          <p className="sx-caption mt-6 max-w-xs">
            Workers cannot move themselves between states. Every transition is a human decision on
            the record.
          </p>
        </div>
        <div className="lg:col-span-8">
          <WorkerAnatomy />
        </div>
      </div>
    </Plane>
  );
}

function Missions() {
  return (
    <Plane labelledBy="missions-heading">
      <SectionHeading
        id="missions-heading"
        index={M.missions.index}
        label={M.missions.label}
        title={M.missions.title}
        lead={M.missions.lead}
      />
      <MissionChain className="mt-16" />
    </Plane>
  );
}

function Experiences() {
  return (
    <Plane tone="raised" labelledBy="experiences-heading">
      <SectionHeading
        id="experiences-heading"
        index={M.experiences.index}
        label={M.experiences.label}
        title={M.experiences.title}
        lead={M.experiences.lead}
      />
      <figure className="mt-16 lg:ml-[33.333%]">
        <div className="flex flex-wrap items-center gap-2">
          {EXPERIENCE_INPUTS.map((input, position) => (
            <span key={input} className="flex items-center gap-2">
              <span className="sx-data border border-sx-line bg-sx-surface-1 px-3 py-1.5 text-sx-text">
                {input}
              </span>
              <span aria-hidden="true" className="sx-data text-sx-muted">
                {position < EXPERIENCE_INPUTS.length - 1 ? "+" : "="}
              </span>
            </span>
          ))}
          <span className="sx-data border border-sx-signal px-3 py-1.5 text-sx-signal">
            Experience configuration
          </span>
        </div>
        <p className="sx-label mt-4 text-[0.6875rem]">Schematic · how a workspace is composed</p>
      </figure>
    </Plane>
  );
}

function Runtimes() {
  return (
    <Plane labelledBy="runtimes-heading">
      <SectionHeading
        id="runtimes-heading"
        index={M.runtimes.index}
        label={M.runtimes.label}
        title={M.runtimes.title}
        lead={M.runtimes.lead}
      />
      <div className="mt-16 grid gap-px border border-sx-line bg-sx-line lg:ml-[33.333%]">
        <div className="flex items-center justify-between bg-sx-surface-2 px-6 py-4">
          <span className="sx-label">Platform core</span>
          <span className="sx-caption">{PLATFORM_LAYERS.length} layers · domain-neutral</span>
        </div>
        {INSTALLED_RUNTIMES.map((runtime) => {
          const segment = SOLUTION_SEGMENTS.find((candidate) => candidate.runtimeId === runtime.id);
          return (
            <article
              key={runtime.id}
              className="grid gap-3 bg-sx-surface-1 p-6 sm:grid-cols-[1fr_auto] sm:items-start"
            >
              <div>
                <p className="sx-label">Installed runtime · {runtime.description}</p>
                <h3 className="sx-h3 mt-2">{runtime.brandName}</h3>
                <p className="sx-small mt-3 max-w-prose text-sx-muted">{runtime.summary}</p>
              </div>
              {segment && (
                <Link
                  to="/solutions/$segment"
                  params={{ segment: segment.slug }}
                  className="sx-link text-sm font-medium"
                >
                  {segment.name} solutions
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </Plane>
  );
}

function Governance() {
  return (
    <Plane tone="raised" labelledBy="governance-heading">
      <SectionHeading
        id="governance-heading"
        index={M.governance.index}
        label={M.governance.label}
        title={M.governance.title}
        lead={M.governance.lead}
      />
      <AuthorizationDecision className="mt-16" />
      <div className="mt-20">
        <p className="sx-label mb-6">Provenance carried by every important record</p>
        <ProvenanceRecord />
      </div>
    </Plane>
  );
}

function Architecture() {
  return (
    <Plane labelledBy="architecture-heading">
      <SectionHeading
        id="architecture-heading"
        index={M.architecture.index}
        label={M.architecture.label}
        title={M.architecture.title}
        lead={M.architecture.lead}
      />
      <div className="mt-16 lg:ml-[33.333%]">
        <RuledList
          columns={2}
          items={ARCHITECTURE_PRINCIPLES.map((p) => ({ title: p.title, detail: p.detail }))}
        />
        <ul className="mt-12 grid border-t border-sx-line-strong sm:grid-cols-2">
          {PLATFORM_LAYERS.map((layer) => (
            <li key={layer.slug} className="border-b border-sx-line">
              <Link
                to="/platform/$layer"
                params={{ layer: layer.slug }}
                className="group flex items-center justify-between gap-4 py-4 pr-2 transition-colors hover:text-sx-signal"
              >
                <span className="flex items-baseline gap-3">
                  <span className="sx-data text-sx-muted">{layer.index}</span>
                  <span className="font-medium text-sx-strong group-hover:text-sx-signal">
                    {layer.name}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="sx-label text-[0.625rem]">
                    {LAYER_AVAILABILITY_LABEL[layer.availability]}
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-4 text-sx-muted group-hover:text-sx-signal"
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Plane>
  );
}

function Vision() {
  return (
    <Plane tone="ink" labelledBy="vision-heading">
      <div className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <SectionIndex index={M.vision.index} label={M.vision.label} />
        </div>
        <div className="lg:col-span-8">
          <h2 id="vision-heading" className="sx-hero">
            {M.vision.title}
          </h2>
          <p className="sx-body-lg mt-8 sx-measure">{M.vision.lead}</p>
        </div>
      </div>
    </Plane>
  );
}

function Begin() {
  return (
    <Plane labelledBy="begin-heading">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-8">
          <SectionIndex index={M.cta.index} label={M.cta.label} />
          <h2 id="begin-heading" className="sx-h1 mt-6">
            {M.cta.title}
          </h2>
          <p className="sx-body-lg mt-5 sx-measure">{M.cta.lead}</p>
        </div>
        <div className="flex flex-wrap gap-3 lg:col-span-4 lg:justify-end">
          <ActionLink to="/auth">Create an account</ActionLink>
          <ActionLink to="/security" variant="secondary">
            Read the security model
          </ActionLink>
        </div>
      </div>
      <div aria-hidden="true" className="mt-20 flex items-center gap-4 text-sx-line-strong">
        <SherivsMark className="size-5 text-sx-muted" />
        <span className="h-px flex-1 bg-sx-line" />
      </div>
    </Plane>
  );
}

export function SherivsHome() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: organizationJsonLd() }}
      />
      <Introduction />
      <Category />
      <Reality />
      <Intelligence />
      <Workforce />
      <Missions />
      <Experiences />
      <Runtimes />
      <Governance />
      <Architecture />
      <Vision />
      <Begin />
    </>
  );
}
