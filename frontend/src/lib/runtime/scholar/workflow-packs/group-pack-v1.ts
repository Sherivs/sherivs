/**
 * WF-15b2: Group Pack v1, the fourteen V1 templates in the full blueprint schema (ADR-143).
 *
 * Eight are reused unchanged from the Private School Pack and are `built`; they run inside each campus organisation.
 * Six are group-level workflows that run in the group organisation, read aggregates only through the group
 * aggregate layer, and report to the group director. Those six stay `needs_event_source` until GRP-01 and the
 * schedule events exist, so this file never claims they can run.
 *
 * Titles in ha, yo, ig and pcm are drafts for native-speaker review; nothing here is sent anywhere.
 */
import { PRIVATE_SCHOOL_PACK_V1 } from "./private-school-pack";
import {
  validateRichEntry,
  type CatalogStepSummary,
  type RichCatalogEntry,
} from "./workflow-catalog";

export const CAMPUS_HEAD_ROLE = "school_head";
export const GROUP_DIRECTOR = "group_director";

type Titles = RichCatalogEntry["title"];
const T = (en: string, ha: string, yo: string, ig: string, pcm: string): Titles => ({
  en,
  ha,
  yo,
  ig,
  pcm,
});

const common = {
  version: "1.0.0",
  release: "v1",
  minPlan: null,
  orgTypes: ["pri", "grp"],
  changelog: "1.0.0: Group Pack v1 (WF-15b2)",
  translationStatus: "draft_needs_native_review",
} as const;

const campus = (
  key: string,
  title: Titles,
  trigger: string,
  steps: CatalogStepSummary[],
  params: Record<string, string>,
  extra: Partial<RichCatalogEntry> = {},
): RichCatalogEntry => ({
  ...common,
  key: `group.campus.${key.replace(/^ps_/, "")}`,
  title,
  riskTier: "low",
  agent: "Tally",
  autonomyMax: "draft",
  regulator: null,
  trigger: { event: trigger },
  params,
  steps,
  approvals: [],
  dataClasses: ["fee_balance"],
  lawfulBasis: "contract",
  evalSuite: `${key}_eval`,
  evalCases: [
    {
      id: "no-send-without-approval",
      expect: "nothing leaves while a step is an unapproved draft",
    },
    { id: "payload-keys-only", expect: "only the declared event payload keys are bound" },
    { id: "campus-isolation", expect: "the run reads only its own campus organisation" },
  ],
  buildState: "built",
  reportsTo: CAMPUS_HEAD_ROLE,
  aggregateOnly: false,
  sourceTemplateKey: key,
  ...extra,
});

const vis = (id: string, channel: CatalogStepSummary["channel"]): CatalogStepSummary => ({
  id,
  kind: "action",
  channel,
  autonomy: "draft",
  approverRole: "workflow_approver",
});
const REM = {
  invoice_id: "payload.invoice_id",
  amount_kobo: "payload.amount_kobo",
  due_at: "payload.due_at",
  offset_days: "payload.offset_days",
};

