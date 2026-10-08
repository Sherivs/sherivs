/**
 * Sherivs homepage — the twelve-chapter narrative
 * (SHERIVS_CONTENT_ARCHITECTURE.md §2 "Homepage narrative").
 *
 * Chapters are declared in `HOME_CHAPTERS`; every figure rendered here is
 * read from a real registry (kernel capability registry, installed runtimes,
 * navigation contributions) — never typed in. No social proof of any kind is
 * fabricated, and every call to action is a real route.
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Chip, Eyebrow, Panel, PlaneLabel, SectionHeading, SectionIndex } from "@/components/sherivs/primitives";
import { CtaLink } from "@/components/sherivs/public/public-shell";
import { PLANES_OF_MEANING, type PlaneOfMeaning } from "@/lib/experience/design-tokens";
import {
  ARCHITECTURE_LAYERS,
  HOME_CHAPTERS,
  INSTALLED_RUNTIME_PROOFS,
  MISSION_CHAIN,
  PLATFORM_PILLARS,
  REALITY_FACETS,
  SECURITY_GUARANTEES,
  pillarBySlug,
} from "@/lib/experience/public-content";
import { KERNEL_CAPABILITIES } from "@/lib/kernel/kernel-capability-registry";
import { INSTALLED_RUNTIMES } from "@/lib/runtime/installed-runtimes";
import { ALL_NAV_CONTRIBUTIONS } from "@/lib/runtime/nav-registry";
import { cn } from "@/lib/utils";

const TOTAL = HOME_CHAPTERS.length;
const chapter = (id: string) => {
  const found = HOME_CHAPTERS.find((item) => item.id === id);
  if (!found) throw new Error(`Homepage chapter "${id}" is not declared`);
  return found;
};

const PLANE_TITLES: Record<PlaneOfMeaning, string> = {
  reality: "Reality",
  intel: "Intelligence",
  action: "Action",
  evidence: "Evidence",
};

const PLANE_LEADS: Record<PlaneOfMeaning, string> = {
  reality: "What is verifiably true.",
  intel: "What is understood, remembered and inferred.",
  action: "What people and governed workers do about it.",
  evidence: "What proves the outcome, and who verified it.",
};

export function SherivsHome() {
  return (
    <>
      <ChapterBrand />
      <ChapterCategory />
      <ChapterReality />
      <ChapterIntelligence />
      <ChapterWorkforce />
      <ChapterMissions />
      <ChapterExperiences />
      <ChapterRuntimes />
      <ChapterGovernance />
      <ChapterArchitecture />
      <ChapterVision />
      <ChapterCta />
    </>
  );
}

/* ── Shared chapter frame ─────────────────────────────────────────── */

function Chapter({
  id,
  className,
  children,
  tight = false,
}: {
  id: string;
  className?: string;
  children: ReactNode;
  tight?: boolean;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn("border-b border-line-1 last:border-b-0", className)}
    >
      <div className={cn("sh-container", tight ? "sh-section-tight" : "sh-section")}>{children}</div>
    </section>
  );
}

function ChapterHeading({ id, align = "start" }: { id: string; align?: "start" | "center" }) {
  const c = chapter(id);
  return (
    <SectionHeading
      id={`${id}-heading`}
      index={c.index}
      total={TOTAL}
      eyebrow={c.eyebrow}
      title={c.title}
      lead={c.lead}
      align={align}
    />
  );
}

/* ── 01 Brand ─────────────────────────────────────────────────────── */

function ChapterBrand() {
  const c = chapter("brand");
  return (
    <section
      id="brand"
      aria-labelledby="brand-heading"
      className="sh-atmosphere sh-gridfield relative overflow-hidden border-b border-line-1"
    >
      <div className="sh-container relative grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-[1.15fr_1fr] lg:py-36">
        <div className="sh-enter">
          <div className="flex items-center gap-3">
            <SectionIndex index={c.index} total={TOTAL} />
            <Eyebrow className="text-signal">{c.eyebrow}</Eyebrow>
          </div>
          <h1 id="brand-heading" className="sh-display mt-6 text-balance">
            {c.title}
          </h1>
          <p className="sh-body-lg sh-prose mt-7 text-ink-2">{c.lead}</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <CtaLink to="/platform">
              Explore the platform <ArrowRight className="size-4" aria-hidden="true" />
            </CtaLink>
            <CtaLink to="/auth" variant="secondary">
              Create account
            </CtaLink>
          </div>
        </div>

        <PlanesDiagram />
      </div>
    </section>
  );
}

