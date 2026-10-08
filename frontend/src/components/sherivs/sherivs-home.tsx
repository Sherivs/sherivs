import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArrowRight } from "@/components/sherivs/sherivs-icons";
import { INSTALLED_RUNTIMES } from "@/lib/runtime/installed-runtimes";
import { KERNEL_CAPABILITIES } from "@/lib/kernel/kernel-capability-registry";

/**
 * Sherivs public homepage narrative (V1).
 *
 * Twelve narrative movements, zero fabrication: every capability named here
 * resolves to an implemented platform surface, and every call to action
 * targets a real route. No testimonials, no customer logos, no invented
 * metrics — the kernel capability count is read from the same registry the
 * platform page renders.
 */

function Movement({
  index,
  eyebrow,
  title,
  lead,
  children,
}: {
  index: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`movement-${index}`}
      className="border-b border-border last:border-b-0"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="font-mono text-xs tracking-widest text-muted-foreground">{index}</p>
        <p className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {eyebrow}
        </p>
        <h2
          id={`movement-${index}`}
          className="mt-2 max-w-3xl font-display text-2xl font-bold tracking-tight text-balance sm:text-4xl"
        >
          {title}
        </h2>
        {lead && (
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {lead}
          </p>
        )}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}

function CapabilityGrid({ items }: { items: readonly { title: string; body: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <li
          key={item.title}
          className="rounded-xl border border-border p-5 transition-colors hover:bg-muted/30"
        >
          <h3 className="font-display text-base font-semibold">{item.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
        </li>
      ))}
    </ul>
  );
}

function CtaRow({ children }: { children: ReactNode }) {
  return <div className="mt-8 flex flex-wrap items-center gap-3">{children}</div>;
}

