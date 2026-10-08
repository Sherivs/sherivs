import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { DocPage, DocSection } from "@/components/sherivs/doc-page";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/about")({
  component: AboutPage,
  head: () => ({
    meta: [
      { title: "About Sherivs" },
      {
        name: "description",
        content:
          "Sherivs is institutional intelligence infrastructure: the governed operational layer where an organization's reality, people, AI workforce and evidence live together.",
      },
      { property: "og:title", content: "About Sherivs" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/about` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/about` }],
  }),
});

function AboutPage() {
  return (
    <SherivsPublicShell>
      <DocPage
        title="About Sherivs"
        lead="Sherivs is institutional intelligence infrastructure — the governed operational layer where an organization's reality, its people, its AI workforce and its evidence live together."
        updated="2026-10-08"
      >
        <DocSection heading="What Sherivs is">
          <p>
            Institutions run on decisions made inside delegated authority — and until now, no
            infrastructure modeled that. Sherivs is that layer: identity and tenancy first, then a
            living model of organizational reality, then intelligence, execution and verification on
            top of it.
          </p>
        </DocSection>
        <DocSection heading="How it is built">
          <p>
            Sherivs is a contracted kernel with installed domain runtimes. Every capability is
            owned, every contract is validated on change, and the platform cannot silently drift.
            The first installed runtime serves education; the kernel itself belongs to no single
            sector.
          </p>
        </DocSection>
        <DocSection heading="What Sherivs will not do">
          <p>
            Sherivs does not sell organizational data, does not let interfaces decide what is true,
            and does not present AI output as verified fact. Canonical records stay canonical;
            intelligence stays labeled as intelligence. No customer stories, metrics or partnerships
            are claimed on this site until they are real and permissioned.
          </p>
        </DocSection>
        <DocSection heading="Go further">
          <p>
            Read the{" "}
            <Link to="/platform" className="underline underline-offset-4">
              kernel detail
            </Link>
            , review{" "}
            <Link to="/security" className="underline underline-offset-4">
              security and governance
            </Link>
            , or{" "}
            <Link to="/contact" className="underline underline-offset-4">
              get in touch
            </Link>
            .
          </p>
        </DocSection>
      </DocPage>
    </SherivsPublicShell>
  );
}
