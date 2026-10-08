import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE, PRODUCT_JARVIS } from "@/lib/platform";
import { INSTALLED_RUNTIME_PRODUCT } from "@/lib/runtime/installed-runtimes";
import { PUBLIC_CAPABILITIES, PUBLIC_RUNTIMES, PUBLIC_SECURITY } from "@/lib/experience/public-catalog";
import { MARKETING_TIERS, formatTierPrice } from "@/routes/(site)/-content/pricing-tiers";
import { ExperienceSection, PlaneList, ProcessStrip } from "@/components/experience/editorial";
import { IntelligenceKindBadge } from "@/components/experience/evidence";

const REALITY_OBJECTS = [
  { id: "people", kicker: "People", title: "Identities, membership, roles", body: "People are first-class identities with tenant scope, relationships and policy — not rows in a school roster template." },
  { id: "systems", kicker: "Systems", title: "Workspaces and runtimes", body: "An organization installs the runtime it needs. The platform remains valid if that runtime is removed." },
  { id: "knowledge", kicker: "Knowledge", title: "Records with provenance", body: "Documents, messages and facts keep origin, time and authority. Inference does not silently rewrite them." },
  { id: "events", kicker: "Events", title: "What actually happened", body: "Operational events are canonical. Dashboards interpret them; they do not replace them." },
  { id: "state", kicker: "State", title: "Current organizational truth", body: "Membership, billing, attendance, files and mission status live as governed state, isolated by tenant." },
  { id: "relationships", kicker: "Relationships", title: "Who may act on what", body: "Authorization uses identity, tenant, role, relationship, resource, action, policy, context and risk." },
  { id: "operations", kicker: "Operations", title: "Work that leaves evidence", body: "Missions, tasks, communications and approvals are operational objects, not chat logs." },
  { id: "decisions", kicker: "Decisions", title: "Accountable outcomes", body: "Decisions carry actor, rationale, evidence references and an audit trail." },
] as const;

const MISSION_STEPS = [
  { id: "mission", label: "Mission", detail: "Owned work with completion criteria." },
  { id: "workforce", label: "Workforce", detail: "Human members and governed workers." },
  { id: "execution", label: "Execution", detail: "Scoped tools. No silent permission growth." },
  { id: "evidence", label: "Evidence", detail: "Artifacts, logs, provenance." },
  { id: "verification", label: "Verification", detail: "Policy check before trust." },
  { id: "outcome", label: "Outcome", detail: "Recorded result, including rollback." },
] as const;

