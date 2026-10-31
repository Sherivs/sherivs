import {
  PUBLIC_EDITORIAL_APPROACH,
  PUBLIC_EDITORIAL_MISSION,
  PUBLIC_EDITORIAL_VISION,
} from "@/lib/public-site/company";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { PublicAtmosphere } from "@/components/public/public-atmosphere";
import { FaqAccordion } from "@/components/public/faq-accordion";
import { JsonLd } from "@/components/public/json-ld";
import {
  PageContainer,
  Section,
  SectionHeading,
  PublicButton,
  StatusBadge,
} from "@/components/public/ui";
import { FAQ_ITEMS, FAQ_PREVIEW_IDS } from "@/lib/public-site/faq";
import {
  SCHOLAR_ACTION,
  SCHOLAR_COMMUNITY,
  SCHOLAR_FINAL_CTA,
  SCHOLAR_FLEXIBILITY,
  SCHOLAR_GOVERNANCE,
  SCHOLAR_HERO,
  SCHOLAR_INTELLIGENCE,
  SCHOLAR_ORGANIZATION,
  SCHOLAR_START,
  SCHOLAR_WORKSPACE,
  type HomepageCard,
} from "@/lib/public-site/scholar";
import { organizationJsonLd, softwareJsonLd } from "@/lib/public-site/seo";
import { PublicLink } from "@/components/public/public-link";
import { SchoolRealityIntelligenceMap } from "@/components/public/school-reality-intelligence-map";
import type { CapabilityStatus } from "@/lib/public-site/capabilities";

/**
 * Sherivs public homepage.
 *
 * Introduces Sherivs Scholar as an institutional operating environment.
 * Does not advertise unlaunched product families, internal architecture,
 * or capabilities the repository audit marked as not operational.
 */

const FAQ_PREVIEW = FAQ_ITEMS.filter((item) =>
  (FAQ_PREVIEW_IDS as readonly string[]).includes(item.id),
);

export function SherivsHome() {
  return (
    <div className="sherivs-public flex min-h-dvh flex-col">
      <PublicAtmosphere />
      <JsonLd data={organizationJsonLd()} />
      <JsonLd data={softwareJsonLd()} />
      <SiteHeader />
      <main id="main-content" className="relative z-[1] flex-1">
        <HeroSection />
        <SchoolRealityIntelligenceMap />
        <OrganizationSection />
        <CommunitySection />
        <IntelligenceSection />
        <ActionSection />
        <FlexibilitySection />
        <WorkspaceSection />
        <GovernanceSection />
        <StartSection />
        <DirectionSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}

function HeroSection() {
  return (
    <Section labelledBy="sherivs-hero">
      <PageContainer className="py-8 sm:py-14 lg:py-16">
        <div className="min-w-0">
          <p className="sherivs-kicker">{SCHOLAR_HERO.eyebrow}</p>
          <p className="mt-3 max-w-xl text-base font-medium leading-snug text-[var(--sherivs-ink)] sm:text-lg">
            {SCHOLAR_HERO.descriptor}
          </p>
          <h1
            id="sherivs-hero"
            className="sherivs-display mt-3 max-w-[18ch] text-[1.85rem] font-bold sm:text-5xl"
          >
            {SCHOLAR_HERO.headline}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--sherivs-ink-muted)] sm:text-lg">
            {SCHOLAR_HERO.supporting}
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--sherivs-ink-muted)] sm:text-base">
            {SCHOLAR_HERO.secondary}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <PublicButton href={SCHOLAR_HERO.primaryHref}>{SCHOLAR_HERO.primaryCta}</PublicButton>
            <PublicButton href={SCHOLAR_HERO.secondaryHref} variant="secondary">
              {SCHOLAR_HERO.secondaryCta}
            </PublicButton>
          </div>
        </div>
      </PageContainer>
    </Section>
  );
}

function OrganizationSection() {
  const [featured, ...supporting] = SCHOLAR_ORGANIZATION.cards;
  return (
    <Section
      id={SCHOLAR_ORGANIZATION.id}
      labelledBy="organization-heading"
      className="sherivs-band-soft"
    >
      <PageContainer className="py-16 sm:py-20">
        <SectionHeading
          id="organization-heading"
          eyebrow={SCHOLAR_ORGANIZATION.eyebrow}
          title={SCHOLAR_ORGANIZATION.headline}
          lead={SCHOLAR_ORGANIZATION.description}
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
          <article className="sherivs-glass-card rounded-[var(--sherivs-radius-lg)] p-7 sm:p-9">
            <h3 className="font-display text-2xl font-semibold sm:text-3xl">{featured.title}</h3>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
              {featured.body}
            </p>
          </article>
          <ul className="grid gap-4">
            {supporting.map((card) => (
              <li key={card.id}>
                <StoryCard card={card} />
              </li>
            ))}
          </ul>
        </div>
      </PageContainer>
    </Section>
  );
}

