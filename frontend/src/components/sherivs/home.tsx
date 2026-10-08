/**
 * Sherivs narrative homepage (public plane).
 *
 * Twelve movements, editorial rather than a card grid. Copy comes from
 * lib/sherivs/public-content.ts (evidence-linked); nothing here asserts a
 * customer, metric, logo, testimonial or live activity. The one "example" is
 * explicitly labelled illustrative.
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SherivsSymbol } from "@/components/sherivs/brand-mark";
import { PublicShell } from "@/components/sherivs/public-shell";
import { EpistemicBlock, PlaneRail, VerificationBadge, ProvenanceLine } from "@/components/sherivs/trust";
import { BRAND_CATEGORY, BRAND_PRODUCTS } from "@/lib/sherivs/brand";
import { CAPABILITIES, HOME_NARRATIVE as N } from "@/lib/sherivs/public-content";
import { navLabel, livePublicRoutes } from "@/lib/sherivs/routes";

function Movement({
  index,
  eyebrow,
  title,
  body,
  id,
  children,
  tone,
}: {
  index: string;
  eyebrow: string;
  title: string;
  body: string;
  id: string;
  children?: React.ReactNode;
  tone?: "ground";
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={`sv-section border-b border-[color:var(--sv-line)] ${tone === "ground" ? "sv-ground" : ""}`}
    >
      <div className="sv-page-wide grid gap-12 lg:grid-cols-12">
        <header className="grid content-start gap-4 lg:col-span-5">
          <p className="sv-label sv-muted">
            <span className="sv-data sv-faint mr-3">{index}</span>
            {eyebrow}
          </p>
          <h2 id={`${id}-heading`} className="sv-h1">
            {title}
          </h2>
          <p className="sv-body sv-muted max-w-xl">{body}</p>
        </header>
        <div className="lg:col-span-6 lg:col-start-7">{children}</div>
      </div>
    </section>
  );
}

function HeroIllustration() {
  return (
    <figure className="sv-raised grid gap-4 p-5 sm:p-6" aria-label="Illustrative example of how Sherivs labels output">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="sv-label sv-faint">How Sherivs labels output</span>
        <span className="sv-label sv-muted rounded-[var(--sv-radius-sm)] border border-[color:var(--sv-line-strong)] px-2 py-0.5">
          Illustrative
        </span>
      </figcaption>
      <EpistemicBlock kind="observation" title="Attendance record" source="Reality model">
        A verified record, read as it is. Nothing is inferred.
      </EpistemicBlock>
      <EpistemicBlock kind="inference" title="A pattern that may matter" confidence={null}>
        Derived from records the requester is authorized to see. Shown with its confidence — or as
        &ldquo;not assessed&rdquo;.
      </EpistemicBlock>
      <EpistemicBlock kind="recommendation" title="A suggested next step">
        Does nothing until someone with authority approves it.
      </EpistemicBlock>
      <div className="sv-rule pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <VerificationBadge state="pending" by="independent verifier" />
          <ProvenanceLine worker="a named worker" action="proposal" outcome="awaiting approval" />
        </div>
      </div>
    </figure>
  );
}

export function SherivsHome() {
  const platformLinks = livePublicRoutes().filter((r) => r.nav?.group === "platform" && r.path !== "/platform");
  return (
    <PublicShell>
      {/* 01 — Hero */}
      <section aria-labelledby="home-title" className="sv-blueprint border-b border-[color:var(--sv-line)]">
        <div className="sv-page-wide grid items-center gap-12 pb-16 pt-14 sm:pb-24 sm:pt-20 lg:grid-cols-12">
          <div className="grid gap-7 lg:col-span-7">
            <p className="sv-label sv-muted flex items-center gap-3">
              <SherivsSymbol size={18} animate />
              {BRAND_CATEGORY}
            </p>
            <h1 id="home-title" className="sv-display">
              The infrastructure an institution thinks and acts on.
            </h1>
            <p className="sv-body sv-muted max-w-2xl text-lg">
              Sherivs holds an organization&rsquo;s reality, lets intelligence work on it under
              authority, and keeps the evidence — so people and AI can do real work together and still
              be accountable for it.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/auth" className="sv-btn sv-btn-primary sv-btn-lg">
                Get started
                <ArrowRight aria-hidden className="size-4" />
              </Link>
              <Link to="/platform" className="sv-btn sv-btn-lg">
                Explore the platform
              </Link>
            </div>
          </div>
          <div className="lg:col-span-5">
            <HeroIllustration />
          </div>
        </div>
      </section>

      {/* 02 — Category */}
      <Movement id="category" {...N.category} tone="ground" />

      {/* 03 — Reality */}
      <Movement id="reality" {...N.reality}>
        <ul aria-label="What the reality model holds" className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line)] bg-[color:var(--sv-line)] sm:grid-cols-4">
          {N.reality.facets.map((f) => (
            <li key={f} className="sv-ground sv-small px-4 py-5">
              {f}
            </li>
          ))}
        </ul>
        <p className="sv-caption sv-faint mt-3">
          Verified truth stays separate from inference. Inference never overwrites it without validation.
        </p>
      </Movement>

      {/* 04 — Intelligence */}
      <Movement
        id="intelligence"
        index="04"
        eyebrow="Intelligence"
        title="Four planes, kept distinct."
        body="Intelligence is useful when you can tell what is true, what is inferred, what is being done and what proves it. Sherivs never blurs them."
        tone="ground"
      >
        <PlaneRail items={N.planes} />
      </Movement>

      {/* 05 — AI workforce */}
      <Movement id="workforce" {...N.workforce}>
        <ul className="grid gap-px overflow-hidden rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line)] bg-[color:var(--sv-line)]">
          {["Identity and an accountable owner", "A declared scope and set of tools", "A lease that expires", "Results checked by something other than the worker"].map((t) => (
            <li key={t} className="sv-ground sv-small px-5 py-4">
              {t}
            </li>
          ))}
        </ul>
        <p className="sv-small sv-muted mt-4">
          <Link to="/platform/$capability" params={{ capability: "ai-workforce" }} className="sv-link">
            How the AI workforce is governed
          </Link>
        </p>
      </Movement>

      {/* 06 — Missions */}
      <Movement id="missions" {...N.mission} tone="ground">
        <ol aria-label="A mission, end to end" className="grid gap-0">
          {N.mission.steps.map((s, i) => (
            <li key={s} className="sv-rule flex items-center gap-4 py-3 first:border-t-0 first:pt-0">
              <span className="sv-data sv-faint w-6">{String(i + 1).padStart(2, "0")}</span>
              <span className="sv-h4">{s}</span>
            </li>
          ))}
        </ol>
      </Movement>

      {/* 07 — Adaptive experience */}
      <Movement id="adaptive" {...N.adaptive}>
        <p className="sv-small sv-muted">
          The same platform presents differently to a school administrator, a parent and a Sherivs
          operator — because it is composed from each person&rsquo;s organization, role and authorized
          capabilities. Hiding a control is cosmetic; the server enforces every action.
        </p>
      </Movement>

      {/* 08 — Runtimes / products */}
      <Movement id="runtimes" {...N.runtime} tone="ground">
        <ul className="grid gap-px overflow-hidden rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line)] bg-[color:var(--sv-line)]">
          {BRAND_PRODUCTS.map((p) => (
            <li key={p.id} className="sv-ground grid gap-1 px-5 py-4">
              <p className="sv-label sv-muted">{p.role}</p>
              <h3 className="sv-h3">{p.name}</h3>
              <p className="sv-small sv-muted">{p.summary}</p>
            </li>
          ))}
        </ul>
        <p className="sv-small sv-muted mt-4">
          <Link to="/solutions/$audience" params={{ audience: "education" }} className="sv-link">
            Education on Sherivs
          </Link>
        </p>
      </Movement>

      {/* 09 — Governance */}
      <Movement id="governance" {...N.governance}>
        <ul className="flex flex-wrap gap-2">
          {N.governance.pillars.map((p) => (
            <li key={p} className="sv-label rounded-[var(--sv-radius-sm)] border border-[color:var(--sv-line-strong)] px-3 py-2">
              {p}
            </li>
          ))}
        </ul>
        <p className="sv-small sv-muted mt-4">
          <Link to="/security" className="sv-link">
            Read how security is enforced
          </Link>
        </p>
      </Movement>

      {/* 10 — Architecture */}
      <Movement id="architecture" {...N.architecture} tone="ground">
        <ul aria-label="Platform capabilities" className="grid gap-px overflow-hidden rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line)] bg-[color:var(--sv-line)] sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <li key={c.id} className="sv-ground">
              <Link to="/platform/$capability" params={{ capability: c.id }} className="sv-focusable grid gap-1 px-5 py-4 hover:bg-[color:color-mix(in_oklab,var(--sv-text)_4%,transparent)]">
                <span className="sv-h4">{c.title}</span>
                <span className="sv-caption sv-muted">{c.lead}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="sr-only">{platformLinks.map(navLabel).join(", ")}</p>
      </Movement>

      {/* 11 — Vision */}
      <Movement id="direction" {...N.vision} />

      {/* 12 — Invitation */}
      <section aria-labelledby="start-heading" className="sv-section">
        <div className="sv-page-wide grid items-end gap-8 lg:grid-cols-12">
          <div className="grid gap-4 lg:col-span-8">
            <p className="sv-label sv-muted">
              <span className="sv-data sv-faint mr-3">12</span>Begin
            </p>
            <h2 id="start-heading" className="sv-hero">
              Start with the organization you run today.
            </h2>
            <p className="sv-body sv-muted max-w-xl">
              Create an account to set up your organization, or read how Sherivs protects it first.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 lg:col-span-4 lg:justify-end">
            <Link to="/auth" className="sv-btn sv-btn-primary sv-btn-lg">
              Get started
            </Link>
            <Link to="/security" className="sv-btn sv-btn-lg">
              Security
            </Link>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
