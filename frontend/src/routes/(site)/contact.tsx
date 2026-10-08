import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";

/**
 * Public Contact page — real contact routes only. No fabricated addresses,
 * phone numbers, offices, or team pages.
 */

export const Route = createFileRoute("/(site)/contact")({
  component: ContactPage,
  head: () => ({
    meta: [
      { title: `Contact — ${PLATFORM_NAME}` },
      {
        name: "description",
        content: "Contact the Sherivs team — demos, product questions, and support.",
      },
      { property: "og:title", content: `Contact — ${PLATFORM_NAME}` },
      { property: "og:type", content: "website" },
    ],
  }),
});

function ContactPage() {
  return (
    <section aria-labelledby="contact-heading" className="border-b border-border">
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Contact
        </p>
        <h1
          id="contact-heading"
          className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl"
        >
          Talk to {PLATFORM_NAME}
        </h1>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border p-6">
            <h2 className="font-display text-base font-semibold">Demos & sales</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Request a walkthrough of the platform for your organization.
            </p>
            <a
              href="mailto:hello@sherivs.com?subject=Demo%20request"
              className="mt-3 inline-flex text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              hello@sherivs.com
            </a>
          </div>
          <div className="rounded-xl border border-border p-6">
            <h2 className="font-display text-base font-semibold">Support</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Existing customers can reach support, or ask inside their workspace.
            </p>
            <a
              href="mailto:support@sherivs.com"
              className="mt-3 inline-flex text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              support@sherivs.com
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
