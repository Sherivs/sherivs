import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import {
  KERNEL_CAPABILITIES,
  type KernelCapability,
} from "@/lib/kernel/kernel-capability-registry";
import { phaseContractCoverageSnapshot } from "@/lib/kernel/phase-contracts";
import { foundationStandardsSnapshot } from "@/lib/foundation-standards";
import { scholarConsumedKernelCapabilities } from "@/lib/runtime/scholar-consumption";
import { INSTALLED_RUNTIME_BRAND_NAME } from "@/lib/runtime/installed-runtimes";
import {
  LAYER_AVAILABILITY_DETAIL,
  LAYER_AVAILABILITY_LABEL,
  PLATFORM_LAYERS,
} from "@/content/sherivs/platform-layers";
import { publicPageHead } from "@/content/sherivs/seo";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { ActionLink, PageHero, Plane, SectionHeading, StatusDot } from "@/components/sherivs/primitives";

/**
 * Sherivs platform overview at /platform — the seven platform layers, then the kernel
 * detail read live from the same contracts the verification chain enforces (capability
 * registry, foundation standards, phase contract coverage). Nothing on this page is a
 * hand-typed total.
 */
export const Route = createFileRoute("/platform")({
  component: Platform,
  head: () => publicPageHead("/platform"),
});

