import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { DocPage, DocSection } from "@/components/sherivs/doc-page";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/legal/cookies")({
  component: CookiesPage,
  head: () => ({
    meta: [
      { title: "Sherivs cookie notice" },
      {
        name: "description",
        content:
          "What Sherivs stores in your browser: sessions, preferences, and nothing for advertisers.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/legal/cookies` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/legal/cookies` }],
  }),
});

function CookiesPage() {
  return (
    <SherivsPublicShell>
      <DocPage
        title="Cookie notice"
        lead="Sherivs stores what it needs to keep you signed in and your workspace yours — and nothing for advertisers."
        updated="2026-10-08"
      >
        <DocSection heading="Strictly necessary">
          <p>
            Session and authentication storage that keeps you signed in, remembers your organization
            context, and protects against request forgery. The product cannot function without
            these.
          </p>
        </DocSection>
        <DocSection heading="Preferences">
          <p>
            Theme (light, dark, system), language, timezone and accessibility choices, stored on
            your device so surfaces render the way you left them.
          </p>
        </DocSection>
        <DocSection heading="What is absent">
          <p>
            No third-party advertising trackers, no cross-site behavioral profiling, no sale of
            browsing data. Analytics, where enabled, are first-party and scoped to operating the
            service. See the{" "}
            <Link to="/legal/privacy" className="underline underline-offset-4">
              privacy notice
            </Link>{" "}
            for the full picture.
          </p>
        </DocSection>
      </DocPage>
    </SherivsPublicShell>
  );
}