function PrimaryCta({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function SecondaryCta({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </Link>
  );
}

const REALITY_FACETS = [
  { title: "People", body: "Members, teams and roles with verifiable membership and authority." },
  {
    title: "Systems",
    body: "Connected services behind governed adapters — never direct vendor coupling.",
  },
  {
    title: "Knowledge",
    body: "Documents and records with provenance: who created them, when, and whether verified.",
  },
  { title: "Events", body: "A durable event record of what happened across the organization." },
  {
    title: "State",
    body: "Current operational truth — attendance, balances, readiness — held canonically.",
  },
  {
    title: "Decisions",
    body: "Approvals and outcomes captured with authority, cost and audit trail.",
  },
] as const;

const INTELLIGENCE_LAYERS = [
  {
    title: "Context",
    body: "Every request resolves identity, tenant, role and purpose before anything else.",
  },
  {
    title: "Memory",
    body: "Agent and organizational memory scoped by tenant, owner and permission.",
  },
  {
    title: "Knowledge",
    body: "Retrieval over governed sources with citations, never silent invention.",
  },
  {
    title: "Action",
    body: "AI proposes; policy checks, humans approve, the platform executes and audits.",
  },
] as const;

const MISSION_PIPELINE = [
  "Mission",
  "Workforce",
  "Execution",
  "Evidence",
  "Verification",
  "Outcome",
] as const;

export function SherivsHome() {
  return (
    <>
      {/* 01 — Brand introduction */}
      <section
        aria-labelledby="sherivs-hero"
        className="relative overflow-hidden border-b border-border"
      >
        <div className="sherivs-hero-atmosphere" aria-hidden="true" />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <p className="font-mono text-xs tracking-[0.3em] text-muted-foreground">SHERIVS</p>
          <h1
            id="sherivs-hero"
            className="mt-4 max-w-4xl font-display text-4xl font-bold tracking-tight text-balance sm:text-6xl"
          >
            Institutional intelligence infrastructure.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Sherivs is the operational layer organizations run on: one governed platform that models
            organizational reality, deploys an AI workforce inside real authority boundaries, and
            proves every outcome with evidence.
          </p>
          <CtaRow>
            <PrimaryCta to="/request-demo">Request a demo</PrimaryCta>
            <SecondaryCta to="/platform">Explore the platform</SecondaryCta>
          </CtaRow>
        </div>
      </section>

      {/* 02 — Category explanation */}
      <Movement
        index="02"
        eyebrow="The category"
        title="Organizations don't need another app. They need an operational layer."
        lead="Every institution already runs on disconnected tools: messaging here, records there, approvals over here, institutional knowledge nowhere. Sherivs is not one more tool in that sprawl — it is the governed layer underneath: identity, reality, intelligence, execution and evidence, shared by every surface the organization uses."
      />

      {/* 03 — Organizational reality */}
      <Movement
        index="03"
        eyebrow="Organizational reality"
        title="One model of what your organization is."
        lead="Sherivs holds a living model of the institution — not a dashboard of disconnected widgets. When reality is modeled once, every workspace, report, automation and AI worker reasons over the same truth."
      >
        <CapabilityGrid items={REALITY_FACETS} />
      </Movement>

      {/* 04 — Intelligence layer */}
      <Movement
        index="04"
        eyebrow="The intelligence layer"
        title="AI that knows what it is allowed to know."
        lead="Intelligence in Sherivs is gated the same way everything else is: identity, authorization, classification, purpose and minimization checks run before any model sees organizational data — and every output carries its provenance."
      >
        <CapabilityGrid items={INTELLIGENCE_LAYERS} />
      </Movement>

      {/* 05 — AI workforce */}
      <Movement
        index="05"
        eyebrow="The AI workforce"
        title="Governed workers operating alongside humans."
        lead="AI workers in Sherivs are governed entities, not autonomous characters. Each worker holds a capability profile, an authority boundary, workload and health — and every action it takes is attributable, reviewable and revocable."
      >
        <CtaRow>
          <SecondaryCta to="/platform#capabilities">How workers are governed</SecondaryCta>
        </CtaRow>
      </Movement>

      {/* 06 — Mission system */}
      <Movement
        index="06"
        eyebrow="The mission system"
        title="Work that proves itself."
        lead="A mission is a first-class organizational object: planned, assigned, executed and verified — with evidence captured at every step and approvals where authority requires them."
      >
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6" aria-label="Mission lifecycle">
          {MISSION_PIPELINE.map((step, position) => (
            <li
              key={step}
              className="relative rounded-xl border border-border p-4 transition-colors hover:bg-muted/30"
            >
              <p className="font-mono text-[11px] text-muted-foreground">
                {String(position + 1).padStart(2, "0")}
              </p>
              <p className="mt-1 font-display text-sm font-semibold">{step}</p>
            </li>
          ))}
        </ol>
      </Movement>

      {/* 07 — Adaptive experiences */}
      <Movement
        index="07"
        eyebrow="Adaptive experiences"
        title="The interface follows the organization — not the other way around."
        lead="Navigation in Sherivs is capability-driven: what a person sees depends on their role, their permissions and the runtimes their organization runs. Nobody wades through menus for things they are not authorized to touch."
      />

      {/* 08 — Domain runtimes */}
      <Movement
        index="08"
        eyebrow="Domain runtimes"
        title="Specialized worlds on shared rails."
        lead="A domain runtime adapts Sherivs to a sector — its vocabulary, workflows and compliance — while inheriting the governed core. The platform stays intact; the runtime brings only its domain."
      >
        <ul className="grid gap-3 lg:grid-cols-2">
          {INSTALLED_RUNTIMES.map((runtime) => (
            <li key={runtime.id} className="rounded-xl border border-border bg-muted/20 p-6">
              <h3 className="font-display text-lg font-semibold">Sherivs {runtime.name}</h3>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                {runtime.description}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Installed on the Sherivs kernel as a governed consumer: identity, workspaces, AI and
                audit come from the platform, and the runtime contributes only its sector domain.
              </p>
            </li>
          ))}
        </ul>
        <CtaRow>
          <SecondaryCta to="/solutions/education">Sherivs for education</SecondaryCta>
        </CtaRow>
      </Movement>

      {/* 09 — Governance */}
      <Movement
        index="09"
        eyebrow="Governance"
        title="Trust you can inspect."
        lead="Tenant isolation is enforced in the database, not just the interface. Row-level security, layered authorization, immutable audit records and policy checks on every AI operation — the same guarantees for every tenant, every runtime, every worker."
      >
        <CtaRow>
          <SecondaryCta to="/security">Security and governance</SecondaryCta>
        </CtaRow>
      </Movement>

      {/* 10 — Enterprise architecture */}
      <Movement
        index="10"
        eyebrow="Enterprise architecture"
        title={`A kernel, not a monolith: ${KERNEL_CAPABILITIES.length} contracted capabilities.`}
        lead="The Sherivs kernel exposes contracted capabilities — identity, tenancy, workspaces, AI, security, analytics and more — that runtimes consume without rewriting. Contracts are validated on every change; the platform cannot silently drift."
      >
        <CtaRow>
          <SecondaryCta to="/platform">Read the kernel detail</SecondaryCta>
        </CtaRow>
      </Movement>

      {/* 11 — Future vision */}
      <Movement
        index="11"
        eyebrow="The direction"
        title="A new category: infrastructure for institutional intelligence."
        lead="Spreadsheets recorded the past. Dashboards summarized it. Sherivs operates in the present: the layer where an organization's reality, its people, its AI workforce and its evidence live together under governance. That layer did not previously exist as infrastructure — we are building it in the open, one verified capability at a time."
      />

      {/* 12 — CTA */}
      <section aria-labelledby="sherivs-cta">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="rounded-2xl border border-border bg-muted/20 p-8 text-center sm:p-12">
            <h2
              id="sherivs-cta"
              className="font-display text-2xl font-bold tracking-tight text-balance sm:text-3xl"
            >
              Put your institution on governed rails.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Create an account and an administrator links your identity to your organization — with
              roles, policies and workspaces projected from the governed core.
            </p>
            <CtaRow>
              <span className="mx-auto flex flex-wrap items-center justify-center gap-3">
                <PrimaryCta to="/request-demo">Request a demo</PrimaryCta>
                <SecondaryCta to="/platform">Explore the platform</SecondaryCta>
              </span>
            </CtaRow>
          </div>
        </div>
      </section>
    </>
  );
}
