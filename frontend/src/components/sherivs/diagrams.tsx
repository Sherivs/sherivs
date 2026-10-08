/**
 * Sherivs explanatory diagrams.
 *
 * These are schematics of how the platform works. They never display live or invented
 * data: every diagram is labelled as a schematic, values are field names or the closed
 * vocabularies defined by the platform contracts, and nothing animates as if a backend
 * were processing.
 */
import { cn } from "@/lib/utils";
import { KindBlock, type IntelligenceKind } from "./primitives";

function SchematicCaption({ children }: { children: string }) {
  return <p className="sx-label mt-4 text-[0.6875rem]">Schematic · {children}</p>;
}

const STRATA: readonly { name: string; detail: string; tone: string }[] = [
  {
    name: "Evidence",
    detail: "What was done, by whom, verified against what.",
    tone: "var(--sx-evidence)",
  },
  {
    name: "Action",
    detail: "Missions and decisions executed by people and governed workers.",
    tone: "var(--sx-action)",
  },
  {
    name: "Intelligence",
    detail: "Context, memory, knowledge and AI — derived, never canonical.",
    tone: "var(--sx-inference)",
  },
  {
    name: "Reality",
    detail: "Verified records: people, systems, events, state and relationships.",
    tone: "var(--sx-signal)",
  },
];

