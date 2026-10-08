/**
 * CoreGrid — kernel engineering-section dictionary (domain-neutral).
 *
 * Every CoreGrid phase must declare the same twenty engineering sections. This
 * module is the kernel-side single source of truth for that dictionary: the
 * documentation scanner (`scripts/verification/engineering-sections.mjs`), the
 * completeness matrix (PROGRESS.md §10) and the phase-contract schema
 * (`kernel/phase-contract.ts`) all classify against these same keys.
 *
 * The dictionary is domain-neutral by construction: it names engineering
 * concerns (identity, contract, tenancy, AI safety, …), never any domain
 * ontology. A runtime installs a phase contract; it never edits this list.
 *
 * Authority: CONSTITUTION §41 (definition of done), AGENTS.md §42 (agent report
 * sections), PROGRESS.md §10 (completeness matrix).
 */

export const ENGINEERING_SECTION_KEYS = [
  "identity",
  "purpose",
  "ownership",
  "boundary",
  "principle",
  "architecture",
  "contract",
  "dataModel",
  "event",
  "workflow",
  "security",
  "tenancy",
  "aiSafety",
  "observability",
  "testing",
  "integration",
  "dependency",
  "risk",
  "completion",
  "extension",
] as const;

export type EngineeringSectionKey = (typeof ENGINEERING_SECTION_KEYS)[number];

export const ENGINEERING_SECTION_COUNT = ENGINEERING_SECTION_KEYS.length;

export interface EngineeringSectionSpec {
  key: EngineeringSectionKey;
  /** Canonical dictionary term used by PROGRESS.md §10. */
  term: string;
  /** What the declaration must answer for the phase to count as covered. */
  intent: string;
}

export const ENGINEERING_SECTIONS: readonly EngineeringSectionSpec[] = [
  { key: "identity", term: "Identity", intent: "Which registry identity this phase owns." },
  { key: "purpose", term: "Purpose", intent: "Why the capability exists in Sherivs." },
  {
    key: "ownership",
    term: "Ownership",
    intent: "Capabilities owned, and which layer is the single owner.",
  },
  {
    key: "boundary",
    term: "Non-Ownership / Boundaries",
    intent: "What the phase explicitly must not own or embed.",
  },
  { key: "principle", term: "Principles", intent: "Invariants that cannot be traded away." },
  {
    key: "architecture",
    term: "Architecture",
    intent: "Domain → application → policy → infrastructure placement.",
  },
  {
    key: "contract",
    term: "Contracts / API",
    intent: "Provided and consumed contracts (commands, queries, APIs, events).",
  },
  { key: "dataModel", term: "Data Model", intent: "Owned state, schema, migrations and RLS." },
  { key: "event", term: "Events", intent: "Event vocabulary and recording path." },
  { key: "workflow", term: "Workflows", intent: "Operating workflows the phase participates in." },
  {
    key: "security",
    term: "Security",
    intent: "Enforcement points and the failure mode when they are bypassed.",
  },
  { key: "tenancy", term: "Tenancy", intent: "Tenant scoping and isolation guarantees." },
  {
    key: "aiSafety",
    term: "AI Safety",
    intent: "AI boundary, approval gates and untrusted-output handling.",
  },
  {
    key: "observability",
    term: "Observability",
    intent: "Logs, metrics, traces, audit records and health signals.",
  },
  { key: "testing", term: "Testing", intent: "Suite, negative tests and verification command." },
  {
    key: "integration",
    term: "Integration",
    intent: "How other phases and runtimes consume the capability.",
  },
  {
    key: "dependency",
    term: "Dependencies",
    intent: "Phase dependencies and external providers behind adapters.",
  },
  { key: "risk", term: "Risks", intent: "Known risks with mitigations and owners." },
  {
    key: "completion",
    term: "Completion Criteria",
    intent: "Evidence required to advance each engineering level (L1–L5).",
  },
  {
    key: "extension",
    term: "Extensions",
    intent: "Sanctioned extension points that do not require kernel rewrites.",
  },
] as const;

export function isEngineeringSectionKey(value: unknown): value is EngineeringSectionKey {
  return (
    typeof value === "string" && (ENGINEERING_SECTION_KEYS as readonly string[]).includes(value)
  );
}

export function engineeringSectionSpec(key: EngineeringSectionKey): EngineeringSectionSpec {
  const spec = ENGINEERING_SECTIONS.find((section) => section.key === key);
  if (!spec) throw new Error(`Unregistered engineering section "${key}"`);
  return spec;
}

/** Sections required by the dictionary but absent from a declaration set. */
export function missingEngineeringSections(declared: readonly string[]): EngineeringSectionKey[] {
  const present = new Set(declared);
  return ENGINEERING_SECTION_KEYS.filter((key) => !present.has(key));
}

export interface EngineeringSectionCoverage {
  total: number;
  declared: number;
  missing: readonly EngineeringSectionKey[];
  complete: boolean;
  ratio: number;
}

export function engineeringSectionCoverage(
  declared: readonly string[],
): EngineeringSectionCoverage {
  const missing = missingEngineeringSections(declared);
  const declaredCount = ENGINEERING_SECTION_KEYS.length - missing.length;
  return {
    total: ENGINEERING_SECTION_KEYS.length,
    declared: declaredCount,
    missing,
    complete: missing.length === 0,
    ratio: declaredCount / ENGINEERING_SECTION_KEYS.length,
  };
}

/* ─────────────────────────────────────────────────────────────
 * ASI invariants (governance law, not preferences)
 * ────────────────────────────────────────────────────────────*/

/**
 * Invariants every phase contract must carry whenever autonomy is involved.
 * Derived from AGENTS.md §7 (AI sovereignty boundary), §8 (self-improvement
 * law), §9 (canonical truth), §19–21 (privacy, gateway, output trust).
 */
export const ASI_INVARIANTS = [
  "canonical-truth-separation",
  "agent-least-privilege",
  "human-approval-for-critical",
  "ai-output-untrusted",
  "no-permission-expansion",
  "provenance-required",
  "observable-autonomy",
] as const;

export type AsiInvariant = (typeof ASI_INVARIANTS)[number];

/** The subset no phase contract may omit. */
export const MANDATORY_ASI_INVARIANTS: readonly AsiInvariant[] = [
  "canonical-truth-separation",
  "agent-least-privilege",
  "human-approval-for-critical",
  "ai-output-untrusted",
  "no-permission-expansion",
] as const;

export function isAsiInvariant(value: unknown): value is AsiInvariant {
  return typeof value === "string" && (ASI_INVARIANTS as readonly string[]).includes(value);
}