const REUSED: RichCatalogEntry[] = [
  campus(
    "ps_fee_ladder",
    T(
      "Fee invoice notice",
      "Sanarwar kuɗin makaranta",
      "Ìkéde owó ilé-ẹ̀kọ́",
      "Ọkwa ụgwọ ụlọ akwụkwọ",
      "Notice for school fees",
    ),
    "fees.invoice_issued",
    [vis("notice", "email")],
    { invoice_id: "payload.invoice_id", amount_kobo: "payload.amount_kobo" },
  ),
  campus(
    "ps_fee_week_start",
    T(
      "Fee reminder: start of week",
      "Tunatarwa kan kuɗi: farkon mako",
      "Ìránnilétí owó: ìbẹ̀rẹ̀ ọ̀sẹ̀",
      "Ncheta ụgwọ: mmalite izu",
      "Reminder for school fees: start of week",
    ),
    "fees.reminder_week_start",
    [vis("sms", "sms"), vis("push", "push")],
    REM,
  ),
  campus(
    "ps_fee_week_end",
    T(
      "Fee reminder: end of week",
      "Tunatarwa kan kuɗi: ƙarshen mako",
      "Ìránnilétí owó: òpin ọ̀sẹ̀",
      "Ncheta ụgwọ: ngwụcha izu",
      "Reminder for school fees: end of week",
    ),
    "fees.reminder_week_end",
    [vis("push", "push")],
    REM,
  ),
  campus(
    "ps_fee_due_day",
    T(
      "Fee due today",
      "Kuɗin makaranta ya kamata yau",
      "Owó ilé-ẹ̀kọ́ tó yẹ lónìí",
      "Ụgwọ ụlọ akwụkwọ kwesịrị taa",
      "School fees dey due today",
    ),
    "fees.reminder_due_day",
    [vis("whatsapp", "whatsapp"), vis("sms", "sms"), vis("push", "push")],
    REM,
  ),
  campus(
    "ps_fee_overdue",
    T(
      "Fee overdue",
      "Kuɗin makaranta ya wuce lokaci",
      "Owó ilé-ẹ̀kọ́ ti kọjá àkókò",
      "Ụgwọ ụlọ akwụkwọ agafeela oge",
      "School fees don pass time",
    ),
    "fees.reminder_overdue",
    [vis("whatsapp", "whatsapp"), vis("sms", "sms"), vis("push", "push")],
    REM,
  ),
  campus(
    "ps_fee_escalation",
    T(
      "Fee four weeks overdue: bursar task",
      "Kuɗi sati huɗu ya wuce: aikin akawu",
      "Owó ọ̀sẹ̀ mẹ́rin ti kọjá: iṣẹ́ akápò",
      "Ụgwọ izu anọ agafeela: ọrụ onye nchekwa ego",
      "Fees four weeks overdue: bursar task",
    ),
    "fees.reminder_escalation",
    [{ id: "bursar_task", kind: "task", channel: "task", autonomy: "act_and_report" }],
    REM,
    { autonomyMax: "act_and_report" },
  ),
  campus(
    "ps_payment_receipt",
    T(
      "Payment receipt",
      "Rasit ɗin biyan kuɗi",
      "Ìwé-ẹ̀rí ìsanwó",
      "Akwụkwọ nnata ụgwọ",
      "Receipt for payment",
    ),
    "payment.succeeded",
    [
      vis("receipt", "email"),
      { id: "bursar_note", kind: "action", channel: "in_app", autonomy: "act_and_report" },
    ],
    {
      payment_id: "payload.payment_id",
      invoice_id: "payload.invoice_id",
      amount_kobo: "payload.amount_kobo",
      method: "payload.method",
    },
    {
      autonomyMax: "act_and_report",
      evalCases: [
        { id: "no-send-without-approval", expect: "receipt stays a draft until approved" },
        {
          id: "payload-keys-only",
          expect: "only payment_id, invoice_id, amount_kobo, method are bound",
        },
        { id: "no-money-movement", expect: "the graph moves no money and issues no refund" },
      ],
    },
  ),
  campus(
    "ps_absence_alert",
    T(
      "Absence alert to guardian",
      "Sanarwar rashin zuwa ga mai kula",
      "Ìkìlọ̀ àìsí sí alágbàtọ́",
      "Ọkwa enweghị ọbịbịa nye onye na-elekọta",
      "Alert to guardian say pikin no come school",
    ),
    "attendance.marked_absent",
    [
      { id: "is_absent", kind: "condition", autonomy: "suggest" },
      { ...vis("guardian_alert", "email") },
      { id: "teacher_follow_up", kind: "task", channel: "task", autonomy: "act_and_report" },
    ],
    { attendance_id: "payload.attendance_id", status: "payload.status" },
    {
      riskTier: "medium",
      autonomyMax: "act_and_report",
      dataClasses: ["learner_record", "guardian_contact"],
      lawfulBasis: "pending_decision_7",
      agent: "Roll",
    },
  ),
];

const grp = (
  key: string,
  title: Titles,
  o: Partial<RichCatalogEntry> &
    Pick<RichCatalogEntry, "agent" | "trigger" | "steps" | "dataClasses" | "params">,
): RichCatalogEntry => ({
  ...common,
  orgTypes: ["grp"],
  key,
  title,
  riskTier: "low",
  autonomyMax: "draft",
  regulator: null,
  approvals: [],
  lawfulBasis: "legitimate_interest",
  evalSuite: `${key.replace(".", "_")}_eval`,
  evalCases: [
    { id: "no-send-without-approval", expect: "the director's copy stays a draft until approved" },
    {
      id: "no-individual-data",
      expect: "the output holds counts and amounts only, never a named person",
    },
    { id: "small-number-rule", expect: "a count of 1 to 4 is suppressed in every campus row" },
    {
      id: "campus-isolation",
      expect: "no campus record is read or written; only the group aggregate layer is used",
    },
  ],
  buildState: "needs_event_source",
  reportsTo: GROUP_DIRECTOR,
  aggregateOnly: true,
  ...o,
});