/** The four planes, drawn bottom-up: reality supports everything above it. */
export function RealityStrata({ className }: { className?: string }) {
  return (
    <figure className={cn("w-full", className)}>
      <ol
        className="grid gap-2"
        aria-label="Platform planes, from evidence at the top to reality at the base"
      >
        {STRATA.map((stratum, position) => (
          <li
            key={stratum.name}
            className="group relative grid grid-cols-[auto_1fr] items-center gap-4 border border-sx-line bg-sx-surface-1 px-4 py-4 transition-colors duration-200 hover:border-sx-line-strong sm:px-5"
            style={{ marginLeft: `${(STRATA.length - 1 - position) * 0.75}rem` }}
          >
            <span aria-hidden="true" className="h-8 w-[3px]" style={{ background: stratum.tone }} />
            <span className="grid gap-0.5">
              <span className="font-[family-name:var(--font-sx-display)] text-[1.0625rem] font-semibold text-sx-strong">
                {stratum.name}
              </span>
              <span className="sx-caption">{stratum.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <SchematicCaption>planes of the platform</SchematicCaption>
    </figure>
  );
}

export const MISSION_STAGES: readonly { name: string; detail: string }[] = [
  { name: "Mission", detail: "Objective, owner, scope and acceptance criteria are declared." },
  { name: "Workforce", detail: "People and governed workers are assigned under leased authority." },
  { name: "Execution", detail: "Work passes authorization and policy gates as it runs." },
  { name: "Evidence", detail: "Results are captured with source, actor and time." },
  { name: "Verification", detail: "Evidence is checked against the acceptance criteria." },
  { name: "Outcome", detail: "The verified result is recorded; the trail stays auditable." },
];

export function MissionChain({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <ol className="grid border-t border-sx-line-strong sm:grid-cols-2 lg:grid-cols-6">
        {MISSION_STAGES.map((stage, position) => (
          <li
            key={stage.name}
            className="relative grid content-start gap-3 border-b border-sx-line py-6 sm:pr-6 lg:border-b-0 lg:border-r lg:last:border-r-0 lg:px-5 lg:first:pl-0"
          >
            <span className="sx-data text-sx-signal">{String(position + 1).padStart(2, "0")}</span>
            <span className="font-[family-name:var(--font-sx-display)] text-lg font-semibold text-sx-strong">
              {stage.name}
            </span>
            <span className="sx-caption">{stage.detail}</span>
          </li>
        ))}
      </ol>
      <SchematicCaption>mission lifecycle</SchematicCaption>
    </figure>
  );
}

const DECISION_INPUTS = [
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

export const AUTHORIZATION_OUTCOMES: readonly { name: string; detail: string; tone: string }[] = [
  { name: "ALLOW", detail: "Proceed and audit.", tone: "var(--sx-verification)" },
  { name: "DENY", detail: "Refuse and audit.", tone: "var(--sx-danger)" },
  { name: "REDACT", detail: "Proceed with fields withheld.", tone: "var(--sx-observation)" },
  { name: "ESCALATE", detail: "Route to a higher authority.", tone: "var(--sx-action)" },
  { name: "REQUIRE_APPROVAL", detail: "Hold until a human approves.", tone: "var(--sx-inference)" },
];

export function AuthorizationDecision({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <div className="grid gap-8 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
        <ul className="flex flex-wrap gap-2" aria-label="Decision inputs">
          {DECISION_INPUTS.map((input) => (
            <li
              key={input}
              className="sx-data border border-sx-line bg-sx-surface-1 px-3 py-1.5 text-sx-text"
            >
              {input}
            </li>
          ))}
        </ul>
        <div aria-hidden="true" className="hidden items-center gap-2 lg:flex">
          <span className="h-px w-10 bg-sx-line-strong" />
          <span className="sx-label">decision</span>
          <span className="h-px w-10 bg-sx-line-strong" />
        </div>
        <ul className="grid gap-2" aria-label="Possible decisions">
          {AUTHORIZATION_OUTCOMES.map((outcome) => (
            <li
              key={outcome.name}
              className="grid grid-cols-[auto_1fr] items-baseline gap-4 border-b border-sx-line pb-2"
            >
              <span className="sx-data font-semibold" style={{ color: outcome.tone }}>
                {outcome.name}
              </span>
              <span className="sx-caption">{outcome.detail}</span>
            </li>
          ))}
        </ul>
      </div>
      <SchematicCaption>one authorization decision</SchematicCaption>
    </figure>
  );
}

export const WORKER_FIELDS: readonly { field: string; meaning: string }[] = [
  { field: "agent_id", meaning: "Stable identity, never reused" },
  { field: "owner", meaning: "The accountable human or team" },
  { field: "purpose", meaning: "What the worker exists to do" },
  { field: "capabilities", meaning: "Declared, reviewable abilities" },
  { field: "tools", meaning: "The only tools it may call" },
  { field: "permissions", meaning: "Granted, never self-assigned" },
  { field: "tenant_scope", meaning: "The tenants it may act within" },
  { field: "memory_scope", meaning: "What it may remember and recall" },
  { field: "audit_trail", meaning: "Every action, attributable" },
  { field: "lifecycle_state", meaning: "proposed → … → retired" },
];

export function WorkerAnatomy({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <div className="border border-sx-line bg-sx-surface-1">
        <div className="flex items-center justify-between border-b border-sx-line px-4 py-3">
          <span className="sx-label">worker identity record</span>
          <span className="sx-label">fields</span>
        </div>
        <dl className="divide-y divide-[color:var(--sx-line-subtle)]">
          {WORKER_FIELDS.map((row) => (
            <div key={row.field} className="grid grid-cols-[minmax(0,11rem)_1fr] gap-4 px-4 py-2.5">
              <dt className="sx-data text-sx-signal">{row.field}</dt>
              <dd className="sx-caption">{row.meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
      <SchematicCaption>governed worker</SchematicCaption>
    </figure>
  );
}

const KIND_EXAMPLES: readonly { kind: IntelligenceKind; text: string }[] = [
  { kind: "observation", text: "What the system recorded, quoted from canonical records." },
  { kind: "inference", text: "What the model concluded from those records, with its confidence." },
  { kind: "recommendation", text: "What it suggests a person do next — never done automatically." },
  { kind: "action", text: "What will run if approved, and under whose authority." },
  { kind: "evidence", text: "The records and sources each claim rests on." },
  { kind: "verification", text: "Whether the result was checked, by whom, and against what." },
];

/** The six epistemic kinds every AI response is separated into. */
export function IntelligenceKinds({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <div className="grid gap-5 sm:grid-cols-2">
        {KIND_EXAMPLES.map((example) => (
          <KindBlock key={example.kind} kind={example.kind}>
            {example.text}
          </KindBlock>
        ))}
      </div>
      <SchematicCaption>how an AI response is separated</SchematicCaption>
    </figure>
  );
}

const PROVENANCE_FIELDS: readonly { field: string; question: string }[] = [
  { field: "source", question: "Where did this come from?" },
  { field: "actor", question: "Who created it?" },
  { field: "recorded_at", question: "When was it created?" },
  { field: "verified", question: "Was it verified?" },
  { field: "ai_generated", question: "Was it generated by AI?" },
  { field: "confidence", question: "Can it be trusted?" },
];

export function ProvenanceRecord({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <dl className="grid border-t border-sx-line-strong sm:grid-cols-2 lg:grid-cols-3">
        {PROVENANCE_FIELDS.map((row) => (
          <div key={row.field} className="grid gap-1 border-b border-sx-line py-5 sm:pr-6">
            <dt className="sx-data text-sx-evidence">{row.field}</dt>
            <dd className="sx-small text-sx-text">{row.question}</dd>
          </div>
        ))}
      </dl>
      <SchematicCaption>provenance carried by every important record</SchematicCaption>
    </figure>
  );
}
