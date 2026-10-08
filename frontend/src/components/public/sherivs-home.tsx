import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { SiteHeader } from "@/components/public/site-header";

/**
 * Sherivs public company homepage.
 *
 * This is PLANE 1 — the public company experience at sherivs.com. It explains
 * the company and the category (Institutional Intelligence Infrastructure) to
 * a first-time visitor. It must never expose internal architecture, internal
 * registries, engineering governance surfaces, or credentials, and must
 * never present a single domain runtime (e.g. Scholar) as the company.
 *
 * Static, database-free presentation; every interactive element links to a
 * real route. No fabricated social proof — credibility comes from a coherent
 * product story.
 */

const REALITY_ITEMS = [
  {
    title: "People",
    description:
      "Everyone in the organization — their roles, responsibilities, and relationships — represented as governed identity, not scattered accounts.",
  },
  {
    title: "Knowledge",
    description:
      "Institutional knowledge captured where work happens, with provenance and history, so it compounds instead of evaporating.",
  },
  {
    title: "Processes",
    description:
      "How work actually flows through the organization — modeled, coordinated, and continuously improved.",
  },
  {
    title: "Events",
    description:
      "What happens across the organization, recorded as evidence the organization can trust and act on.",
  },
  {
    title: "Decisions",
    description:
      "Decisions and their context, kept explainable and auditable — who decided, why, and with what information.",
  },
  {
    title: "Resources",
    description:
      "Facilities, budgets, schedules, and assets connected to the people and processes that depend on them.",
  },
];

const AI_WORKFORCE_ITEMS = [
  {
    title: "Operations AI",
    description: "Keeps day-to-day operations moving inside defined responsibilities.",
  },
  {
    title: "Customer Support AI",
    description: "Handles communication within your policies and escalation paths.",
  },
  {
    title: "Research AI",
    description: "Surfaces relevant knowledge with sources you can verify.",
  },
  {
    title: "Finance Intelligence",
    description: "Analyzes financial reality with permission-scoped visibility.",
  },
  {
    title: "Communications AI",
    description: "Drafts and coordinates organizational communication for review.",
  },
  {
    title: "Analytics AI",
    description: "Explains what is happening across your data, with evidence.",
  },
];

const AUTONOMOUS_OPERATIONS_STEPS = [
  { step: "Observe", description: "Continuous visibility into organizational reality." },
  { step: "Understand", description: "Context and meaning, not just raw data." },
  { step: "Prioritize", description: "Attention directed at what matters most." },
  { step: "Act", description: "Coordinated work by people and AI together." },
  { step: "Verify", description: "Outcomes checked against expectations." },
  { step: "Improve", description: "Lessons compound into the operating model." },
];

const RUNTIMES = [
  {
    name: "Education",
    description:
      "Scholar — Sherivs' education runtime — coordinates schools: people, learning, operations, and communication.",
    status: "Available",
  },
  {
    name: "Commerce",
    description: "Operating intelligence for commercial organizations.",
    status: "In development",
  },
  {
    name: "Healthcare",
    description: "Operating intelligence for care organizations.",
    status: "In development",
  },
  {
    name: "Government",
    description: "Operating intelligence for public institutions.",
    status: "In development",
  },
  {
    name: "Operations",
    description: "Operating intelligence for service and field organizations.",
    status: "In development",
  },
];

const SECURITY_POINTS = [
  {
    title: "Permissions by design",
    description:
      "Every piece of information and every action is governed by identity, role, and policy — enforced by the platform, not the interface.",
  },
  {
    title: "Tenant isolation",
    description:
      "Each organization's reality is isolated at the database layer, not just in application code.",
  },
  {
    title: "Evidence & audit",
    description:
      "Important actions produce records: what happened, who did it, and under which authority.",
  },
  {
    title: "Governed AI",
    description:
      "AI workers operate inside defined responsibilities, permissions, and verification boundaries — never as unrestricted administrators.",
  },
];

const ENTERPRISE_POINTS = [
  {
    title: "Deployment",
    description: "Cloud-hosted operating environments provisioned per organization.",
  },
  {
    title: "Integration",
    description: "Connect the systems your organization already relies on.",
  },
  {
    title: "Scalability",
    description: "From a single site to a multi-site organization, on one operating model.",
  },
  {
    title: "Governance",
    description: "Policies, roles, and controls that hold as the organization changes.",
  },
];

function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {eyebrow}
      </p>
      <h2 id={id} className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {lead && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{lead}</p>
      )}
    </div>
  );
}