function CommunitySection() {
  const [leadership, ...rest] = SCHOLAR_COMMUNITY.cards;
  const primary = rest.slice(0, 3);
  const supporting = rest.slice(3, 5);
  const closing = rest[5];
  return (
    <Section id={SCHOLAR_COMMUNITY.id} labelledBy="community-heading">
      <PageContainer className="py-16 sm:py-20">
        <SectionHeading
          id="community-heading"
          eyebrow={SCHOLAR_COMMUNITY.eyebrow}
          title={SCHOLAR_COMMUNITY.headline}
          lead={SCHOLAR_COMMUNITY.description}
        />
        <p className="mt-4 max-w-2xl text-sm text-sherivs-muted">{SCHOLAR_COMMUNITY.note}</p>
        <article className="sherivs-glass-card mt-8 rounded-[var(--sherivs-radius-lg)] p-7 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1558d6]">
            School leadership
          </p>
          <h3 className="mt-3 font-display text-2xl font-semibold">{leadership.title}</h3>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--sherivs-ink-muted)] sm:text-base">
            {leadership.body}
          </p>
        </article>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {primary.map((card) => (
            <li key={card.id}>
              <StoryCard card={card} />
            </li>
          ))}
        </ul>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {supporting.map((card) => (
            <li key={card.id}>
              <StoryCard card={card} />
            </li>
          ))}
        </ul>
        <article className="mt-4 rounded-[var(--sherivs-radius)] border border-dashed border-[var(--sherivs-border-strong)] bg-white/40 p-6">
          <h3 className="font-display text-lg font-semibold">{closing.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-sherivs-muted">{closing.body}</p>
        </article>
      </PageContainer>
    </Section>
  );
}

function IntelligenceSection() {
  const featured = SCHOLAR_INTELLIGENCE.cards.filter((card) =>
    (SCHOLAR_INTELLIGENCE.featured as readonly string[]).includes(card.id),
  );
  const rest = SCHOLAR_INTELLIGENCE.cards.filter(
    (card) => !(SCHOLAR_INTELLIGENCE.featured as readonly string[]).includes(card.id),
  );
  return (
    <Section
      id={SCHOLAR_INTELLIGENCE.id}
      labelledBy="intelligence-heading"
      className="sherivs-band-dusk"
    >
      <PageContainer className="py-16 sm:py-20">
        <div className="flex flex-wrap items-center gap-3">
          <p className="sherivs-kicker">{SCHOLAR_INTELLIGENCE.eyebrow}</p>
          <StatusBadge status={SCHOLAR_INTELLIGENCE.status} />
        </div>
        <h2
          id="intelligence-heading"
          className="sherivs-display mt-3 text-2xl font-bold sm:text-3xl"
        >
          {SCHOLAR_INTELLIGENCE.headline}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
          {SCHOLAR_INTELLIGENCE.description}
        </p>
        <p className="mt-3 max-w-2xl text-sm text-sherivs-muted">{SCHOLAR_INTELLIGENCE.note}</p>
        <ul className="mt-10 grid gap-4 lg:grid-cols-2">
          {featured.map((card) => (
            <li key={card.id}>
              <StoryCard card={card} prominent />
            </li>
          ))}
        </ul>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {rest.map((card) => (
            <li key={card.id}>
              <StoryCard card={card} />
            </li>
          ))}
        </ul>
      </PageContainer>
    </Section>
  );
}