function groupByPhase(capabilities: readonly KernelCapability[]): Array<{
  phase: string;
  capabilities: KernelCapability[];
}> {
  const groups = new Map<string, KernelCapability[]>();
  for (const capability of capabilities) {
    const list = groups.get(capability.ownerPhase) ?? [];
    list.push(capability);
    groups.set(capability.ownerPhase, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([phase, capabilities]) => ({ phase, capabilities }));
}

function Platform() {
  return (
    <SherivsPublicShell>
      <PageHero
        id="platform-heading"
        label="Platform"
        title="One governed layer. Seven responsibilities."
        lead="Sherivs models what is true in an organization, keeps what it knows, puts governed AI workers to work on it, and proves every outcome. Each layer has one job and the same rules."
      >
        <ActionLink to="/security">How the platform is secured</ActionLink>
        <ActionLink to="/auth" variant="secondary">
          Create an account
        </ActionLink>
      </PageHero>
      <Layers />
      <Kernel />
    </SherivsPublicShell>
  );
}

function Layers() {
  return (
    <Plane labelledBy="layers-heading">
      <SectionHeading
        id="layers-heading"
        label="The layers"
        title="Read top to bottom: reality, then intelligence, then action, then proof."
        lead={
          <>
            Every layer is marked honestly. <strong>{LAYER_AVAILABILITY_LABEL.in_service}</strong>:{" "}
            {LAYER_AVAILABILITY_DETAIL.in_service} <strong>{LAYER_AVAILABILITY_LABEL.foundation}</strong>:{" "}
            {LAYER_AVAILABILITY_DETAIL.foundation}
          </>
        }
      />
      <ol className="mt-16 border-t border-sx-line-strong">
        {PLATFORM_LAYERS.map((layer) => (
          <li key={layer.slug} className="border-b border-sx-line">
            <Link
              to="/platform/$layer"
              params={{ layer: layer.slug }}
              className="group grid gap-4 py-8 transition-colors md:grid-cols-12 md:gap-10"
            >
              <span className="sx-data text-sx-muted md:col-span-1">{layer.index}</span>
              <span className="md:col-span-4">
                <span className="sx-h3 block group-hover:text-sx-signal">{layer.name}</span>
                <span className="mt-3 block">
                  <StatusDot
                    tone={layer.availability === "in_service" ? "verification" : "observation"}
                    label={LAYER_AVAILABILITY_LABEL[layer.availability]}
                  />
                </span>
              </span>
              <span className="sx-body text-sx-muted md:col-span-6">{layer.statement}</span>
              <ArrowUpRight
                aria-hidden="true"
                className="hidden size-5 text-sx-muted group-hover:text-sx-signal md:col-span-1 md:block md:justify-self-end"
              />
            </Link>
          </li>
        ))}
      </ol>
    </Plane>
  );
}

function Kernel() {
  const phaseGroups = groupByPhase(KERNEL_CAPABILITIES);
  const foundation = foundationStandardsSnapshot();
  const consumed = scholarConsumedKernelCapabilities();
  const coverage = phaseContractCoverageSnapshot();

  return (
    <Plane tone="raised" id="kernel" labelledBy="kernel-heading">
      <SectionHeading
        id="kernel-heading"
        label="Kernel detail"
        title={`${KERNEL_CAPABILITIES.length} kernel capabilities, each owned by one platform phase.`}
        lead="Organizations consume the capabilities they need; runtimes never rewrite the kernel. Everything below is read from the contracts at build time."
      />

      <section aria-labelledby="foundation-heading" className="mt-16 lg:ml-[33.333%]">
        <h3 id="foundation-heading" className="sx-h4">
          The foundation standards behind every capability
        </h3>
        <p className="sx-small mt-2 text-sx-muted">
          Capability <code className="sx-code">{foundation.capabilityId}</code> is owned by Phase 01
          and consumed by every other phase. It provides the verification contracts the platform
          enforces on itself:
        </p>
        <dl className="mt-6 border-t border-sx-line-strong">
          {foundation.standards.map((standard) => (
            <div key={standard.id} className="grid gap-1 border-b border-sx-line py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="sx-data text-sx-strong">{standard.id}</dt>
              <dd className="sx-small text-sx-muted">{standard.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="capabilities-heading" className="mt-20">
        <h3 id="capabilities-heading" className="sx-label">
          Capabilities by owning phase
        </h3>
        <div className="mt-6 grid gap-x-10 border-t border-sx-line-strong md:grid-cols-2 xl:grid-cols-3">
          {phaseGroups.map(({ phase, capabilities }) => (
            <section key={phase} aria-label={`Phase ${phase}`} className="border-b border-sx-line py-5">
              <p className="sx-data text-sx-muted">Phase {phase}</p>
              <ul className="mt-2 grid gap-1.5">
                {capabilities.map((capability) => (
                  <li key={capability.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-sm text-sx-strong">{capability.label}</span>
                    <code className="sx-code text-[0.6875rem] text-sx-muted">{capability.id}</code>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section aria-labelledby="runtime-consumption-heading" className="mt-20 lg:ml-[33.333%]">
        <h3 id="runtime-consumption-heading" className="sx-h4">
          {INSTALLED_RUNTIME_BRAND_NAME} consumes {consumed.length} kernel capabilities
        </h3>
        <p className="sx-small mt-2 text-sx-muted">
          An installed runtime inherits the platform's governed core — identity, tenancy, security,
          workspaces, AI — and adds only its own domain. Remove that runtime and the kernel stays
          fully valid.
        </p>
        <ul className="mt-5 flex flex-wrap gap-1.5">
          {consumed.map((capability) => (
            <li key={capability.id} className="sx-caption border border-sx-line bg-sx-surface-1 px-2.5 py-1">
              {capability.label}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="contracts-heading" className="mt-20">
        <h3 id="contracts-heading" className="sx-h4">
          {coverage.total} phase contracts · {coverage.sectionsPerPhase} engineering sections each
        </h3>
        <p className="sx-small mt-2 max-w-prose text-sx-muted">
          Every phase declares the same sections — identity, ownership, boundaries, contracts, data
          model, events, workflows, security, tenancy, AI safety, observability, testing,
          integration, dependencies, risks, completion and extensions.
        </p>

        <ul className="mt-6 flex flex-wrap gap-2">
          {coverage.byLayer.map(({ layer, phases }) => (
            <li key={layer} className="sx-data border border-sx-line px-3 py-1 text-sx-text">
              {layer} · {phases}
            </li>
          ))}
        </ul>

        <dl className="mt-8 grid border-t border-sx-line-strong sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-b border-sx-line py-4 pr-6">
            <dt className="sx-label">Sections complete</dt>
            <dd className="sx-metric mt-2">
              {coverage.sectionsComplete}/{coverage.total}
            </dd>
          </div>
          <div className="border-b border-sx-line py-4 pr-6">
            <dt className="sx-label">Connected roots</dt>
            <dd className="sx-data mt-2 text-sx-strong">{coverage.roots.join(", ")}</dd>
          </div>
          <div className="border-b border-sx-line py-4 pr-6">
            <dt className="sx-label">Supervised autonomy</dt>
            <dd className="sx-metric mt-2">{coverage.byAsiTier["supervised-autonomous"]}</dd>
          </div>
          <div className="border-b border-sx-line py-4 pr-6">
            <dt className="sx-label">Governed autonomy</dt>
            <dd className="sx-metric mt-2">
              {coverage.byAsiTier["governed-autonomous"] + coverage.byAsiTier["civilization-scale"]}
            </dd>
          </div>
        </dl>

        <div className="mt-8 overflow-x-auto border border-sx-line bg-sx-surface-1" tabIndex={0} role="region" aria-label="Phase contract table">
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">Phase contracts, owned capability, declared sections, autonomy tier, dependencies and neutral runtime seats</caption>
            <thead className="bg-sx-surface-2">
              <tr className="sx-label">
                <th scope="col" className="border-b border-sx-line px-3 py-2.5 font-medium">Phase</th>
                <th scope="col" className="border-b border-sx-line px-3 py-2.5 font-medium">Owned capability</th>
                <th scope="col" className="border-b border-sx-line px-3 py-2.5 font-medium">Sections</th>
                <th scope="col" className="border-b border-sx-line px-3 py-2.5 font-medium">Autonomy</th>
                <th scope="col" className="border-b border-sx-line px-3 py-2.5 font-medium">Depends on</th>
                <th scope="col" className="border-b border-sx-line px-3 py-2.5 font-medium">Neutral seats</th>
              </tr>
            </thead>
            <tbody>
              {coverage.rows.map((row) => (
                <tr key={row.id} className="text-sx-text">
                  <th scope="row" className="border-b border-sx-line px-3 py-2 font-normal">
                    <span className="sx-code text-[0.625rem] text-sx-muted">{row.id}</span> {row.name}
                  </th>
                  <td className="sx-code border-b border-sx-line px-3 py-2 text-[0.625rem] text-sx-muted">
                    {row.capability ?? "composes others"}
                  </td>
                  <td className="border-b border-sx-line px-3 py-2">
                    {row.sectionsDeclared}/{row.sectionsTotal}
                  </td>
                  <td className="border-b border-sx-line px-3 py-2">
                    {row.asiTier} · L{row.autonomyLevel}
                  </td>
                  <td className="border-b border-sx-line px-3 py-2">{row.dependencies}</td>
                  <td className="border-b border-sx-line px-3 py-2">{row.neutralSeats}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sx-caption mt-3">
          Contracts are validated on every change: sections, capability ownership, dependency and
          consumer law, ASI invariants, neutral runtime seats and phase-name alignment with the
          canonical registry.
        </p>
      </section>
    </Plane>
  );
}