export function SherivsHome() {
  return (
    <>
      <SiteHeader />
      {/* Hero */}
      <section aria-labelledby="sherivs-hero" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {PLATFORM_NAME}
          </p>
          <h1
            id="sherivs-hero"
            className="mt-3 max-w-3xl font-display text-3xl font-bold leading-tight tracking-tight sm:text-5xl"
          >
            The operating intelligence for modern organizations.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-lg">
            Sherivs connects your organization&apos;s people, knowledge, workflows, communications,
            data, and AI workforce into one intelligent operating environment.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              to="/request-demo"
              className="rounded-md bg-primary px-5 py-2.5 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Request a demo
            </Link>
            <a
              href="#platform"
              className="rounded-md border border-border px-5 py-2.5 text-center text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Explore the platform
            </a>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section aria-labelledby="problem-heading" className="border-b border-border bg-muted/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="problem-heading"
            eyebrow="The problem"
            title="Organizations operate across fragmented systems"
            lead="People in one tool, knowledge in another, processes in email, data in spreadsheets, and AI bolted on the side. Nothing holds together, so nothing improves."
          />
        </div>
      </section>

      {/* Solution */}
      <section aria-labelledby="solution-heading" id="platform" className="border-b border-border">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="solution-heading"
            eyebrow="The Sherivs solution"
            title="One intelligent operating environment"
            lead="Sherivs gives organizations a single operating environment that understands how they work, coordinates their people and AI workforce, connects their systems, and continuously improves operations."
          />
        </div>
      </section>

      {/* Organizational Reality */}
      <section
        id="reality"
        aria-labelledby="reality-heading"
        className="border-b border-border bg-muted/20"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="reality-heading"
            eyebrow="Organizational reality"
            title="A living representation of how your organization actually works"
            lead="Sherivs represents your organization as it is — and keeps that representation current as it changes."
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {REALITY_ITEMS.map((item) => (
              <li
                key={item.title}
                className="rounded-xl border border-border bg-background p-5 transition-colors hover:bg-muted/30"
              >
                <h3 className="font-display text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* AI Workforce */}
      <section
        id="ai-workforce"
        aria-labelledby="ai-workforce-heading"
        className="border-b border-border"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="ai-workforce-heading"
            eyebrow="AI workforce"
            title="AI workers that operate inside your boundaries"
            lead="Sherivs AI workers operate within organizational context, defined responsibilities, permissions, policies, and verification boundaries. They are governed capabilities — not unrestricted administrators."
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AI_WORKFORCE_ITEMS.map((item) => (
              <li
                key={item.title}
                className="rounded-xl border border-border p-5 transition-colors hover:bg-muted/30"
              >
                <h3 className="font-display text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Intelligence */}
      <section
        id="intelligence"
        aria-labelledby="intelligence-heading"
        className="border-b border-border bg-muted/20"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="intelligence-heading"
            eyebrow="Institutional intelligence"
            title="Understanding that compounds"
            lead="Because Sherivs operates on a connected representation of your organization, its intelligence is grounded in your reality — with provenance, history, and confidence — rather than in generic guesses."
          />
        </div>
      </section>

      {/* Autonomous Operations */}
      <section
        id="operations"
        aria-labelledby="operations-heading"
        className="border-b border-border"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="operations-heading"
            eyebrow="Autonomous operations"
            title="A continuous operating loop"
            lead="Sherivs coordinates work as a loop, not a queue of disconnected tasks."
          />
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {AUTONOMOUS_OPERATIONS_STEPS.map((item, index) => (
              <li
                key={item.step}
                className="rounded-xl border border-border p-5 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-baseline gap-3">
                  <span aria-hidden="true" className="font-display text-sm font-bold text-primary">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-display text-base font-semibold">{item.step}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Adaptive organization */}
      <section aria-labelledby="adaptive-heading" className="border-b border-border bg-muted/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="adaptive-heading"
            eyebrow="Adaptive organization"
            title="The experience adapts to your organization"
            lead="Workspaces, navigation, and capabilities are derived from your organization's reality — its people, roles, and enabled capabilities. What each person sees follows from what they are authorized to do."
          />
        </div>
      </section>

      {/* Industry solutions / runtimes */}
      <section
        id="solutions"
        aria-labelledby="solutions-heading"
        className="border-b border-border"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="solutions-heading"
            eyebrow="Industry solutions"
            title="Domain runtimes on one platform"
            lead="Sherivs adapts to industries through domain runtimes — complete operating experiences built on the same platform."
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RUNTIMES.map((runtime) => (
              <li
                key={runtime.name}
                className="flex flex-col rounded-xl border border-border p-5 transition-colors hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-base font-semibold">{runtime.name}</h3>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
                      runtime.status === "Available"
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground"
                    }`}
                  >
                    {runtime.status}
                  </span>
                </div>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
                  {runtime.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Security */}
      <section
        id="security"
        aria-labelledby="security-heading"
        className="border-b border-border bg-muted/20"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="security-heading"
            eyebrow="Security & trust"
            title="Governed by design"
            lead="Sherivs is built for organizations that have to trust their operating system."
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {SECURITY_POINTS.map((point) => (
              <li
                key={point.title}
                className="rounded-xl border border-border bg-background p-5 transition-colors hover:bg-muted/30"
              >
                <h3 className="font-display text-base font-semibold">{point.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {point.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Enterprise */}
      <section
        id="enterprise"
        aria-labelledby="enterprise-heading"
        className="border-b border-border"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
          <SectionHeading
            id="enterprise-heading"
            eyebrow="Enterprise"
            title="Built for serious deployment"
          />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ENTERPRISE_POINTS.map((point) => (
              <li
                key={point.title}
                className="rounded-xl border border-border p-5 transition-colors hover:bg-muted/30"
              >
                <h3 className="font-display text-base font-semibold">{point.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {point.description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section aria-labelledby="cta-heading" className="bg-muted/20">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="rounded-2xl border border-border bg-background p-8 text-center sm:p-12">
            <h2
              id="cta-heading"
              className="font-display text-2xl font-bold tracking-tight sm:text-3xl"
            >
              Bring your organization onto one operating environment
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              Talk to {PLATFORM_NAME} about your organization, and we&apos;ll show you how the
              platform would work for how you operate.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                to="/request-demo"
                className="w-full rounded-md bg-primary px-5 py-2.5 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto"
              >
                Request a demo
              </Link>
              <Link
                to="/auth"
                className="w-full rounded-md border border-border px-5 py-2.5 text-center text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto"
              >
                Create your organization
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export { PLATFORM_TAGLINE as SHERIVS_HOME_TAGLINE };
