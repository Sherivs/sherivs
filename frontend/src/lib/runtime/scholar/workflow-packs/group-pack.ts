/**
 * WF-15b: Group Pack (multi-campus school groups). Pure data; nothing is installed or enabled here.
 *
 * What it holds, honestly:
 * - the eight templates that already exist in the Private School Pack (the fee ladder and its five reminders,
 *   payment receipt, same-day absence alert), installed per campus unchanged;
 * - the group-level workflows the blueprint names (weekly roll-up, campus KPI breach alert, consolidated finance
 *   close, fee policy rollout, cross-campus student transfer, group-wide staff transfer). None has a WF-05 event
 *   source yet, so each is declared `needs_event_source` and cannot be installed until its event exists.
 *
 * The blueprint says the Group Pack has 14 V1, 6 later and 3 needs-integration templates but does not list which;
 * this file does not invent the other seventeen.
 *
 * Reporting (ADR-142): group outputs go to the group director and are aggregate-only; a campus is its own
 * organisation and never sees another campus's records.
 */
import { PRIVATE_SCHOOL_PACK_V1 } from "./private-school-pack";
import { validateCatalogEntry, type CatalogEntry } from "./workflow-catalog";

export const GROUP_DIRECTOR_ROLE = "group_director";

/** Templates reused from the Private School Pack, installed in each campus organisation. */
export const GROUP_REUSED_TEMPLATE_KEYS = [
  "ps_fee_ladder",
  "ps_fee_week_start",
  "ps_fee_week_end",
  "ps_fee_due_day",
  "ps_fee_overdue",
  "ps_fee_escalation",
  "ps_payment_receipt",
  "ps_absence_alert",
] as const;

const base = {
  version: "0.1.0",
  minPlan: null,
  orgTypes: ["grp"],
  evalSuite: "pending",
  changelog: "0.1.0: declared; not buildable until its trigger event exists",
  buildState: "needs_event_source",
  release: null,
} as const;

export const GROUP_PACK_ENTRIES: readonly CatalogEntry[] = [
  {
    ...base,
    key: "group.weekly_rollup",
    title: { en: "Group weekly roll-up" },
    riskTier: "low",
    agent: "Brief",
    autonomyMax: "draft",
    regulator: null,
    trigger: { event: "schedule.weekly" },
    buildState: "built",
    dataClasses: ["aggregate_attendance", "aggregate_collections", "aggregate_incidents"],
    lawfulBasis: "legitimate_interest",
    reportsTo: GROUP_DIRECTOR_ROLE,
    aggregateOnly: true,
  },
  {
    ...base,
    key: "group.kpi_breach_alert",
    title: { en: "Campus KPI breach alert" },
    riskTier: "low",
    agent: "Compass",
    autonomyMax: "draft",
    regulator: null,
    trigger: { event: "group.kpi_below_threshold" },
    buildState: "built",
    dataClasses: ["aggregate_attendance", "aggregate_collections"],
    lawfulBasis: "legitimate_interest",
    reportsTo: GROUP_DIRECTOR_ROLE,
    aggregateOnly: true,
  },
  {
    ...base,
    key: "group.finance_close",
    title: { en: "Group consolidated finance close" },
    riskTier: "high",
    agent: "Ledger",
    autonomyMax: "draft",
    regulator: null,
    trigger: { event: "schedule.month_end" },
    buildState: "built",
    dataClasses: ["aggregate_collections", "aggregate_arrears", "aggregate_payroll"],
    lawfulBasis: "legitimate_interest",
    reportsTo: GROUP_DIRECTOR_ROLE,
    aggregateOnly: true,
  },
  {
    ...base,
    key: "group.fee_policy_rollout",
    title: { en: "Group fee policy rollout" },
    riskTier: "high",
    agent: "Tally",
    autonomyMax: "draft",
    regulator: null,
    trigger: { event: "fees.schedule_edited" },
    dataClasses: ["fee_schedule"],
    lawfulBasis: "contract",
    reportsTo: GROUP_DIRECTOR_ROLE,
    aggregateOnly: false,
  },
  {
    ...base,
    key: "group.student_transfer",
    title: { en: "Cross-campus student transfer" },
    riskTier: "high",
    agent: "Roll",
    autonomyMax: "draft",
    regulator: null,
    trigger: { event: "students.transfer_opened" },
    dataClasses: ["learner_record", "fee_balance", "guardian_contact"],
    lawfulBasis: "contract",
    reportsTo: GROUP_DIRECTOR_ROLE,
    aggregateOnly: false,
  },
  {
    ...base,
    key: "group.staff_transfer",
    title: { en: "Group-wide staff transfer" },
    riskTier: "high",
    agent: "Roll",
    autonomyMax: "draft",
    regulator: null,
    trigger: { event: "staff.transfer_proposed" },
    dataClasses: ["staff_record", "payroll_record", "role_grant"],
    lawfulBasis: "contract",
    reportsTo: GROUP_DIRECTOR_ROLE,
    aggregateOnly: false,
  },
];

export function validateGroupPack(
  privateKeys: readonly string[] = PRIVATE_SCHOOL_PACK_V1.templates.map((t) => t.templateKey),
): string[] {
  const p: string[] = [];
  for (const k of GROUP_REUSED_TEMPLATE_KEYS) {
    if (!privateKeys.includes(k))
      p.push(`reused template ${k} does not exist in the Private School Pack`);
  }
  const seen = new Set<string>();
  for (const e of GROUP_PACK_ENTRIES) {
    if (seen.has(e.key)) p.push(`duplicate key ${e.key}`);
    seen.add(e.key);
    for (const m of validateCatalogEntry(e)) p.push(`${e.key}: ${m}`);
    if (!e.orgTypes.includes("grp"))
      p.push(`${e.key}: a Group Pack entry must list the grp org type`);
    if (e.reportsTo !== GROUP_DIRECTOR_ROLE)
      p.push(`${e.key}: group outputs report to the group director`);
    if (e.key.startsWith("group.") === false) p.push(`${e.key}: group keys start with group.`);
  }
  for (const e of GROUP_PACK_ENTRIES) {
    if (e.aggregateOnly && e.dataClasses.some((d) => !d.startsWith("aggregate_"))) {
      p.push(`${e.key}: an aggregate-only entry may declare only aggregate data classes`);
    }
  }
  return p;
}
