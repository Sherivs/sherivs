/**
 * WF-15b3: the installable group workflows that need no campus feature (ADR-160).
 *
 * Three templates, each triggered by a GRP-01 group event (ADR-154): the weekly roll-up (`schedule.weekly`), the
 * campus KPI alert (`group.kpi_below_threshold`) and the month-end finance close (`schedule.month_end`).
 *
 * Design rules, all enforced by `validateGroupWorkflowPack`:
 * - A group message never carries a number, a name or a campus identifier. The event payload holds none, and the
 *   message only tells the group director that a summary is ready. The director opens the group view, where
 *   `org_group_aggregate` applies the small-number rule (counts of 1 to 4 are suppressed, and so is the total when any
 *   campus row is suppressed). So no step here reads campus data and no new action kind is needed.
 * - Every step is a draft in the group director's own inbox (an in-app message), approved before it is delivered.
 * - The month-end close adds a human approval step held by the group director, with a passkey step-up (ADR-138)
 *   declared on the catalog entry.
 * - The three transfer and fee-edit workflows stay blocked: they need campus features that do not exist yet.
 *
 * Pure data and validation. No I/O, no clock. Nothing is installed or enabled here.
 */
import type { WorkflowStep } from "../../../workflow/workflow-contract";
import { messageVariables } from "./fee-message-registry";
import {
  validatePackTemplate,
  type PackRegistryEntry,
  type PackTemplate,
  type PackTemplateMeta,
  type PackValidation,
} from "./private-school-pack";

/** The role a group director holds. The tenant maps it to the people who may approve for the group. */
export const GROUP_DIRECTOR_ROLE = "group_director";

export interface GroupRegistryMessage extends PackRegistryEntry {
  channel: "in_app";
  audience: "director";
}

/** Variables a group message may use. All come from the event payload; none identify a person or a campus. */
export const GROUP_MESSAGE_VARIABLES: readonly string[] = [
  "week",
  "month",
  "campuses",
  "metric",
  "threshold",
];

export const GROUP_MESSAGE_REGISTRY: Readonly<Record<string, GroupRegistryMessage>> = Object.freeze(
  {
    "grp.weekly.digest": {
      channel: "in_app",
      audience: "director",
      body: "Your group summary for {{week}} is ready across {{campuses}} campuses. Open the group view to read it.",
    },
    "grp.kpi.alert": {
      channel: "in_app",
      audience: "director",
      body: "A campus fell below the {{metric}} threshold of {{threshold}}. Open the group view to see which one.",
    },
    "grp.month_end.closed": {
      channel: "in_app",
      audience: "director",
      body: "The group close for {{month}} was approved across {{campuses}} campuses.",
    },
  },
);

const WEEK_PARAMS = { week: "payload.week", campuses: "payload.campuses" } as const;
const MONTH_PARAMS = { month: "payload.month", campuses: "payload.campuses" } as const;
const KPI_PARAMS = {
  campus_org: "payload.campus_org",
  metric: "payload.metric",
  threshold: "payload.threshold",
} as const;

const directorNote = (
  stepId: string,
  templateRef: string,
  params: Record<string, string>,
  next?: string,
): WorkflowStep => ({
  stepId,
  kind: "action",
  assignment: { kind: "unassigned" },
  actionClass: "communication",
  action: {
    kind: "in_app",
    templateRef,
    templateParams: params,
    recipientIds: [],
    dataClass: "internal",
  },
  authorizedActions: ["in_app"],
  ...(next ? { nextStepId: next } : {}),
});

const groupMeta = (
  ref: string,
  steps: PackTemplateMeta["stepAutonomy"],
  note: string,
  cases: PackTemplateMeta["evalSuite"]["cases"],
): PackTemplateMeta => ({
  agentRef: null,
  actors: ["engine", "group_director"],
  stepAutonomy: steps,
  lawfulBasis: [
    {
      purpose: "Tell the group director that an aggregate summary is ready",
      basis: "legitimate_interest",
      involvesMinorData: false,
    },
  ],
  evalSuite: {
    ref,
    cases: [
      { id: "no-send-without-approval", expect: "the note stays a draft until approved" },
      {
        id: "no-individual-data",
        expect:
          "the message holds no count, name or campus identifier; only the event keys are bound",
      },
      ...cases,
    ],
  },
  shadowDefault: true,
  blockedUntil: [],
  changelog: [{ version: 1, note }],
});

