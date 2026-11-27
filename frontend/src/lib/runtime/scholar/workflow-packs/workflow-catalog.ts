/**
 * Track B: the template catalogue schema from the Sherivs Automation Vision blueprint (template JSON schema).
 * Pure data and validation, no I/O. A catalogue entry describes a workflow template; the installable graph for the
 * ones already built lives in the pack files (`private-school-pack.ts`). Entries that are not built yet say so
 * (`buildState`) and name the event source they would need, so a pack never claims more than exists.
 */
import { WF05_EVENT_PAYLOAD_KEYS } from "./private-school-pack";

/** Only `pri`, `grp`, `isl`, `tvet` and `prep` appear in the blueprint's schema example; the rest are proposed here. */
export const ORG_TYPE_CODES = [
  "pri",
  "grp",
  "isl",
  "tvet",
  "prep",
  "pub_basic",
  "pub_sss",
  "ministry",
  "uni",
  "poly",
  "coe",
  "ops",
] as const;
export type OrgTypeCode = (typeof ORG_TYPE_CODES)[number];

export type CatalogRelease = "v1" | "later" | "needs_integration";
export type RiskTier = "low" | "medium" | "high";
export type AutonomyMax = "suggest" | "draft" | "act_with_approval" | "act_and_report";
export type BuildState = "built" | "needs_event_source" | "needs_integration";

export interface CatalogEntry {
  key: string;
  version: string;
  title: { en: string } & Partial<Record<"ha" | "yo" | "ig" | "pcm", string>>;
  orgTypes: readonly OrgTypeCode[];
  /** From the blueprint where it says so; null where the blueprint gives only pack counts. */
  release: CatalogRelease | null;
  minPlan: null;
  riskTier: RiskTier;
  agent: string;
  autonomyMax: AutonomyMax;
  regulator: string | null;
  trigger: { event: string; filter?: string };
  dataClasses: readonly string[];
  lawfulBasis:
    "contract" | "legitimate_interest" | "legal_obligation" | "consent" | "pending_decision_7";
  evalSuite: string;
  changelog: string;
  buildState: BuildState;
  /** The role that receives the output; roll-ups carry aggregates only (decisions D-06, D-07, D-12). */
  reportsTo: string;
  aggregateOnly: boolean;
}

const KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const AUTONOMY_RANK: Record<AutonomyMax, number> = {
  suggest: 0,
  draft: 1,
  act_with_approval: 2,
  act_and_report: 3,
};
/** Classes that never rise above draft (blueprint and AIN-02). Matched on the data classes a template touches. */
const DRAFT_ONLY_DATA = new Set([
  "payment_instruction",
  "safeguarding_case",
  "role_grant",
  "regulator_submission",
]);

export function validateCatalogEntry(e: CatalogEntry): string[] {
  const p: string[] = [];
  if (!KEY.test(e.key)) p.push("key must be dotted lower-case words");
  if (!SEMVER.test(e.version)) p.push("version must be semver");
  if (!e.title?.en?.trim()) p.push("an English title is required");
  if (e.orgTypes.length === 0) p.push("at least one org type");
  for (const t of e.orgTypes) if (!ORG_TYPE_CODES.includes(t)) p.push(`unknown org type ${t}`);
  if (e.minPlan !== null) p.push("min_plan stays null until PLAN-01");
  if (!e.agent.trim()) p.push("an operating agent is required");
  if (!e.evalSuite.trim()) p.push("an evaluation suite reference is required");
  if (!e.trigger.event.trim()) p.push("a trigger event is required");
  if (!e.reportsTo.trim()) p.push("reportsTo is required");
  if (e.dataClasses.length === 0) p.push("declare at least one data class");
  if (e.lawfulBasis === "consent" && e.dataClasses.length === 0)
    p.push("consent needs data classes");
  if (e.regulator && AUTONOMY_RANK[e.autonomyMax] > AUTONOMY_RANK.draft) {
    p.push("regulator-facing templates prepare files for a human: at most draft");
  }
  if (
    e.dataClasses.some((d) => DRAFT_ONLY_DATA.has(d)) &&
    AUTONOMY_RANK[e.autonomyMax] > AUTONOMY_RANK.draft
  ) {
    p.push("money, safeguarding, role and regulator data classes never rise above draft");
  }
  if (e.riskTier === "high" && AUTONOMY_RANK[e.autonomyMax] > AUTONOMY_RANK.draft) {
    p.push("a high-risk template is capped at draft");
  }
  const known = Object.prototype.hasOwnProperty.call(WF05_EVENT_PAYLOAD_KEYS, e.trigger.event);
  if (e.buildState === "built" && !known)
    p.push("a built template must trigger on an existing WF-05 event source");
  if (e.buildState === "needs_event_source" && known)
    p.push("the trigger event exists: mark it built or name another");
  return p;
}
