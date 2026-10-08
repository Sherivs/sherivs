import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Panel, PlaneLabel } from "@/components/sherivs/primitives";
import { CtaLink, PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";
import { PLATFORM_PILLARS } from "@/lib/experience/public-content";
import { KERNEL_CAPABILITIES } from "@/lib/kernel/kernel-capability-registry";

const DESCRIPTION =
  "The Sherivs platform: a canonical reality model, governed memory, an AI workforce, a mission system, a governed intelligence layer, platform-enforced governance and provider-agnostic integrations.";

export const Route = createFileRoute("/(site)/platform/")({
  component: PlatformOverview,
  head: () => ({
    meta: [
      { title: pageTitle("Platform") },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: pageTitle("Platform") },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: canonicalUrl("/platform") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/platform") }],
  }),
});

function PlatformOverview() {
  return (
    <>
      <PublicPageIntro
        eyebrow="Platform"
        title="Seven pillars. One authority model."
        lead={DESCRIPTION}
      >
        <CtaLink to="/platform/kernel" variant="secondary">
          Kernel registry — {KERNEL_CAPABILITIES.length} capabilities{" "}
          <ArrowRight className="size-4" aria-hidden="true" />
        </CtaLink>
        <CtaLink to="/auth">Create account</CtaLink>
      </PublicPageIntro>

      <PublicSection labelledBy="pillars-heading">
        <h2 id="pillars-heading" className="sr-only">
          Platform pillars
        </h2>
        <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PLATFORM_PILLARS.map((pillar, i) => (
            <li key={pillar.slug}>
              <Link
                to="/platform/$pillar"
                params={{ pillar: pillar.slug }}
                className="sh-interactive sh-focus group block h-full rounded-[var(--sh-radius-lg)]"
              >
                <Panel tone={pillar.plane} className="h-full">
                  <div className="flex items-center justify-between gap-3">
                    <span className="sh-index">{String(i + 1).padStart(2, "0")}</span>
                    <PlaneLabel plane={pillar.plane} />
                  </div>
                  <p className="sh-h3 mt-4">{pillar.title}</p>
                  <p className="sh-small mt-2 text-ink-2">{pillar.statement}</p>
                  <span className="sh-small mt-5 inline-flex items-center gap-1.5 font-semibold text-signal">
                    Read <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Panel>
              </Link>
            </li>
          ))}
        </ol>
      </PublicSection>
    </>
  );
}
