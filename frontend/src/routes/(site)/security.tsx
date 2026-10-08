import { createFileRoute } from "@tanstack/react-router";
import { publicPageHead } from "@/content/sherivs/seo";
import {
  ActionLink,
  KindBlock,
  PageHero,
  Plane,
  RuledList,
  SectionHeading,
} from "@/components/sherivs/primitives";
import { AuthorizationDecision, ProvenanceRecord } from "@/components/sherivs/diagrams";
import { SECURITY_GUARANTEES } from "./-content/site-content";

/**
 * Sherivs security model at /security. States the rules the platform enforces and how;
 * it claims no certification, audit report or customer count that does not exist.
 */
export const Route = createFileRoute("/(site)/security")({
  component: SecurityPage,
  head: () => publicPageHead("/security"),
});

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

const SERVER_FUNCTION_ORDER = [
  { title: "Authenticate", detail: "Establish who is calling from a verified session, never from a client claim." },
  { title: "Resolve tenant", detail: "Derive the tenant from the member's record, never from a request parameter." },
  { title: "Authorize", detail: "Resolve the decision from role, relationship, policy and context." },
  { title: "Validate", detail: "Parse the input against a typed schema before any work is done." },
  { title: "Execute", detail: "Run under database Row Level Security, so the database enforces the tenant too." },
  { title: "Audit", detail: "Record who did what, when and under which policy." },
  { title: "Return permitted data", detail: "Respond with only what the caller may see — redacted where policy says so." },
] as const;

function SecurityPage() {
  return (
    <>
      <PageHero
        id="security-heading"
        label="Security"
        title="Security is enforced where the data lives."
        lead="The interface is never the security boundary. Tenancy is enforced by the database, decisions by policy, and AI works inside the same rules as people."
      >
        <ActionLink to="/auth">Create an account</ActionLink>
        <ActionLink to="/platform/governance" variant="secondary">
          The governance layer
        </ActionLink>
      </PageHero>

      <Plane labelledBy="guarantees-heading">
        <SectionHeading
          id="guarantees-heading"
          index="01"
          label="Guarantees"
          title={`${SECURITY_GUARANTEES.length} rules the platform does not break`}
          lead="Each rule is enforced in code and checked by the platform's own verification chain on every change."
        />
        <div className="mt-14">
          <RuledList
            columns={2}
            items={SECURITY_GUARANTEES.map((guarantee) => ({
              title: guarantee.title,
              detail: guarantee.description,
            }))}
          />
        </div>
      </Plane>

      <Plane tone="raised" labelledBy="decision-heading">
        <SectionHeading
          id="decision-heading"
          index="02"
          label="Authorization"
          title="Every request resolves to one decision"
          lead="Nine inputs are evaluated together. The answer is one of five outcomes — never an implicit yes."
        />
        <ol className="mt-14 flex flex-wrap items-center gap-2 lg:ml-[33.333%]" aria-label="Decision inputs">
          {AUTHORIZATION_INPUTS.map((input, position) => (
            <li key={input} className="flex items-center gap-2">
              <span className="sx-data border border-sx-line bg-sx-surface-1 px-3 py-1.5 text-sx-text">{input}</span>
              <span aria-hidden="true" className="sx-data text-sx-muted">
                {position < AUTHORIZATION_INPUTS.length - 1 ? "+" : "="}
              </span>
            </li>
          ))}
          <li className="sx-data border border-sx-signal px-3 py-1.5 text-sx-signal">Decision</li>
        </ol>
        <AuthorizationDecision className="mt-14" />
      </Plane>

      <Plane labelledBy="order-heading">
        <SectionHeading
          id="order-heading"
          index="03"
          label="Server functions"
          title="Server functions follow seven steps, in order"
          lead="A server function is an API. This order is the platform's engineering law for every one of them."
        />
        <ol className="mt-14 border-t border-sx-line-strong lg:ml-[33.333%]">
          {SERVER_FUNCTION_ORDER.map((step, position) => (
            <li key={step.title} className="grid gap-2 border-b border-sx-line py-5 sm:grid-cols-[3rem_12rem_1fr] sm:gap-6">
              <span className="sx-data text-sx-muted">{String(position + 1).padStart(2, "0")}</span>
              <span className="font-medium text-sx-strong">{step.title}</span>
              <span className="sx-small text-sx-muted">{step.detail}</span>
            </li>
          ))}
        </ol>
      </Plane>

      <Plane tone="ink" labelledBy="ai-heading">
        <SectionHeading
          id="ai-heading"
          index="04"
          label="Governed AI"
          title="AI receives only what the person it serves may see"
          lead="Before any model call: authorization, classification, purpose check, minimization and redaction. Model calls go through one AI gateway, which logs them. AI output is untrusted until validated."
        />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:ml-[33.333%]">
          <KindBlock kind="observation">What the system recorded, with its source.</KindBlock>
          <KindBlock kind="inference">What a model concluded, labelled as a conclusion.</KindBlock>
          <KindBlock kind="recommendation">What a model suggests a person consider.</KindBlock>
          <KindBlock kind="action">What will change if approved — never executed silently.</KindBlock>
        </div>
      </Plane>

      <Plane tone="raised" labelledBy="provenance-heading">
        <SectionHeading
          id="provenance-heading"
          index="05"
          label="Provenance"
          title="Every important record can answer where it came from"
        />
        <ProvenanceRecord className="mt-14" />
      </Plane>

      <Plane labelledBy="disclosure-heading">
        <SectionHeading
          id="disclosure-heading"
          index="06"
          label="What this page does not claim"
          title="No certifications are claimed here"
          lead="Sherivs does not list compliance certifications or third-party audit reports on this page because none have been published. When one is, it will be linked here with its scope and date."
        />
      </Plane>
    </>
  );
}
