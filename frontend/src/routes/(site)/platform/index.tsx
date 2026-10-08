import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PageHeader, Section } from "@/components/sherivs/public-shell";
import { CAPABILITIES } from "@/lib/sherivs/public-content";
import { publicHead } from "@/lib/sherivs/page-head";

export const Route = createFileRoute("/(site)/platform/")({
  component: PlatformIndex,
  head: () =>
    publicHead({
      path: "/platform",
      title: "Platform",
      description:
        "The governed Sherivs platform: organizational reality, memory, intelligence, an AI workforce, missions, governance and integrations.",
      breadcrumbs: true,
    }),
});

function PlatformIndex() {
  return (
    <>
      <PageHeader
        path="/platform"
        eyebrow="Platform"
        title="One governed core for people, work, knowledge and AI."
        lead="Seven capabilities form the platform. Each is described here by what it guarantees and where it stops — and each links to the part of the codebase that implements it."
      />
      <Section id="capabilities" eyebrow="Capabilities" title="What the platform provides">
        <ol className="grid">
          {CAPABILITIES.map((c, i) => (
            <li key={c.id} className="sv-rule">
              <Link
                to="/platform/$capability"
                params={{ capability: c.id }}
                className="sv-focusable group grid items-baseline gap-2 py-6 sm:grid-cols-12 sm:gap-6"
              >
                <span className="sv-data sv-faint sm:col-span-1">{String(i + 1).padStart(2, "0")}</span>
                <span className="sv-h2 sm:col-span-4">{c.title}</span>
                <span className="sv-body sv-muted sm:col-span-6">{c.lead}</span>
                <ArrowRight
                  aria-hidden
                  className="size-4 text-[color:var(--sv-text-3)] transition-transform group-hover:translate-x-1 sm:col-span-1 sm:justify-self-end"
                />
              </Link>
            </li>
          ))}
        </ol>
      </Section>
      <Section
        id="scope"
        tone="ground"
        eyebrow="Scope today"
        title="Organizational infrastructure, stated plainly."
        lead="Sherivs today covers an organization's people, work, knowledge, communication and AI workforce. It does not include device, sensor or physical-environment capabilities; nothing on this site claims them."
      />
    </>
  );
}