/** The four planes of meaning, drawn as stacked infrastructure layers. */
function PlanesDiagram() {
  return (
    <figure className="sh-enter-scale relative mx-auto w-full max-w-md" aria-label="The four planes of meaning: reality, intelligence, action, evidence">
      <ol className="sh-stagger grid gap-3">
        {[...PLANES_OF_MEANING].reverse().map((plane, i) => (
          <li
            key={plane}
            className={cn(
              "sh-panel sh-rail flex items-start gap-4 p-5",
              `sh-tone-${plane}`,
              i === PLANES_OF_MEANING.length - 1 && "sh-panel-raised",
            )}
            style={{ marginInlineStart: `${(PLANES_OF_MEANING.length - 1 - i) * 0.75}rem` }}
          >
            <span className="sh-index mt-1">{String(PLANES_OF_MEANING.length - i).padStart(2, "0")}</span>
            <div>
              <div className="sh-h4" style={{ color: "var(--sh-tone)" }}>
                {PLANE_TITLES[plane]}
              </div>
              <p className="sh-small mt-1 text-ink-2">{PLANE_LEADS[plane]}</p>
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="sh-caption mt-4 text-center">
        One authority model spans all four planes.
      </figcaption>
    </figure>
  );
}

/* ── 02 Category ──────────────────────────────────────────────────── */

function ChapterCategory() {
  return (
    <Chapter id="category">
      <ChapterHeading id="category" />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          { title: "Records", detail: "Live in systems of record that do not share an authority model." },
          { title: "Decisions", detail: "Happen in meetings, messages and spreadsheets, without evidence attached." },
          { title: "Know-how", detail: "Lives in people, and leaves with them." },
        ].map((item) => (
          <Panel key={item.title}>
            <p className="sh-h4">{item.title}</p>
            <p className="sh-small mt-2 text-ink-2">{item.detail}</p>
          </Panel>
        ))}
      </div>
      <Panel raised className="mt-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <p className="sh-h4">Sherivs holds the four together:</p>
          {PLANES_OF_MEANING.map((plane) => (
            <PlaneLabel key={plane} plane={plane} />
          ))}
        </div>
      </Panel>
    </Chapter>
  );
}

/* ── 03 Reality ───────────────────────────────────────────────────── */

function ChapterReality() {
  const pillar = pillarBySlug("reality");
  return (
    <Chapter id="reality" className="bg-plane-1">
      <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
        <div>
          <ChapterHeading id="reality" />
          <ul className="mt-10 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Reality model facets">
            {REALITY_FACETS.map((facet) => (
              <li key={facet} className="sh-inset sh-tone-reality px-3 py-3 text-center">
                <span className="sh-small font-medium text-ink-1">{facet}</span>
              </li>
            ))}
          </ul>
        </div>
        <PropertyList pillar={pillar?.properties ?? []} plane="reality" slug="reality" label="Reality" />
      </div>
    </Chapter>
  );
}

/* ── 04 Intelligence ──────────────────────────────────────────────── */

function ChapterIntelligence() {
  const memory = pillarBySlug("memory");
  const intel = pillarBySlug("intelligence");
  const properties = [...(memory?.properties.slice(0, 2) ?? []), ...(intel?.properties.slice(0, 2) ?? [])];
  return (
    <Chapter id="intelligence">
      <ChapterHeading id="intelligence" />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {properties.map((property) => (
          <Panel key={property.title} tone="intel">
            <p className="sh-h4">{property.title}</p>
            <p className="sh-small mt-2 text-ink-2">{property.detail}</p>
          </Panel>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-4">
        <PillarLink slug="memory" label="Memory" />
        <PillarLink slug="intelligence" label="Intelligence" />
      </div>
    </Chapter>
  );
}

/* ── 05 Workforce ─────────────────────────────────────────────────── */

function ChapterWorkforce() {
  const pillar = pillarBySlug("ai-workforce");
  const chain = pillar?.properties[0]?.title.split(" → ") ?? [];
  return (
    <Chapter id="workforce" className="bg-plane-1">
      <ChapterHeading id="workforce" />
      <ol className="mt-12 flex flex-wrap items-stretch gap-2" aria-label="Governed worker chain">
        {chain.map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className="sh-chip sh-tone-action px-3 py-2">
              <span className="sh-index">{String(i + 1).padStart(2, "0")}</span>
              {step}
            </span>
            {i < chain.length - 1 && <ArrowRight className="size-3.5 text-ink-4" aria-hidden="true" />}
          </li>
        ))}
      </ol>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {(pillar?.properties.slice(1) ?? []).map((property) => (
          <Panel key={property.title} tone="action">
            <p className="sh-h4">{property.title}</p>
            <p className="sh-small mt-2 text-ink-2">{property.detail}</p>
          </Panel>
        ))}
      </div>
      <div className="mt-6">
        <PillarLink slug="ai-workforce" label="AI Workforce" />
      </div>
    </Chapter>
  );
}

/* ── 06 Missions ──────────────────────────────────────────────────── */

function ChapterMissions() {
  return (
    <Chapter id="missions">
      <ChapterHeading id="missions" />
      <ol className="mt-12 grid gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Mission chain">
        {MISSION_CHAIN.map((step, i) => (
          <li key={step.step} className={cn("sh-panel sh-rail p-4", `sh-tone-${step.plane}`)}>
            <div className="flex items-center justify-between">
              <span className="sh-index">{String(i + 1).padStart(2, "0")}</span>
              <PlaneLabel plane={step.plane} />
            </div>
            <p className="sh-h4 mt-3">{step.step}</p>
            <p className="sh-caption mt-1">{step.detail}</p>
          </li>
        ))}
      </ol>
      <div className="mt-6">
        <PillarLink slug="missions" label="Missions" />
      </div>
    </Chapter>
  );
}

/* ── 07 Adaptive experiences ──────────────────────────────────────── */

function ChapterExperiences() {
  return (
    <Chapter id="experiences" className="bg-plane-1">
      <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
        <ChapterHeading id="experiences" />
        <Panel raised className="self-start">
          <p className="sh-label">How a workspace is projected</p>
          <div className="sh-code mt-4 grid gap-2 text-ink-2">
            <Row k="installed runtimes" v={String(INSTALLED_RUNTIMES.length)} />
            <Row k="navigation contributions" v={String(ALL_NAV_CONTRIBUTIONS.length)} />
            <Row k="kernel capabilities" v={String(KERNEL_CAPABILITIES.length)} />
            <Row k="viewer capabilities" v="resolved per identity, server-enforced" />
            <Row k="navigation" v="contributions × authorized capabilities" />
            <Row k="home" v="first authorized destination — never a default runtime" />
          </div>
          <p className="sh-caption mt-4">
            Figures are read from the live registries at build time; the UI is a projection, never
            the authorization.
          </p>
        </Panel>
      </div>
    </Chapter>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-line-1 pb-2 last:border-b-0">
      <span className="text-ink-3">{k}</span>
      <span className="text-ink-1">{v}</span>
    </div>
  );
}

/* ── 08 Runtimes ──────────────────────────────────────────────────── */

function ChapterRuntimes() {
  return (
    <Chapter id="runtimes">
      <ChapterHeading id="runtimes" />
      <div className="mt-12 grid gap-4 lg:grid-cols-[1fr_1fr]">
        {INSTALLED_RUNTIME_PROOFS.map((runtime) => (
          <Panel key={runtime.manifestId} tone="reality">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone="reality" dot>
                Installed runtime
              </Chip>
              <span className="sh-code text-ink-3">{runtime.manifestId}</span>
            </div>
            <p className="sh-h3 mt-4">{runtime.name}</p>
            <p className="sh-small mt-1 text-ink-3">{runtime.description}</p>
            <p className="sh-body mt-4 text-ink-2">{runtime.proof}</p>
            <div className="mt-5 flex flex-wrap gap-4">
              <Link to="/solutions/$segment" params={{ segment: "education" }} className="sh-focus sh-small inline-flex items-center gap-1.5 font-semibold text-signal">
                Education solution <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
              <Link to="/platform/kernel" className="sh-focus sh-small inline-flex items-center gap-1.5 font-semibold text-signal">
                Kernel registry <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          </Panel>
        ))}
        <Panel>
          <p className="sh-label">The rule</p>
          <p className="sh-h4 mt-3">A runtime is a tenant of the kernel, never its owner.</p>
          <ul className="sh-small mt-4 grid gap-2 text-ink-2">
            <li>Runtimes contribute navigation, workspaces and domain surfaces.</li>
            <li>Runtimes consume identity, tenancy, security, AI and evidence from the platform.</li>
            <li>The platform's name, kernel and control plane never carry a runtime's identity.</li>
          </ul>
        </Panel>
      </div>
    </Chapter>
  );
}

/* ── 09 Governance ────────────────────────────────────────────────── */

function ChapterGovernance() {
  return (
    <Chapter id="governance" className="bg-plane-1">
      <ChapterHeading id="governance" />
      <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SECURITY_GUARANTEES.map((guarantee) => (
          <li key={guarantee.id} className="sh-panel sh-rail sh-tone-evidence p-5">
            <p className="sh-h4">{guarantee.title}</p>
            <p className="sh-small mt-2 text-ink-2">{guarantee.description}</p>
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <CtaLink to="/security" variant="secondary">
          Security posture <ArrowRight className="size-4" aria-hidden="true" />
        </CtaLink>
      </div>
    </Chapter>
  );
}

/* ── 10 Architecture ──────────────────────────────────────────────── */

function ChapterArchitecture() {
  return (
    <Chapter id="architecture">
      <ChapterHeading id="architecture" />
      <ol className="mt-12 grid gap-2" aria-label="Architecture layers">
        {ARCHITECTURE_LAYERS.map((layer, i) => (
          <li
            key={layer.name}
            className="sh-panel grid gap-2 p-5 sm:grid-cols-[3rem_12rem_1fr] sm:items-baseline"
          >
            <span className="sh-index">{String(i + 1).padStart(2, "0")}</span>
            <span className="sh-h4">{layer.name}</span>
            <span className="sh-small text-ink-2">{layer.detail}</span>
          </li>
        ))}
      </ol>
    </Chapter>
  );
}

/* ── 11 Vision ────────────────────────────────────────────────────── */

function ChapterVision() {
  return (
    <Chapter id="vision" className="sh-atmosphere bg-plane-1">
      <ChapterHeading id="vision" align="center" />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {PLATFORM_PILLARS.slice(0, 3).map((pillar) => (
          <Panel key={pillar.slug} tone={pillar.plane}>
            <PlaneLabel plane={pillar.plane} />
            <p className="sh-h4 mt-3">{pillar.title}</p>
            <p className="sh-small mt-2 text-ink-2">{pillar.statement}</p>
          </Panel>
        ))}
      </div>
    </Chapter>
  );
}

/* ── 12 CTA ───────────────────────────────────────────────────────── */

function ChapterCta() {
  return (
    <Chapter id="cta" tight>
      <Panel raised className="p-8 sm:p-12">
        <ChapterHeading id="cta" />
        <div className="mt-8 flex flex-wrap gap-3">
          <CtaLink to="/platform">
            Explore the platform <ArrowRight className="size-4" aria-hidden="true" />
          </CtaLink>
          <CtaLink to="/auth" variant="secondary">
            Create account
          </CtaLink>
          <CtaLink to="/pricing" variant="ghost">
            Pricing
          </CtaLink>
        </div>
      </Panel>
    </Chapter>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function PropertyList({
  pillar,
  plane,
  slug,
  label,
}: {
  pillar: readonly { title: string; detail: string }[];
  plane: PlaneOfMeaning;
  slug: string;
  label: string;
}) {
  return (
    <div>
      <ul className="grid gap-3">
        {pillar.map((property) => (
          <li key={property.title} className={cn("sh-panel sh-rail p-4", `sh-tone-${plane}`)}>
            <p className="sh-h4">{property.title}</p>
            <p className="sh-small mt-1 text-ink-2">{property.detail}</p>
          </li>
        ))}
      </ul>
      <PillarLink slug={slug} label={label} className="mt-5" />
    </div>
  );
}

function PillarLink({ slug, label, className }: { slug: string; label: string; className?: string }) {
  return (
    <Link
      to="/platform/$pillar"
      params={{ pillar: slug }}
      className={cn("sh-focus sh-small inline-flex items-center gap-1.5 font-semibold text-signal", className)}
    >
      {label} in depth <ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}