export function PublicHome() {
  return (
    <>
      <section aria-labelledby="sherivs-hero" className="border-b border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              {PLATFORM_TAGLINE}
            </p>
            <h1
              id="sherivs-hero"
              className="mt-5 font-serif text-5xl font-medium tracking-tight sm:text-7xl"
            >
              {PLATFORM_NAME}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              The AI-native institutional operating system. A governed layer for
              organizational reality, intelligence, work and evidence — not a dashboard
              template, and not a school product wearing platform clothing.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <a
                href="/request-demo"
                className="rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Request access
              </a>
              <a
                href="/platform"
                className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Explore the platform
              </a>
              <Link
                to="/auth"
                className="text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Sign in
              </Link>
            </div>
          </div>
          <aside className="lg:col-span-5">
            <div className="h-full border-l border-border pl-0 lg:pl-10">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Spatial contract
              </p>
              <ol className="mt-6 space-y-5">
                {[
                  ["Reality", "Verified records, people, events, state."],
                  ["Intelligence", "Context, memory, models — untrusted by default."],
                  ["Action", "Missions, workers, approvals, tools."],
                  ["Evidence", "Provenance, verification, audit."],
                ].map(([label, body], index) => (
                  <li key={label} className="grid grid-cols-[3rem_1fr] gap-4">
                    <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <p className="font-display text-lg font-semibold">{label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      </section>

      <ExperienceSection
        id="category"
        eyebrow="Category"
        title="Organizations outgrew software that only stores records."
        lead="Institutions now run people, knowledge, payments, communications and AI in the same operational field. They need a layer that keeps truth, authority and evidence aligned."
      >
        <p className="text-base leading-7 text-muted-foreground">
          Most tools optimize a department. Sherivs is the operating layer underneath:
          identity, tenancy, policy, workspace, mission, workforce and audit. Domain
          software — including {INSTALLED_RUNTIME_PRODUCT} — installs on that layer. It does not
          get to become the platform.
        </p>
      </ExperienceSection>

      <ExperienceSection
        id="reality"
        eyebrow="Organizational reality"
        title="Represent the institution as it actually is."
        lead="Sherivs models people, systems, knowledge, events, state, relationships, operations and decisions as governed objects — then projects experiences from that reality."
        tone="recessed"
      >
        <PlaneList items={REALITY_OBJECTS} />
      </ExperienceSection>

      <ExperienceSection
        id="intelligence"
        eyebrow="Intelligence"
        title="Context, memory, knowledge, AI — distinguished, not blended."
        lead={`${PRODUCT_JARVIS} is executive intelligence. Role assistants exist where a runtime authorizes them. Model output never overwrites canonical truth.`}
      >
        <ul className="grid gap-4">
          {(
            [
              ["observation", "What the system recorded."],
              ["inference", "What a model interpreted."],
              ["recommendation", "What it suggests, still untrusted."],
              ["action", "What was authorized to run."],
              ["evidence", "What can be shown."],
              ["verification", "What policy accepted."],
            ] as const
          ).map(([kind, body]) => (
            <li key={kind} className="flex items-start gap-3">
              <IntelligenceKindBadge kind={kind} />
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </ExperienceSection>

      <section id="capabilities" aria-labelledby="capabilities-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Platform capabilities
          </p>
          <h2 id="capabilities-heading" className="mt-3 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            One governed core. Six capabilities organizations actually consume.
          </h2>
          <ol className="mt-12 divide-y divide-border border-y border-border">
            {PUBLIC_CAPABILITIES.map((capability, index) => (
              <li key={capability.id} className="grid gap-2 py-6 md:grid-cols-[5rem_14rem_1fr] md:gap-8">
                <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="font-display text-lg font-semibold">{capability.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{capability.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <ExperienceSection
        id="workforce"
        eyebrow="AI workforce"
        title="Workers are governed entities, not characters."
        lead="Every worker has identity, owner, tools, authority, lifecycle and audit. Agents are untrusted by default and cannot expand their own permissions."
      >
        <p className="text-base leading-7 text-muted-foreground">
          Sherivs does not portray artificial colleagues as magical autonomy. A worker
          may propose, retrieve, draft or execute only inside a lease, a policy and a
          mission. Humans remain accountable for outcomes that affect the institution.
        </p>
      </ExperienceSection>

      <section id="missions" aria-labelledby="missions-heading" className="border-b border-border bg-muted/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Mission system
          </p>
          <h2 id="missions-heading" className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Mission → workforce → execution → evidence → verification → outcome
          </h2>
          <div className="mt-12">
            <ProcessStrip steps={MISSION_STEPS} />
          </div>
        </div>
      </section>

      <ExperienceSection
        id="experiences"
        eyebrow="Adaptive experiences"
        title="The interface is projected from reality, not hard-coded as a portal pack."
        lead="Navigation, workspace chrome and public presence resolve from runtime contributions, capabilities, role and policy. Empty states stay empty. Hidden buttons are not security."
      >
        <p className="text-base leading-7 text-muted-foreground">
          Signing in does not dump every visitor into an education homepage. Context
          resolves first: identity, tenant, runtime, workspace. The Scholar runtime is one
          projection of that system.
        </p>
      </ExperienceSection>

      <section id="runtimes" aria-labelledby="runtimes-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Domain runtimes
          </p>
          <h2 id="runtimes-heading" className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            The Scholar runtime is installed. It is not Sherivs.
          </h2>
          <div className="mt-10 grid gap-6">
            {PUBLIC_RUNTIMES.map((runtime) => (
              <article key={runtime.manifestId} className="border-t border-border pt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="font-display text-2xl font-semibold">{runtime.name}</h3>
                  <p className="font-mono text-xs text-muted-foreground">{runtime.manifestId}</p>
                </div>
                <p className="mt-2 text-sm font-medium">{runtime.description}</p>
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">{runtime.proof}</p>
                <a
                  href="/solutions/education"
                  className="mt-4 inline-block text-sm font-semibold underline-offset-4 hover:underline"
                >
                  Education runtime →
                </a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="security" aria-labelledby="security-heading" className="border-b border-border bg-muted/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Governance
          </p>
          <h2 id="security-heading" className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Security, authority, evidence, verification, audit.
          </h2>
          <ul className="mt-12 divide-y divide-border border-y border-border">
            {PUBLIC_SECURITY.map((guarantee) => (
              <li key={guarantee.id} className="grid gap-2 py-6 md:grid-cols-[16rem_1fr] md:gap-8">
                <h3 className="font-display text-base font-semibold">{guarantee.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{guarantee.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <ExperienceSection
        id="architecture"
        eyebrow="Enterprise architecture"
        title="A kernel with contracts. Applications consume it."
        lead="Identity, tenancy, policy, workspace, AI gateway, missions and evidence are platform primitives. This page does not publish internal control-plane topology."
      >
        <p className="text-base leading-7 text-muted-foreground">
          Organizations get workspaces projected from their roles. Super-admin and
          internal Sherivs operations stay on a separate security boundary. Customer
          navigation never lists that boundary.
        </p>
      </ExperienceSection>

      <ExperienceSection
        id="future"
        eyebrow="Category"
        title="Institutional intelligence infrastructure."
        lead="Not a chatbot bolted onto records. Not an admin theme. A governed environment where reality, intelligence and action remain distinct — and auditable."
        tone="signal"
      >
        <p className="text-base leading-7 text-muted-foreground">
          The product family is explicit: {PLATFORM_NAME} is the platform,{" "}
          {INSTALLED_RUNTIME_PRODUCT} is the education runtime, {PRODUCT_JARVIS} is executive
          intelligence, and the AI workforce is a governed operator class. CoreGrid
          remains an internal kernel name, not the customer brand.
        </p>
      </ExperienceSection>

      <section id="pricing" aria-labelledby="pricing-heading" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Pricing
          </p>
          <h2 id="pricing-heading" className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Commercial tiers from the live catalog.
          </h2>
          <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
            Amounts are in ₦ and mirror the platform entitlement catalog. This table
            does not grant access. Activation still runs through identity, tenancy and
            feature-access contracts.
          </p>
          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">Sherivs commercial tiers</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-3 font-semibold">
                    Tier
                  </th>
                  <th scope="col" className="py-3 font-semibold">
                    Monthly
                  </th>
                  <th scope="col" className="py-3 font-semibold">
                    Annual
                  </th>
                  <th scope="col" className="py-3 font-semibold">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {MARKETING_TIERS.map((tier) => (
                  <tr key={tier.id} className="border-b border-border align-top">
                    <th scope="row" className="py-4 font-display font-semibold">
                      {tier.name}
                      {tier.featured ? (
                        <span className="ml-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                          Recommended
                        </span>
                      ) : null}
                    </th>
                    <td className="py-4 font-mono">{formatTierPrice(tier.monthlyPrice)}</td>
                    <td className="py-4 font-mono">{formatTierPrice(tier.annualPrice)}</td>
                    <td className="py-4 text-muted-foreground">{tier.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6">
            <a href="/pricing" className="text-sm font-semibold underline-offset-4 hover:underline">
              Full pricing →
            </a>
          </p>
        </div>
      </section>

      <section aria-labelledby="cta-heading">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <h2 id="cta-heading" className="font-serif text-4xl tracking-tight sm:text-5xl">
            Request a demo. Explore the platform.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Access starts on the real authentication surface. Organization provisioning
            is a separate operator flow — it is not the public homepage.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="/request-demo"
              className="rounded-md bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
            >
              Request a demo
            </a>
            <a href="/platform" className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold">
              Explore platform
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