export const GRP_WEEKLY_ROLLUP: PackTemplate = {
  templateKey: "group_weekly_rollup",
  version: 1,
  name: "Group weekly roll-up",
  description:
    "Every Monday morning: one in-app note to the group director that the weekly summary is ready. The director reads the numbers in the group view, where small counts are suppressed.",
  definition: {
    trigger: { kind: "event", eventType: "schedule.weekly" },
    steps: [directorNote("digest", "grp.weekly.digest", WEEK_PARAMS)],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: groupMeta(
    "group_weekly_rollup_eval_v1",
    { digest: "draft" },
    "First version: weekly pointer to the group view (WF-15b3, ADR-160).",
    [{ id: "one-note-a-week", expect: "one run per group per ISO week, and a single step" }],
  ),
};

export const GRP_KPI_BREACH_ALERT: PackTemplate = {
  templateKey: "group_kpi_breach_alert",
  version: 1,
  name: "Campus KPI breach alert",
  description:
    "When a campus count falls below the threshold the group set: one in-app note to the group director. The note names the metric and the threshold, never the campus or a count.",
  definition: {
    trigger: { kind: "event", eventType: "group.kpi_below_threshold" },
    steps: [directorNote("alert", "grp.kpi.alert", KPI_PARAMS)],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: groupMeta(
    "group_kpi_breach_alert_eval_v1",
    { alert: "draft" },
    "First version: threshold alert with no campus name or count (WF-15b3, ADR-160).",
    [
      {
        id: "no-campus-in-message",
        expect: "the campus id is bound to the run for the deep link, never to the text",
      },
    ],
  ),
};

export const GRP_FINANCE_CLOSE: PackTemplate = {
  templateKey: "group_finance_close",
  version: 1,
  name: "Group consolidated finance close",
  description:
    "At month end: the group director approves the consolidated close pack, with a passkey step-up, and then a confirmation note is drafted. No amount travels in the event or the note.",
  definition: {
    trigger: { kind: "event", eventType: "schedule.month_end" },
    steps: [
      {
        stepId: "close_pack",
        kind: "approval",
        assignment: { kind: "human", roleRef: GROUP_DIRECTOR_ROLE },
        authorizedActions: [],
        nextStepId: "close_note",
      },
      directorNote("close_note", "grp.month_end.closed", MONTH_PARAMS),
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [{ stepId: "close_pack", approverRoleRef: GROUP_DIRECTOR_ROLE }],
  },
  meta: groupMeta(
    "group_finance_close_eval_v1",
    { close_note: "draft" },
    "First version: director approval of the month-end close pack (WF-15b3, ADR-160).",
    [
      {
        id: "approval-first",
        expect: "the confirmation note is not created before the director approves",
      },
      {
        id: "step-up-on-approval",
        expect: "approving needs a fresh passkey step-up; rejecting does not",
      },
    ],
  ),
};

export const GROUP_WORKFLOW_PACK_V1 = Object.freeze({
  packKey: "group",
  version: 1,
  status: "proposed" as const,
  templates: Object.freeze([GRP_WEEKLY_ROLLUP, GRP_KPI_BREACH_ALERT, GRP_FINANCE_CLOSE]),
});

/** A group message names no number, and every variable comes from the allowed list. */
export function validateGroupWorkflowPack(): PackValidation {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const [ref, m] of Object.entries(GROUP_MESSAGE_REGISTRY)) {
    for (const v of messageVariables(m.body))
      if (!GROUP_MESSAGE_VARIABLES.includes(v)) errors.push(`${ref}: variable ${v} is not allowed`);
    if (/\d/.test(m.body)) errors.push(`${ref}: a group message holds no digits`);
  }
  for (const t of GROUP_WORKFLOW_PACK_V1.templates) {
    if (keys.has(t.templateKey)) errors.push(`duplicate ${t.templateKey}`);
    keys.add(t.templateKey);
    const r = validatePackTemplate(t, GROUP_MESSAGE_REGISTRY);
    if (!r.ok) errors.push(...r.errors.map((e) => `${t.templateKey}: ${e}`));
    for (const s of t.definition.steps) {
      if (s.kind === "action" && s.action && s.action.kind !== "in_app")
        errors.push(`${t.templateKey}/${s.stepId}: group templates send in-app only`);
      if (
        s.kind === "approval" &&
        s.assignment.kind === "human" &&
        s.assignment.roleRef !== GROUP_DIRECTOR_ROLE
      )
        errors.push(`${t.templateKey}/${s.stepId}: the group director approves`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Row shape for `wf_template`. Install stays a service-role, founder-approved step. */
export function groupTemplateToCatalogRow(t: PackTemplate) {
  return {
    template_key: t.templateKey,
    version: t.version,
    name: t.name,
    description: t.description,
    graph: {
      trigger: t.definition.trigger,
      steps: t.definition.steps,
      onFailure: t.definition.onFailure,
      requiredApprovals: t.definition.requiredApprovals,
      pack: {
        key: GROUP_WORKFLOW_PACK_V1.packKey,
        version: GROUP_WORKFLOW_PACK_V1.version,
        status: GROUP_WORKFLOW_PACK_V1.status,
      },
      meta: t.meta,
    },
  };
}
