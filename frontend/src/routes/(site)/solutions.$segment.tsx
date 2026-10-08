import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Panel, PlaneLabel, StateBlock } from "@/components/sherivs/primitives";
import { CtaLink, PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";
import { pillarBySlug, segmentBySlug } from "@/lib/experience/public-content";

export const Route = createFileRoute("/(site)/solutions/$segment")({
  component: SegmentPage,
  loader: ({ params }) => {
    const segment = segmentBySlug(params.segment);
    if (!segment) throw notFound();
    return { segment };
  },
  head: ({ loaderData }) => {
    const segment = loaderData?.segment;
    if (!segment) return { meta: [{ title: pageTitle("Solutions") }] };
    const path = `/solutions/${segment.slug}`;
    return {
      meta: [
        { title: pageTitle(`${segment.title} — Solutions`) },
        { name: "description", content: segment.summary },
        { property: "og:title", content: pageTitle(segment.title) },
        { property: "og:description", content: segment.summary },
        { property: "og:url", content: canonicalUrl(path) },
      ],
      links: [{ rel: "canonical", href: canonicalUrl(path) }],
    };
  },
  notFoundComponent: () => (
    <PublicSection>
      <StateBlock
        kind="not-found"
        title="No such solution segment"
        description="Sherivs describes four solution segments. Choose one from the overview."
        action={
          <CtaLink to="/solutions" variant="secondary">
            Solutions overview
          </CtaLink>
        }
      />
    </PublicSection>
  ),
});

function SegmentPage() {
  const { segment } = Route.useLoaderData();
  const pillars = segment.pillars.map(pillarBySlug).filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <>
      <PublicPageIntro eyebrow={`Solutions · ${segment.audience}`} title={segment.title} lead={segment.summary}>
        <CtaLink to="/auth">Create account</CtaLink>
        <CtaLink to="/pricing" variant="secondary">
          Pricing
        </CtaLink>
      </PublicPageIntro>

      <PublicSection labelledBy="segment-narrative">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <h2 id="segment-narrative" className="sh-h3">
              How it works
            </h2>
            <div className="sh-body sh-prose mt-5 grid gap-4 text-ink-2">
              {segment.narrative.map((paragraph) => (
                <p key={paragraph.slice(0, 32)}>{paragraph}</p>
              ))}
            </div>
            <Panel className="mt-8" tone="evidence">
              <p className="sh-label">Scope</p>
              <p className="sh-small mt-2 text-ink-2">{segment.scope}</p>
            </Panel>
          </div>
          <div>
            <h2 className="sh-h3">Pillars it leans on</h2>
            <ul className="mt-5 grid gap-3">
              {pillars.map((pillar) => (
                <li key={pillar.slug}>
                  <Link
                    to="/platform/$pillar"
                    params={{ pillar: pillar.slug }}
                    className="sh-interactive sh-focus group block rounded-[var(--sh-radius-lg)]"
                  >
                    <Panel tone={pillar.plane} className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="sh-h4">{pillar.title}</p>
                        <PlaneLabel plane={pillar.plane} />
                      </div>
                      <p className="sh-small mt-1 text-ink-2">{pillar.statement}</p>
                      <span className="sh-small mt-3 inline-flex items-center gap-1.5 font-semibold text-signal">
                        Read <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                    </Panel>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </PublicSection>

      <PublicSection tight className="bg-plane-1" labelledBy="segment-backed">
        <h2 id="segment-backed" className="sh-label">
          Backed by
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {segment.backedBy.map((path) => (
            <li key={path} className="sh-code rounded-[var(--sh-radius-sm)] border border-line-1 bg-plane-2 px-2.5 py-1.5 text-ink-2">
              {path}
            </li>
          ))}
        </ul>
      </PublicSection>
    </>
  );
}
