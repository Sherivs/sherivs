import { createFileRoute } from "@tanstack/react-router";
import { Chip, Metric, Panel } from "@/components/sherivs/primitives";
import { PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";
import { foundationStandardsSnapshot } from "@/lib/foundation-standards";
import {
  KERNEL_CAPABILITIES,
  type KernelCapability,
} from "@/lib/kernel/kernel-capability-registry";
import { phaseContractCoverageSnapshot } from "@/lib/kernel/phase-contracts";
import { INSTALLED_RUNTIMES } from "@/lib/runtime/installed-runtimes";
import { scholarConsumedKernelCapabilities } from "@/lib/runtime/scholar-consumption";

/**
 * Kernel registry — a live, read-only view of the capability registry, the
 * foundation standards and the phase-contract coverage the verification chain
 * enforces. Every figure is read from the same modules the build validates.
 */
const DESCRIPTION =
  "Live view of the kernel capability registry: owned capabilities by phase, the foundation standards every phase consumes, and the capabilities the installed runtime draws from the kernel.";

export const Route = createFileRoute("/(site)/platform/kernel")({
  component: KernelRegistry,
  head: () => ({
    meta: [
      { title: pageTitle("Kernel registry") },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: pageTitle("Kernel registry") },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: canonicalUrl("/platform/kernel") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/platform/kernel") }],
  }),
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

function KernelRegistry() {
  const phaseGroups = groupByPhase(KERNEL_CAPABILITIES);
  const foundation = foundationStandardsSnapshot();
  const consumed = scholarConsumedKernelCapabilities();
  const coverage = phaseContractCoverageSnapshot();
  const runtime = INSTALLED_RUNTIMES[0];

  return (
    <>
      <PublicPageIntro eyebrow="Platform · Kernel" title="The kernel capability registry." lead={DESCRIPTION}>
        <div className="grid w-full grid-cols-2 gap-6 sm:grid-cols-4">
          <Metric label="Kernel capabilities" value={KERNEL_CAPABILITIES.length} />
          <Metric label="Phase contracts" value={coverage.total} />
          <Metric label="Sections per phase" value={coverage.sectionsPerPhase} />
          <Metric label="Installed runtimes" value={INSTALLED_RUNTIMES.length} />
        </div>
      </PublicPageIntro>

      <PublicSection labelledBy="foundation-heading" tight>
        <h2 id="foundation-heading" className="sh-h3">
          Foundation standards
        </h2>
        <p className="sh-small sh-prose mt-2 text-ink-2">
          Capability <code className="sh-code">{foundation.capabilityId}</code> is owned by Phase 01
          and is the one every other phase consumes. It provides the verification contracts the
          platform enforces on itself.
        </p>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {foundation.standards.map((standard) => (
            <li key={standard.id}>
              <Panel className="p-4">
                <p className="sh-code font-semibold text-ink-1">{standard.id}</p>
                <p className="sh-small mt-1 text-ink-2">{standard.description}</p>
              </Panel>
            </li>
          ))}
        </ul>
      </PublicSection>

      <PublicSection labelledBy="capabilities-heading" className="bg-plane-1">
        <h2 id="capabilities-heading" className="sh-h3">
          {KERNEL_CAPABILITIES.length} kernel capabilities
        </h2>
        <p className="sh-small sh-prose mt-2 text-ink-2">
          Every capability is owned by a platform phase. Organizations consume the ones they need;
          runtimes never rewrite the kernel.
        </p>
        <div className="mt-8 grid gap-8">
          {phaseGroups.map(({ phase, capabilities }) => (
            <section key={phase} aria-labelledby={`phase-${phase}`}>
              <h3 id={`phase-${phase}`} className="sh-label mb-3">
                Phase {phase}
              </h3>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {capabilities.map((capability) => (
                  <li key={capability.id} className="sh-panel p-3">
                    <p className="sh-small font-semibold text-ink-1">{capability.label}</p>
                    <p className="sh-code mt-1 text-ink-3">{capability.id}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </PublicSection>

      <PublicSection labelledBy="consumption-heading" tight>
        <h2 id="consumption-heading" className="sh-h3">
          The installed runtime consumes {consumed.length} kernel capabilities
        </h2>
        <p className="sh-small sh-prose mt-2 text-ink-2">
          {runtime.name} ({runtime.description}) inherits the platform's governed core — identity,
          tenancy, security, workspaces, AI — and adds only its own domain. Remove that runtime and
          the kernel stays fully valid.
        </p>
        <ul className="mt-5 flex flex-wrap gap-1.5" aria-label="Consumed kernel capabilities">
          {consumed.map((capability) => (
            <li key={capability.id}>
              <Chip tone="reality">{capability.label}</Chip>
            </li>
          ))}
        </ul>
      </PublicSection>

      <PublicSection labelledBy="contracts-heading" className="bg-plane-1">
        <h2 id="contracts-heading" className="sh-h3">
          {coverage.total} phase contracts · {coverage.sectionsPerPhase} engineering sections each
        </h2>
        <p className="sh-small sh-prose mt-2 text-ink-2">
          Every phase declares the same sections — identity, ownership, boundaries, contracts, data
          model, events, workflows, security, tenancy, AI safety, observability, testing,
          integration, dependencies, risks, completion and extensions — and the claims below are read
          from the same contracts the verification chain enforces.
        </p>

        <ul className="mt-5 flex flex-wrap gap-2" aria-label="Phase layers">
          {coverage.byLayer.map(({ layer, phases }) => (
            <li key={layer}>
              <Chip tone="neutral">
                {layer} · {phases}
              </Chip>
            </li>
          ))}
        </ul>

        <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Metric label="Sections complete" value={`${coverage.sectionsComplete}/${coverage.total}`} />
          <Metric label="Connected roots" value={coverage.roots.join(", ")} />
          <Metric label="Supervised autonomy" value={coverage.byAsiTier["supervised-autonomous"]} />
          <Metric
            label="Governed autonomy"
            value={coverage.byAsiTier["governed-autonomous"] + coverage.byAsiTier["civilization-scale"]}
          />
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Phase contract coverage</caption>
            <thead>
              <tr className="sh-label">
                <th scope="col" className="border-b border-line-2 py-2 pr-3 font-medium">Phase</th>
                <th scope="col" className="border-b border-line-2 py-2 pr-3 font-medium">Owned capability</th>
                <th scope="col" className="border-b border-line-2 py-2 pr-3 font-medium">Sections</th>
                <th scope="col" className="border-b border-line-2 py-2 pr-3 font-medium">Autonomy</th>
                <th scope="col" className="border-b border-line-2 py-2 pr-3 font-medium">Depends on</th>
                <th scope="col" className="border-b border-line-2 py-2 font-medium">Neutral seats</th>
              </tr>
            </thead>
            <tbody className="sh-small">
              {coverage.rows.map((row) => (
                <tr key={row.id}>
                  <td className="border-b border-line-1 py-1.5 pr-3">
                    <span className="sh-code text-ink-3">{row.id}</span> {row.name}
                  </td>
                  <td className="sh-code border-b border-line-1 py-1.5 pr-3 text-ink-3">
                    {row.capability ?? "composes others"}
                  </td>
                  <td className="border-b border-line-1 py-1.5 pr-3">
                    {row.sectionsDeclared}/{row.sectionsTotal}
                  </td>
                  <td className="border-b border-line-1 py-1.5 pr-3">
                    {row.asiTier} · L{row.autonomyLevel}
                  </td>
                  <td className="border-b border-line-1 py-1.5 pr-3">{row.dependencies}</td>
                  <td className="border-b border-line-1 py-1.5">{row.neutralSeats}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="sh-caption mt-4">
          Contracts are validated on every change: sections, capability ownership, dependency and
          consumer law, ASI invariants, neutral runtime seats and phase-name alignment with the
          canonical registry.
        </p>
      </PublicSection>
    </>
  );
}