const dir = (id: string): CatalogStepSummary => ({
  id,
  kind: "action",
  channel: "in_app",
  autonomy: "draft",
  approverRole: GROUP_DIRECTOR,
});
const agg = (id: string): CatalogStepSummary => ({ id, kind: "action", autonomy: "suggest" });

const GROUP: RichCatalogEntry[] = [
  grp(
    "group.weekly_rollup",
    T(
      "Group weekly roll-up",
      "Taƙaitaccen rahoton mako na rukuni",
      "Àkópọ̀ ọ̀sẹ̀ ẹgbẹ́ ilé-ẹ̀kọ́",
      "Nchịkọta izu nke otu ụlọ akwụkwọ",
      "Weekly summary for the group",
    ),
    {
      agent: "Brief",
      trigger: { event: "schedule.weekly" },
      steps: [agg("collect"), dir("digest")],
      dataClasses: ["aggregate_attendance", "aggregate_collections", "aggregate_incidents"],
      params: { window_days: 7, min_count: 5 },
    },
  ),
  grp(
    "group.kpi_breach_alert",
    T(
      "Campus KPI breach alert",
      "Faɗakarwa kan wani harabar da ya gaza",
      "Ìkìlọ̀ ibi tí ìwọ̀n ti wálẹ̀",
      "Ọkwa ogo ụlọ akwụkwọ dara",
      "Alert wen campus no meet target",
    ),
    {
      agent: "Compass",
      trigger: { event: "group.kpi_below_threshold" },
      steps: [agg("evaluate"), dir("alert")],
      dataClasses: ["aggregate_attendance", "aggregate_collections"],
      params: { attendance_floor_pct: 85, collections_floor_pct: 70, min_count: 5 },
    },
  ),
  grp(
    "group.finance_close",
    T(
      "Group consolidated finance close",
      "Rufe asusun rukuni gaba ɗaya",
      "Ìparí owó ẹgbẹ́ ilé-ẹ̀kọ́",
      "Mmechi ego nke otu ụlọ akwụkwọ",
      "Group money close for the month",
    ),
    {
      agent: "Ledger",
      riskTier: "high",
      trigger: { event: "schedule.month_end" },
      steps: [
        agg("consolidate"),
        {
          id: "close_pack",
          kind: "approval",
          channel: "in_app",
          autonomy: "draft",
          approverRole: GROUP_DIRECTOR,
        },
      ],
      approvals: [{ step: "close_pack", role: GROUP_DIRECTOR, stepUp: true }],
      dataClasses: ["aggregate_collections", "aggregate_arrears", "aggregate_payroll"],
      params: { period: "month", min_count: 5 },
    },
  ),
  grp(
    "group.fee_policy_rollout",
    T(
      "Group fee policy rollout",
      "Aiwatar da manufar kuɗin makaranta a rukuni",
      "Ìmúlò ìlànà owó ẹgbẹ́",
      "Ịmejuputa iwu ụgwọ otu ụlọ akwụkwọ",
      "Roll out new school fees policy",
    ),
    {
      agent: "Tally",
      riskTier: "high",
      trigger: { event: "fees.schedule_edited" },
      aggregateOnly: false,
      lawfulBasis: "contract",
      steps: [
        agg("diff"),
        {
          id: "approve_rollout",
          kind: "approval",
          channel: "in_app",
          autonomy: "draft",
          approverRole: GROUP_DIRECTOR,
        },
        {
          id: "propose_to_campuses",
          kind: "task",
          channel: "task",
          autonomy: "draft",
          approverRole: CAMPUS_HEAD_ROLE,
        },
      ],
      approvals: [{ step: "approve_rollout", role: GROUP_DIRECTOR, stepUp: true }],
      dataClasses: ["fee_schedule"],
      params: { effective_next_term: true },
      evalCases: [
        {
          id: "no-send-without-approval",
          expect: "no campus is changed until the director approves",
        },
        {
          id: "campus-consent",
          expect:
            "each campus head accepts or rejects; the group never edits a campus fee schedule directly",
        },
        { id: "no-retroactive-change", expect: "issued invoices are never altered" },
      ],
    },
  ),
  grp(
    "group.student_transfer",
    T(
      "Cross-campus student transfer",
      "Canja ɗalibi tsakanin harabar makaranta",
      "Ìgbéṣẹ̀ akẹ́kọ̀ọ́ láàrin ilé-ẹ̀kọ́",
      "Mbufe nwa akwụkwọ n'etiti ụlọ akwụkwọ",
      "Move student from one campus go another",
    ),
    {
      agent: "Roll",
      riskTier: "high",
      trigger: { event: "students.transfer_opened" },
      aggregateOnly: false,
      lawfulBasis: "contract",
      steps: [
        agg("check_balance"),
        {
          id: "sending_head_release",
          kind: "approval",
          channel: "in_app",
          autonomy: "draft",
          approverRole: CAMPUS_HEAD_ROLE,
        },
        {
          id: "receiving_head_accept",
          kind: "approval",
          channel: "in_app",
          autonomy: "draft",
          approverRole: CAMPUS_HEAD_ROLE,
        },
        vis("guardian_notice", "email"),
      ],
      approvals: [
        { step: "sending_head_release", role: CAMPUS_HEAD_ROLE, stepUp: true },
        { step: "receiving_head_accept", role: CAMPUS_HEAD_ROLE, stepUp: false },
      ],
      dataClasses: ["learner_record", "fee_balance", "guardian_contact"],
      params: { copy_records: "on_both_approvals" },
      evalCases: [
        {
          id: "no-send-without-approval",
          expect: "the guardian notice stays a draft until both heads approve",
        },
        {
          id: "two-heads",
          expect: "the sending and receiving heads are different people in different organisations",
        },
        {
          id: "no-record-copy-before-accept",
          expect: "no learner record is copied before the receiving head accepts",
        },
      ],
    },
  ),
  grp(
    "group.staff_transfer",
    T(
      "Group-wide staff transfer",
      "Canja ma'aikaci tsakanin harabar makaranta",
      "Ìgbéṣẹ̀ òṣìṣẹ́ láàrin ilé-ẹ̀kọ́",
      "Mbufe onye ọrụ n'etiti ụlọ akwụkwọ",
      "Move staff from one campus go another",
    ),
    {
      agent: "Roll",
      riskTier: "high",
      trigger: { event: "staff.transfer_proposed" },
      aggregateOnly: false,
      lawfulBasis: "contract",
      steps: [
        agg("check_roles"),
        {
          id: "group_director_approve",
          kind: "approval",
          channel: "in_app",
          autonomy: "draft",
          approverRole: GROUP_DIRECTOR,
        },
        {
          id: "grant_roles",
          kind: "task",
          channel: "task",
          autonomy: "draft",
          approverRole: CAMPUS_HEAD_ROLE,
        },
      ],
      approvals: [{ step: "group_director_approve", role: GROUP_DIRECTOR, stepUp: true }],
      dataClasses: ["staff_record", "payroll_record", "role_grant"],
      params: { revoke_old_roles: "on_effective_date" },
      evalCases: [
        { id: "no-self-grant", expect: "the proposer cannot approve their own transfer" },
        {
          id: "roles-draft-only",
          expect: "role grants are tasks for the receiving head, never applied by the agent",
        },
        { id: "payroll-not-moved", expect: "no payroll amount is changed by this workflow" },
      ],
    },
  ),
];

export const GROUP_PACK_V1: readonly RichCatalogEntry[] = [...REUSED, ...GROUP];

export function validateGroupPackV1(): string[] {
  const p: string[] = [];
  if (GROUP_PACK_V1.length !== 14)
    p.push(`the V1 Group Pack holds 14 templates, found ${GROUP_PACK_V1.length}`);
  const keys = new Set<string>();
  const privateKeys = PRIVATE_SCHOOL_PACK_V1.templates.map((t) => t.templateKey);
  for (const e of GROUP_PACK_V1) {
    if (keys.has(e.key)) p.push(`duplicate ${e.key}`);
    keys.add(e.key);
    for (const m of validateRichEntry(e)) p.push(`${e.key}: ${m}`);
    if (e.sourceTemplateKey && !privateKeys.includes(e.sourceTemplateKey))
      p.push(`${e.key}: source ${e.sourceTemplateKey} is not in the Private School Pack`);
    if (e.aggregateOnly && e.dataClasses.some((d) => !d.startsWith("aggregate_")))
      p.push(`${e.key}: aggregate-only entries declare only aggregate data classes`);
  }
  return p;
}
