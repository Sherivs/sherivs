import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import {
  COMPANY_MISSION,
  COMPANY_VISION,
  POSITIONING_PROGRAMMABLE,
  POSITIONING_RETHINKING,
  POSITIONING_STATEMENT,
} from "@/lib/public-site/company";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { NetworkViz } from "@/components/public/network-viz";
import { ArchitectureDiagram } from "@/components/public/architecture-diagram";
import { FaqList } from "@/components/public/faq-list";
import { JsonLd } from "@/components/public/json-ld";
import {
  PageContainer,
  Section,
  SectionHeading,
  FeatureCard,
  PublicButton,
  StatusBadge,
} from "@/components/public/ui";
import {
  APPROACH_PILLARS,
  HOW_IT_WORKS,
  PRODUCT_FAMILIES,
} from "@/lib/public-site/capabilities";
import { FAQ_ITEMS, FAQ_PREVIEW_IDS } from "@/lib/public-site/faq";
import { publishedPartners } from "@/lib/public-site/partners";
import { organizationJsonLd, softwareJsonLd } from "@/lib/public-site/seo";

/**
 * Sherivs public company homepage.
 *
 * PLANE 1 — sherivs.com. Explains the company and category without exposing
 * internal architecture, registries, or credentials. No fabricated social proof.
 */

const FAQ_PREVIEW = FAQ_ITEMS.filter((item) =>
  (FAQ_PREVIEW_IDS as readonly string[]).includes(item.id),
);

