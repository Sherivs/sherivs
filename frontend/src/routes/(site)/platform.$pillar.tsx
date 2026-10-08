import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Panel, PlaneLabel, StateBlock } from "@/components/sherivs/primitives";
import { CtaLink, PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";
import { PLATFORM_PILLARS, pillarBySlug } from "@/lib/experience/public-content";

export const Route = createFileRoute("/(site)/platform/$pillar")({
  component: PillarPage,
  loader: ({ params }) => {
    const pillar = pillarBySlug(params.pillar);
    if (!pillar) throw notFound();
    return { pillar };
  },
  head: ({ loaderData }) => {
    const pillar = loaderData?.pillar;
    if (!pillar) return { meta: [{ title: pageTitle("Platform") }] };
    const path = `/platform/${pillar.slug}`;
    return {
      meta: [
        { title: pageTitle(pillar.title) },
        { name: "description", content: pillar.statement },
        { property: "og:title", content: pageTitle(pillar.title) },
        { property: "og:description", content: pillar.statement },
        { property: "og:url", content: canonicalUrl(path) },
      ],
      links: [{ rel: "canonical", href: canonicalUrl(path) }],
    };
  },
  notFoundComponent: () => (
    <PublicSection>
      <StateBlock
        kind="not-found"
        title="This pillar is not part of the platform narrative"
        description="The platform pages describe seven pillars. Choose one from the overview."
        action={
          <CtaLink to="/platform" variant="secondary">
            Platform overview
          </CtaLink>
        }
      />
    </PublicSection>
  ),
});

function PillarPage() {
  const { pillar } = Route.useLoaderData();
  const index = PLATFORM_PILLARS.findIndex((item) => item.slug === pillar.slug);
  const previous = PLATFORM_PILLARS[index - 1];
  const next = PLATFORM_PILLARS[index + 1];

  return (
    <>
      <PublicPageIntro eyebrow={`Platform · ${String(index + 1).padStart(2, "0")}`} title={pillar.title} lead={pillar.statement}>
        <PlaneLabel plane={pillar.plane} />
      </PublicPageIntro>

      <PublicSection labelledBy="narrative-heading">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 id="narrative-heading" className="sh-h3">
              What it is
            </h2>
            <div className="sh-body sh-prose mt-5 grid gap-4 text-ink-2">
              {pillar.narrative.map((paragraph) => (
                <p key={paragraph.slice(0, 32)}>{paragraph}</p>
              ))}
            </div>
          </div>
          <div>
            <h2 className="sh-h3">Properties</h2>
            <ul className="mt-5 grid gap-3">
              {pillar.properties.map((property) => (
                <li key={property.title}>
                  <Panel tone={pillar.plane} className="p-4">
                    <p className="sh-h4">{property.title}</p>
                    <p className="sh-small mt-1 text-ink-2">{property.detail}</p>
                  </Panel>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </PublicSection>

      <PublicSection tight className="bg-plane-1" labelledBy="backed-heading">
        <h2 id="backed-heading" className="sh-label">
          Backed by
        </h2>
        <p className="sh-small mt-2 text-ink-2">
          Every statement on this page describes an implemented module. Reviewers can open these
          paths in the repository to verify the claims.
        </p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {pillar.backedBy.map((path) => (
            <li key={path} className="sh-code rounded-[var(--sh-radius-sm)] border border-line-1 bg-plane-2 px-2.5 py-1.5 text-ink-2">
              {path}
            </li>
          ))}
        </ul>
      </PublicSection>

      <PublicSection tight>
        <nav aria-label="Pillar navigation" className="flex flex-wrap items-center justify-between gap-4">
          {previous ? (
            <Link
              to="/platform/$pillar"
              params={{ pillar: previous.slug }}
              className="sh-focus sh-small inline-flex items-center gap-1.5 font-semibold text-ink-2 hover:text-ink-1"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" /> {previous.title}
            </Link>
          ) : (
            <Link to="/platform" className="sh-focus sh-small inline-flex items-center gap-1.5 font-semibold text-ink-2 hover:text-ink-1">
              <ArrowLeft className="size-3.5" aria-hidden="true" /> Platform
            </Link>
          )}
          {next ? (
            <Link
              to="/platform/$pillar"
              params={{ pillar: next.slug }}
              className="sh-focus sh-small inline-flex items-center gap-1.5 font-semibold text-signal"
            >
              {next.title} <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <Link to="/platform/kernel" className="sh-focus sh-small inline-flex items-center gap-1.5 font-semibold text-signal">
              Kernel registry <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </nav>
      </PublicSection>
    </>
  );
}
