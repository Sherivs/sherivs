import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";

/**
 * Public About page — truthful company information only. No fabricated
 * history, customers, headcount, offices, or certifications.
 */

export const Route = createFileRoute("/(site)/about")({
  component: AboutPage,
  head: () => ({
    meta: [
      { title: `About — ${PLATFORM_NAME}` },
      {
        name: "description",
        content:
          "Sherivs is an enterprise technology company building intelligent operating infrastructure for organizations.",
      },
      { property: "og:title", content: `About — ${PLATFORM_NAME}` },
      { property: "og:type", content: "website" },
    ],
  }),
});

function AboutPage() {
  return (
    <section aria-labelledby="about-heading" className="border-b border-border">
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          About
        </p>
        <h1
          id="about-heading"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {PLATFORM_NAME}
        </h1>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Sherivs is an enterprise technology company building intelligent operating infrastructure
          for organizations.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          We believe organizations deserve an operating environment that understands how they
          actually work: one place where people, knowledge, workflows, communications, and data live
          together — where an AI workforce operates inside defined responsibilities and verification
          boundaries, and where operations continuously improve on evidence rather than intuition.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          Sherivs adapts to industries through domain runtimes — complete operating experiences
          built on the same platform. The first is Sherivs Scholar, our education runtime.
        </p>

        <div className="mt-10 rounded-xl border border-border p-6">
          <h2 className="font-display text-lg font-semibold">{PLATFORM_TAGLINE}</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/request-demo"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Request a demo
            </Link>
            <Link
              to="/contact"
              className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Contact us
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
