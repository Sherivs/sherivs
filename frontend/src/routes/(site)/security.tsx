import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/sherivs/primitives";
import { CtaLink, PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";
import { SECURITY_GUARANTEES } from "@/lib/experience/public-content";

const DESCRIPTION =
  "How Sherivs protects organizations: tenant isolation at the database, layered authorization with five outcomes, canonical-truth protection, untrusted-by-default AI output, immutable audit and agent lifecycle governance.";

const AUTHORIZATION_INPUTS = [
  "Identity",
  "Tenant",
  "Role",
  "Relationship",
  "Resource",
  "Action",
  "Policy",
  "Context",
  "Risk",
] as const;

const DECISIONS = ["ALLOW", "DENY", "REDACT", "ESCALATE", "REQUIRE_APPROVAL"] as const;

const AI_PRIVACY_CHAIN = [
  "Identity",
  "Authorization",
  "Classification",
  "Purpose check",
  "Minimization",
  "Redaction",
  "AI context",
  "Model",
] as const;

export const Route = createFileRoute("/(site)/security")({
  component: SecurityPage,
  head: () => ({
    meta: [
      { title: pageTitle("Security") },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: pageTitle("Security") },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: canonicalUrl("/security") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/security") }],
  }),
});

function SecurityPage() {
  return (
    <>
      <PublicPageIntro eyebrow="Security" title="Security is the platform's job, not the application's." lead={DESCRIPTION}>
        <CtaLink to="/status" variant="secondary">
          Live status <ArrowRight className="size-4" aria-hidden="true" />
        </CtaLink>
      </PublicPageIntro>

      <PublicSection labelledBy="guarantees-heading">
        <h2 id="guarantees-heading" className="sh-h3">
          Guarantees
        </h2>
        <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SECURITY_GUARANTEES.map((guarantee) => (
            <li key={guarantee.id}>
              <Panel tone="evidence" className="h-full">
                <p className="sh-h4">{guarantee.title}</p>
                <p className="sh-small mt-2 text-ink-2">{guarantee.description}</p>
              </Panel>
            </li>
          ))}
        </ul>
      </PublicSection>

      <PublicSection labelledBy="authz-heading" className="bg-plane-1">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 id="authz-heading" className="sh-h3">
              The authorization decision
            </h2>
            <p className="sh-small sh-prose mt-2 text-ink-2">
              Every request resolves these inputs into exactly one decision. Server functions
              authenticate, resolve tenancy, authorize, validate, execute, audit and return only
              permitted data — in that order.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Authorization inputs">
              {AUTHORIZATION_INPUTS.map((input) => (
                <li key={input} className="sh-chip sh-tone-reality">
                  {input}
                </li>
              ))}
            </ul>
            <p className="sh-label mt-6">Decision</p>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Authorization outcomes">
              {DECISIONS.map((decision) => (
                <li key={decision} className="sh-chip sh-tone-evidence sh-code">
                  {decision}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="sh-h3">Before a model sees anything</h2>
            <p className="sh-small sh-prose mt-2 text-ink-2">
              AI receives only authorized information. Every model call routes through one gateway
              that owns provider abstraction, cost, safety, logging and fallback.
            </p>
            <ol className="mt-6 grid gap-2" aria-label="AI privacy chain">
              {AI_PRIVACY_CHAIN.map((step, i) => (
                <li key={step} className="sh-panel sh-rail sh-tone-intel flex items-center gap-4 px-4 py-3">
                  <span className="sh-index">{String(i + 1).padStart(2, "0")}</span>
                  <span className="sh-small font-medium text-ink-1">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </PublicSection>

      <PublicSection tight labelledBy="disclosure-heading">
        <h2 id="disclosure-heading" className="sh-h3">
          Responsible disclosure
        </h2>
        <p className="sh-small sh-prose mt-2 text-ink-2">
          Sherivs does not yet publish a public vulnerability-disclosure channel or third-party
          certifications. When a channel exists it will be listed here; until then this page makes
          no claim about certifications, audits or compliance programs.
        </p>
      </PublicSection>
    </>
  );
}