export function SherivsHome() {
  const integrations = publishedPartners("technology_integration");

  return (
    <div className="sherivs-public flex min-h-dvh flex-col bg-sherivs-obsidian text-sherivs-white">
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={softwareJsonLd()} />
      <SiteHeader />
      <main id="main-content" className="flex-1">
        <Section labelledBy="sherivs-hero" className="overflow-hidden">
          <PageContainer wide className="grid items-center gap-10 py-16 lg:grid-cols-2 lg:py-24">
            <div>
              <p className="sherivs-kicker sherivs-enter">{PLATFORM_NAME}</p>
              <h1
                id="sherivs-hero"
                className="sherivs-display sherivs-enter sherivs-enter-2 mt-4 text-3xl font-bold sm:text-5xl"
              >
                The intelligence layer for a world that works together.
              </h1>
              <p className="sherivs-enter sherivs-enter-3 mt-5 max-w-xl text-sm leading-relaxed text-sherivs-muted sm:text-lg">
                {POSITIONING_STATEMENT}
              </p>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
                {POSITIONING_RETHINKING}
              </p>
              <p className="mt-3 max-w-xl text-sm text-sherivs-muted">{PLATFORM_TAGLINE}.</p>
              <div className="sherivs-enter sherivs-enter-4 mt-8 flex flex-col gap-3 sm:flex-row">
                <PublicButton href="/sherivs">Explore the Platform</PublicButton>
                <PublicButton href="/request-demo" variant="secondary">
                  Request a demo
                </PublicButton>
              </div>
            </div>
            <NetworkViz className="sherivs-enter sherivs-enter-3" />
          </PageContainer>
        </Section>

        <Section id="platform" labelledBy="intro-heading" tone="muted">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="intro-heading"
              eyebrow="Platform"
              title="One platform. Many realities. Shared intelligence."
              lead="People hold roles and relationships. Organizations hold membership, policy, and records. AI agents hold bounded tasks. Digital twins hold state and events. Institutional applications — starting with Scholar — run on that shared substrate instead of inventing a private stack for each domain."
            />
          </PageContainer>
        </Section>

        <Section labelledBy="problem-heading">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="problem-heading"
              eyebrow="The problem"
              title="Intelligence is powerful. Fragmented intelligence is expensive."
              lead="Identity in one product, records in another, automation in a third, and an AI tool that cannot see any of them safely. Each new integration is paid for twice: once to connect, and again to govern. Fragmentation is not a statistic we invented — it is the operating condition most institutions already live with."
            />
          </PageContainer>
        </Section>

        <Section labelledBy="approach-heading" tone="muted">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="approach-heading"
              eyebrow="The Sherivs approach"
              title="Connect. Coordinate. Intelligence."
              lead="Three moves, in that order. Intelligence without connection and coordination is another isolated tool."
            />
            <ul className="mt-10 grid gap-4 lg:grid-cols-3">
              {APPROACH_PILLARS.map((pillar) => (
                <li key={pillar.id}>
                  <FeatureCard title={pillar.title}>{pillar.body}</FeatureCard>
                </li>
              ))}
            </ul>
          </PageContainer>
        </Section>

        <Section labelledBy="architecture-heading">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="architecture-heading"
              eyebrow="Architecture"
              title="The layers of institutional computing"
              lead="Available layers are labelled from repository evidence. In-development and planned layers are part of the architecture, not silent product claims."
            />
            <div className="mt-10">
              <ArchitectureDiagram />
            </div>
          </PageContainer>
        </Section>

        <Section id="ai-workforce" labelledBy="ai-workforce-heading" tone="muted">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="ai-workforce-heading"
              eyebrow="AI workforce"
              title="Agents that work inside your permissions"
              lead="Sherivs treats AI workers as identities with owners, bounded tasks, and human oversight. They do not get unlimited autonomous execution, and they cannot enlarge their own access. Some worker features still require configured model credentials."
            />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Bounded tasks", "Work is assigned with an objective and a completion record."],
                ["Specialized workers", "Different jobs need different scopes — not one ambient assistant."],
                ["Permissions", "Access follows identity and policy, not a clever prompt."],
                ["Execution tracking", "Runs should be observable: who initiated, what ran, what changed."],
                ["Human oversight", "Proposals can require review before they become records."],
                ["Usage controls", "Model use is meant to be budgeted and auditable, not unbounded."],
              ].map(([title, body]) => (
                <li key={title}>
                  <FeatureCard title={title}>{body}</FeatureCard>
                </li>
              ))}
            </ul>
          </PageContainer>
        </Section>

        <Section labelledBy="twins-heading">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="twins-heading"
              eyebrow="Digital twins"
              title="Persistent identity, state, relationships, and events"
              lead="A twin that is only a picture cannot govern an institution. Sherivs models twins as durable objects that can compute on events or on a schedule. Administrative surfaces exist; a complete twin runtime — including device and IoT twins — is not a generally available product."
            />
            <div className="mt-8">
              <PublicButton href="/product/digital-twins" variant="secondary">
                Read how twins are designed
              </PublicButton>
            </div>
          </PageContainer>
        </Section>

        <Section id="solutions" labelledBy="solutions-heading" tone="muted">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="solutions-heading"
              eyebrow="Institutional solutions"
              title="Product families, labelled honestly"
              lead="Education through Scholar — available today. Other industry runtimes are labelled In development — they are not shipping SKUs."
            />
            <ul className="mt-10 grid gap-4 lg:grid-cols-2">
              {PRODUCT_FAMILIES.map((family) => (
                <li key={family.id}>
                  <FeatureCard title={family.name} href={family.href} status={family.status}>
                    {family.summary}
                  </FeatureCard>
                </li>
              ))}
            </ul>
          </PageContainer>
        </Section>

        <Section labelledBy="how-heading">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="how-heading"
              eyebrow="How it works"
              title="From authorized connection to verified outcome"
            />
            <ol className="mt-10 grid gap-4 sm:grid-cols-2">
              {HOW_IT_WORKS.map((item) => (
                <li key={item.step} className="rounded-[var(--sherivs-radius)] border border-[var(--sherivs-border)] p-5">
                  <p className="font-display text-sm font-bold text-sherivs-cyan">{item.step}</p>
                  <h3 className="mt-2 font-display text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-sherivs-muted">{item.body}</p>
                </li>
              ))}
            </ol>
          </PageContainer>
        </Section>

        <Section id="security" labelledBy="security-heading" tone="muted">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="security-heading"
              eyebrow="Security and governance"
              title="Governed by design"
              lead="Sherivs is built so identity, tenancy, and policy decide what happens. We do not display certification badges or audit numbers that are not on file."
            />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              <li>
                <FeatureCard title="Permissions by design">
                  Information and actions are governed by identity, role, and policy — enforced by
                  the platform, not the interface.
                </FeatureCard>
              </li>
              <li>
                <FeatureCard title="Tenant isolation">
                  Each organization&apos;s reality is designed to be isolated at the database layer,
                  not only in application code.
                </FeatureCard>
              </li>
              <li>
                <FeatureCard title="Evidence">
                  Important actions are intended to leave records: what happened, who did it, and
                  under which authority.
                </FeatureCard>
              </li>
              <li>
                <FeatureCard title="Governed AI">
                  AI workers operate inside responsibilities and verification boundaries — never as
                  unrestricted administrators.
                </FeatureCard>
              </li>
            </ul>
            <div className="mt-8">
              <PublicButton href="/trust" variant="secondary">
                Open the trust center
              </PublicButton>
            </div>
          </PageContainer>
        </Section>

        <Section labelledBy="integrations-heading">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="integrations-heading"
              eyebrow="Integrations"
              title="Verified integration paths"
              lead="These names are technologies Sherivs can connect to when configured. They are not commercial partnership announcements."
            />
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {integrations.map((item) => (
                <li key={item.id}>
                  <FeatureCard title={item.name}>
                    {item.summary} <StatusBadge status="available" />
                  </FeatureCard>
                </li>
              ))}
            </ul>
          </PageContainer>
        </Section>

        <Section labelledBy="developers-heading" tone="muted">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="developers-heading"
              eyebrow="Developers"
              title="Start where the product actually is"
              lead="Today the developer entry points are the web application, authentication, and organization onboarding. A public API catalog and SDK are planned — they are not published as products on this site."
            />
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <PublicButton href="/developers" variant="secondary">
                Developer entry points
              </PublicButton>
              <PublicButton href="/docs" variant="text">
                Documentation
              </PublicButton>
            </div>
          </PageContainer>
        </Section>

        <Section labelledBy="vision-heading">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="vision-heading"
              eyebrow="Long-term vision"
              title={COMPANY_VISION}
              lead={POSITIONING_PROGRAMMABLE}
            />
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
              That future is not the same as the Scholar runtime you can use today. We keep those
              stories on separate layers of this site.
            </p>
            <div className="mt-8">
              <PublicButton href="/company/vision" variant="secondary">
                Vision and mission
              </PublicButton>
            </div>
          </PageContainer>
        </Section>

        <Section labelledBy="faq-preview-heading" tone="muted">
          <PageContainer className="py-16 sm:py-20">
            <SectionHeading
              id="faq-preview-heading"
              eyebrow="FAQ"
              title="Straight answers"
              lead="Each question links to its full answer."
            />
            <div className="mt-10">
              <FaqList items={FAQ_PREVIEW} preview />
            </div>
            <div className="mt-6">
              <PublicButton href="/faq" variant="text">
                All questions
              </PublicButton>
            </div>
          </PageContainer>
        </Section>

        <Section id="enterprise" labelledBy="cta-heading">
          <PageContainer className="py-16 sm:py-20">
            <div className="sherivs-glass rounded-[var(--sherivs-radius-lg)] px-6 py-10 text-center sm:px-12">
              <h2 id="cta-heading" className="sherivs-display text-2xl font-bold sm:text-3xl">
                {COMPANY_MISSION}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-sherivs-muted sm:text-base">
                Request a walkthrough, or write to the Sherivs team. Create an organization when you
                are ready to start with Scholar.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <PublicButton href="/request-demo">Request a demo</PublicButton>
                <PublicButton href="/contact" variant="secondary">
                  Contact Sherivs
                </PublicButton>
              </div>
            </div>
          </PageContainer>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}

export { PLATFORM_TAGLINE as SHERIVS_HOME_TAGLINE };