function ActionSection() {
  return (
    <Section id={SCHOLAR_ACTION.id} labelledBy="action-heading" className="sherivs-band-soft">
      <PageContainer className="py-16 sm:py-20">
        <div className="flex flex-wrap items-center gap-3">
          <p className="sherivs-kicker">{SCHOLAR_ACTION.eyebrow}</p>
          <StatusBadge status={SCHOLAR_ACTION.status} />
        </div>
        <h2
          id="action-heading"
          className="sherivs-display mt-3 max-w-3xl text-2xl font-bold sm:text-3xl"
        >
          {SCHOLAR_ACTION.headline}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
          {SCHOLAR_ACTION.description}
        </p>
        <p className="mt-3 max-w-2xl text-sm text-sherivs-muted">{SCHOLAR_ACTION.note}</p>
        <ol className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {SCHOLAR_ACTION.steps.map((step) => (
            <li key={step.step} className="min-w-0 border-t-2 border-[#1848fd]/30 pt-4">
              <p className="font-display text-sm font-bold text-[#1558d6]">{step.step}</p>
              <h3 className="mt-2 font-display text-xl font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-sherivs-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </PageContainer>
    </Section>
  );
}

function FlexibilitySection() {
  return (
    <Section id={SCHOLAR_FLEXIBILITY.id} labelledBy="flexibility-heading">
      <PageContainer className="py-16 sm:py-20">
        <SectionHeading
          id="flexibility-heading"
          eyebrow={SCHOLAR_FLEXIBILITY.eyebrow}
          title={SCHOLAR_FLEXIBILITY.headline}
          lead={SCHOLAR_FLEXIBILITY.description}
        />
        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {SCHOLAR_FLEXIBILITY.cards.map((card) => (
            <li key={card.id} className="min-w-0">
              <StoryCard card={card} />
            </li>
          ))}
        </ul>
      </PageContainer>
    </Section>
  );
}

function WorkspaceSection() {
  return (
    <Section id={SCHOLAR_WORKSPACE.id} labelledBy="workspace-heading" className="sherivs-band-soft">
      <PageContainer className="grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="min-w-0">
          <SectionHeading
            id="workspace-heading"
            eyebrow={SCHOLAR_WORKSPACE.eyebrow}
            title={SCHOLAR_WORKSPACE.headline}
            lead={SCHOLAR_WORKSPACE.description}
          />
          <ol className="mt-8 grid gap-5">
            {SCHOLAR_WORKSPACE.cards.map((card, index) => (
              <li key={card.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                <span className="font-display text-sm font-bold text-[#1558d6]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-semibold">{card.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-sherivs-muted">{card.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <InstitutionFigure />
      </PageContainer>
    </Section>
  );
}

function GovernanceSection() {
  return (
    <Section
      id={SCHOLAR_GOVERNANCE.id}
      labelledBy="governance-heading"
      className="sherivs-band-ink"
    >
      <PageContainer className="py-16 sm:py-20">
        <SectionHeading
          id="governance-heading"
          eyebrow={SCHOLAR_GOVERNANCE.eyebrow}
          title={SCHOLAR_GOVERNANCE.headline}
          lead={SCHOLAR_GOVERNANCE.description}
        />
        <dl className="mt-10 grid gap-4 sm:grid-cols-2">
          {SCHOLAR_GOVERNANCE.cards.map((entry) => {
            const card: HomepageCard = entry;
            return (
              <div
                key={card.id}
                className="sherivs-glass-card min-w-0 rounded-[var(--sherivs-radius)] p-5"
              >
                <dt className="flex flex-wrap items-start justify-between gap-3">
                  <span className="font-display text-base font-semibold text-[var(--sherivs-ink)]">
                    {card.title}
                  </span>
                  {card.status ? <StatusBadge status={card.status} /> : null}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-[var(--sherivs-ink-muted)]">
                  {card.body}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className="mt-6 text-sm text-sherivs-muted">
          Read the{" "}
          <PublicLink
            href="/privacy-policy"
            className="sherivs-band-link underline-offset-4 hover:underline"
          >
            privacy policy
          </PublicLink>
          . Sherivs does not display certification badges or audit claims that are not on file.
        </p>
      </PageContainer>
    </Section>
  );
}

function StartSection() {
  return (
    <Section id={SCHOLAR_START.id} labelledBy="start-heading">
      <PageContainer className="py-16 sm:py-20">
        <SectionHeading
          id="start-heading"
          eyebrow={SCHOLAR_START.eyebrow}
          title={SCHOLAR_START.headline}
          lead={SCHOLAR_START.description}
        />
        <p className="mt-4 max-w-2xl text-sm text-sherivs-muted">{SCHOLAR_START.note}</p>
        <ol className="mt-10 grid gap-0">
          {SCHOLAR_START.steps.map((step) => (
            <li
              key={step.step}
              className="grid gap-2 border-t border-[var(--sherivs-border)] py-5 sm:grid-cols-[5rem_minmax(0,14rem)_minmax(0,1fr)] sm:items-baseline sm:gap-6"
            >
              <p className="font-display text-sm font-bold text-[#1558d6]">{step.step}</p>
              <h3 className="font-display text-lg font-semibold">{step.title}</h3>
              <p className="text-sm leading-relaxed text-sherivs-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </PageContainer>
    </Section>
  );
}

function DirectionSection() {
  return (
    <Section id="mission" labelledBy="direction-heading" className="sherivs-band-soft">
      <PageContainer className="py-16 sm:py-20">
        <h2 id="direction-heading" className="sr-only">
          Vision, mission, and approach
        </h2>
        <div className="grid gap-10 lg:grid-cols-3">
          <article className="min-w-0 border-t border-[var(--sherivs-border-strong)] pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1558d6]">
              Vision
            </h3>
            <p className="sherivs-display mt-4 text-xl font-semibold leading-snug sm:text-2xl">
              {PUBLIC_EDITORIAL_VISION}
            </p>
          </article>
          <article className="min-w-0 border-t border-[var(--sherivs-border-strong)] pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1558d6]">
              Mission
            </h3>
            <p className="sherivs-display mt-4 text-xl font-semibold leading-snug sm:text-2xl">
              {PUBLIC_EDITORIAL_MISSION}
            </p>
          </article>
          <article className="min-w-0 border-t border-[var(--sherivs-border-strong)] pt-5">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1558d6]">
              Our approach
            </h3>
            <p className="sherivs-display mt-4 text-xl font-semibold leading-snug sm:text-2xl">
              {PUBLIC_EDITORIAL_APPROACH}
            </p>
          </article>
        </div>
        <div className="mt-8">
          <PublicButton href="/company/vision" variant="text">
            Vision and mission
          </PublicButton>
        </div>
      </PageContainer>
    </Section>
  );
}

function FaqSection() {
  return (
    <Section id="faq" labelledBy="faq-heading">
      <PageContainer className="py-16 sm:py-20">
        <SectionHeading
          id="faq-heading"
          eyebrow="FAQ"
          title="Questions about Sherivs Scholar."
          lead="Answers stay inside the product as it is designed, including what is still in development."
        />
        <div className="mt-10">
          <FaqAccordion items={FAQ_PREVIEW} />
        </div>
        <div className="mt-6">
          <PublicButton href="/faq" variant="text">
            All questions
          </PublicButton>
        </div>
      </PageContainer>
    </Section>
  );
}

function FinalCtaSection() {
  return (
    <Section labelledBy="cta-heading" className="sherivs-band-ink">
      <PageContainer className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="cta-heading" className="sherivs-display text-2xl font-bold sm:text-4xl">
            {SCHOLAR_FINAL_CTA.headline}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-sherivs-muted sm:text-base">
            {SCHOLAR_FINAL_CTA.supporting}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <PublicButton href={SCHOLAR_FINAL_CTA.primaryHref}>
              {SCHOLAR_FINAL_CTA.primaryCta}
            </PublicButton>
            <PublicButton href={SCHOLAR_FINAL_CTA.secondaryHref} variant="secondary">
              {SCHOLAR_FINAL_CTA.secondaryCta}
            </PublicButton>
          </div>
        </div>
      </PageContainer>
    </Section>
  );
}

function StoryCard({ card, prominent = false }: { card: HomepageCard; prominent?: boolean }) {
  return (
    <article
      className={`sherivs-glass-card h-full min-w-0 rounded-[var(--sherivs-radius)] p-5 ${prominent ? "sm:p-7" : ""}`}
    >
      {card.eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1558d6]">
          {card.eyebrow}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <h3 className={`font-display font-semibold ${prominent ? "text-xl" : "text-base"}`}>
          {card.title}
        </h3>
        {card.status ? <StatusBadge status={card.status as CapabilityStatus} /> : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--sherivs-ink-muted)]">{card.body}</p>
    </article>
  );
}

function InstitutionFigure() {
  const nodes = ["People", "Responsibilities", "Places", "Records"] as const;
  return (
    <figure className="sherivs-reality min-w-0">
      <figcaption className="text-xs font-semibold uppercase tracking-[0.16em] text-[#1558d6]">
        Illustration
      </figcaption>
      <ul>
        {nodes.map((node) => (
          <li key={node}>{node}</li>
        ))}
      </ul>
      <p className="sherivs-reality-workspace">One shared workspace</p>
      <p className="text-xs leading-relaxed text-[var(--sherivs-ink-muted)]">
        An institution sits behind the workspace. This is a diagram, not a live product screen, and
        it does not show a separate application for every role.
      </p>
    </figure>
  );
}
