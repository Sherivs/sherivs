import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/sherivs/primitives";
import { PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";
import { routesForPlane } from "@/lib/experience/route-architecture";

/**
 * Legal index. Lists only the legal documents that exist; documents that are
 * declared PLANNED in the route architecture are named as not yet published
 * rather than linked to an empty page.
 */
const DESCRIPTION = "Legal and policy documents published by Sherivs.";

export const Route = createFileRoute("/(site)/legal/")({
  component: LegalIndex,
  head: () => ({
    meta: [
      { title: pageTitle("Legal") },
      { name: "description", content: DESCRIPTION },
      { property: "og:url", content: canonicalUrl("/legal") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/legal") }],
  }),
});

const LEGAL_ROUTES = routesForPlane("public").filter(
  (route) => route.path.startsWith("/legal/") && route.path !== "/legal",
);

function LegalIndex() {
  const live = LEGAL_ROUTES.filter((route) => route.status === "LIVE");
  const planned = LEGAL_ROUTES.filter((route) => route.status !== "LIVE");

  return (
    <>
      <PublicPageIntro eyebrow="Legal" title="Legal and policy." lead={DESCRIPTION} />
      <PublicSection labelledBy="published-heading">
        <h2 id="published-heading" className="sh-h3">
          Published
        </h2>
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {live.map((route) => (
            <li key={route.path}>
              <Link to={route.path} className="sh-interactive sh-focus group block rounded-[var(--sh-radius-lg)]">
                <Panel className="p-4">
                  <p className="sh-h4">{route.label}</p>
                  {route.description && <p className="sh-small mt-1 text-ink-2">{route.description}</p>}
                  <span className="sh-small mt-3 inline-flex items-center gap-1.5 font-semibold text-signal">
                    Read <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                </Panel>
              </Link>
            </li>
          ))}
        </ul>

        {planned.length > 0 && (
          <>
            <h2 className="sh-h3 mt-12">Not yet published</h2>
            <p className="sh-small sh-prose mt-2 text-ink-2">
              These documents are part of the platform's legal architecture but have not been
              published. They are not linked anywhere until they exist.
            </p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {planned.map((route) => (
                <li key={route.path} className="sh-chip sh-tone-neutral">
                  {route.label}
                </li>
              ))}
            </ul>
          </>
        )}
      </PublicSection>
    </>
  );
}
