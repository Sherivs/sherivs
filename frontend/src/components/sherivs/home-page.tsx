/**
 * Sherivs home — the category narrative.
 *
 * Reality → Intelligence → Action → Evidence, in that order, because that is
 * the product's actual structure. Every statement derives from
 * lib/experience-system/public-content.ts; there are no customer logos,
 * metrics or testimonials because none are real.
 */
import { ArrowRight } from "lucide-react";
import {
  ARCHITECTURE_LAYERS,
  CATEGORY_COMPARISON,
  GOVERNANCE_FACETS,
  INTELLIGENCE_LAYERS,
  REALITY_FACETS,
} from "@/lib/experience-system/public-content";
import { SHERIVS_BRAND } from "@/lib/experience-system/sherivs-brand";
import { ExperienceEquation, LayerStack, MissionFlow, PlaneStack } from "./diagrams";
import { Container, DefinitionRows, LinkButton, PlaneMarker, Section, SvLink } from "./primitives";

function Hero() {
  return (
    <section aria-labelledby="home-title" className="border-b border-sv-border">
      <Container className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div>
          <p className="sv-label mb-5 text-sv-text-muted">{SHERIVS_BRAND.category}</p>
          <h1 id="home-title" className="sv-hero">
            Run your institution on a governed model of its own reality.
          </h1>
          <p className="sv-body mt-6 max-w-[56ch] text-sv-text-muted">
            Sherivs models what an organization is, gives it memory and context, and lets a governed
            AI workforce complete missions — with evidence and independent verification on every outcome.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <LinkButton to="/auth" variant="primary">
              Create account
            </LinkButton>
            <LinkButton to="/platform" variant="secondary">
              Explore the platform
              <ArrowRight aria-hidden="true" className="size-4" />
            </LinkButton>
          </div>
        </div>
        <PlaneStack className="mx-auto w-full max-w-md" />
      </Container>
    </section>
  );
}

export function HomePage() {
  return (
    <>
      <Hero />

      <Section
        id="category"
        eyebrow="The category"
        title="Not another application. The layer beneath them."
        lead="Most institutions run on tools that each hold their own version of the truth, with AI bolted on beside them. Sherivs is the infrastructure those tools and that AI can be governed through."
      >
        <div className="grid gap-px bg-sv-border md:grid-cols-2" role="table" aria-label="Without and with Sherivs">
          <div role="row" className="contents">
            <p role="columnheader" className="sv-label bg-sv-surface-sunken px-5 py-3 text-sv-text-subtle">
              Without infrastructure
            </p>
            <p role="columnheader" className="sv-label bg-sv-surface-sunken px-5 py-3 text-sv-accent-text">
              With Sherivs
            </p>
          </div>
          {CATEGORY_COMPARISON.map((row) => (
            <div key={row.without} role="row" className="contents">
              <p role="cell" className="bg-sv-surface-1 px-5 py-4 text-sv-text-muted">
                {row.without}
              </p>
              <p role="cell" className="bg-sv-surface-1 px-5 py-4 text-sv-text">
                {row.withSherivs}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="reality"
        eyebrow="Plane 1 · Reality"
        plane="reality"
        tone="sunken"
        title="Start from what is true."
        lead="Every organization already has a reality. Sherivs represents it as verified records with owners, history and provenance — and keeps it apart from anything merely inferred."
      >
        <DefinitionRows
          rows={REALITY_FACETS.map((f) => ({ key: f.key, term: f.title, detail: f.body, plane: "reality" as const }))}
        />
        <p className="mt-8">
          <SvLink to="/platform/reality" className="inline-flex items-center gap-2 text-sv-accent-text">
            How Sherivs models reality <ArrowRight aria-hidden="true" className="size-4" />
          </SvLink>
        </p>
      </Section>

      <Section
        id="intelligence"
        eyebrow="Plane 2 · Intelligence"
        plane="intelligence"
        title="Intelligence with context, memory and limits."
        lead="Context is assembled per task from what that task may see. Memory keeps its sources. Every model call passes through one gateway that decides what may be sent and what may come back."
      >
        <DefinitionRows
          rows={INTELLIGENCE_LAYERS.map((l) => ({
            key: l.key,
            term: l.title,
            detail: l.body,
            note: l.bound,
            plane: "intelligence" as const,
          }))}
        />
      </Section>

      <Section
        id="action"
        eyebrow="Planes 3 and 4 · Action and Evidence"
        plane="action"
        tone="sunken"
        title="Work is a mission. A mission ends in evidence."
        lead="A governed AI workforce does the work inside authority it was granted. An outcome is accepted only after someone other than the producer has checked the evidence."
      >
        <MissionFlow />
        <p className="mt-8">
          <SvLink to="/platform/ai-workforce" className="inline-flex items-center gap-2 text-sv-accent-text">
            How the AI workforce is governed <ArrowRight aria-hidden="true" className="size-4" />
          </SvLink>
        </p>
      </Section>

      <Section
        id="governance"
        eyebrow="Governance"
        plane="evidence"
        tone="ink"
        title="Governance is the product, not a settings page."
        lead="Authority, policy, evidence, verification and audit are native properties of the platform — enforced below the interface, so hiding a button is never the control."
      >
        <DefinitionRows
          rows={GOVERNANCE_FACETS.map((f) => ({ key: f.key, term: f.title, detail: f.body }))}
        />
        <p className="mt-8">
          <SvLink to="/security" className="inline-flex items-center gap-2 text-sv-accent-text">
            Read the security model <ArrowRight aria-hidden="true" className="size-4" />
          </SvLink>
        </p>
      </Section>

      <Section
        id="experience"
        eyebrow="One platform, many experiences"
        title="Every workspace is generated from your organization."
        lead="The interface is not drawn by hand per customer. It is derived from your organization's reality, capabilities, roles and permissions — and can only ever offer less than a person is authorized to do, never more."
      >
        <ExperienceEquation />
      </Section>

      <Section
        id="architecture"
        eyebrow="Architecture"
        tone="sunken"
        title="Five layers, with providers behind adapters."
        lead="Domain logic never depends on a vendor. Payments, messaging, storage and AI reach the platform through replaceable adapters."
      >
        <LayerStack />
        <p className="sv-small mt-4 text-sv-text-subtle">
          {ARCHITECTURE_LAYERS.length} layers · tenant isolation enforced by the database
        </p>
      </Section>

      <Section
        id="scholar"
        eyebrow="First runtime"
        title="The education runtime: Sherivs Scholar."
        lead="A runtime is an application installed on the platform: it consumes the governed core and adds only its own domain. The education runtime is the first one installed; the platform stays valid without it."
      >
        <LinkButton to="/solutions/education" variant="secondary">
          About Sherivs Scholar
          <ArrowRight aria-hidden="true" className="size-4" />
        </LinkButton>
      </Section>

      <section aria-labelledby="home-cta" className="border-t border-sv-border">
        <Container className="flex flex-col items-start gap-6 py-16 sm:py-20 md:flex-row md:items-center md:justify-between">
          <div className="sv-reading">
            <PlaneMarker plane="evidence">Begin</PlaneMarker>
            <h2 id="home-cta" className="sv-h1 mt-3">
              Create an account on the real platform.
            </h2>
            <p className="mt-3 text-sv-text-muted">
              Sign-up creates your identity. An administrator then links it to your organization, and your
              workspace is projected from the roles and policies they define.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <LinkButton to="/auth" variant="primary">
              Create account
            </LinkButton>
            <LinkButton to="/pricing" variant="secondary">
              View pricing
            </LinkButton>
          </div>
        </Container>
      </section>
    </>
  );
}
