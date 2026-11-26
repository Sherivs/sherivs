/**
 * WF-15a: Private School Pack v1, the first three templates (fee ladder, payment receipt,
 * absence alert; founder decision 1 is PROPOSED, not ratified).
 *
 * Pure data and validation. No I/O, no clock, nothing is installed or enabled here.
 * Domain vocabulary lives in this scholar runtime namespace on purpose: universal migrations and
 * universal lib files must stay domain-neutral (scripts/verify-domain-neutrality.mjs).
 *
 * Rules every template here must satisfy (enforced by `validatePrivateSchoolPack`):
 * - trigger is one of the WF-05 event sources and only reads that event's payload keys;
 * - only email, in_app, sms, whatsapp, task and wait actions (decision D-02: BulkSMS Nigeria and the official WhatsApp
 *   API; no webhook). Every message reference must resolve in the message registry, and a WhatsApp template whose
 *   Meta approval is not recorded keeps the pack template blocked from going live (`meta-templates-approved`);
 * - every customer-visible action is declared at `draft` autonomy and is therefore approved by a
 *   human through the WF-07 inbox before anything can leave (WF-06/WF-07/AIN-02 enforce this in
 *   the engine; the pack declares it so an installer cannot widen it);
 * - lawful basis is declared per purpose, and any template touching a minor's data is blocked from
 *   going live until decision 7 (NDPA for minors) is answered;
 * - every template starts in shadow mode and ships an evaluation suite.
 */
import {
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowStep,
} from "../../../workflow/workflow-contract";
import {
  FEE_MESSAGE_REGISTRY,
  messageVariables,
  type RegistryMessage,
} from "./fee-message-registry";
import {
  workflowActionDefinitionIsValid,
  type WorkflowAutonomyLevel,
} from "../../../workflow/workflow-actions";

/** Payload keys per WF-05 event source (ADR-111). A template may only bind these. */
export const WF05_EVENT_PAYLOAD_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "fees.invoice_issued": ["amount_kobo", "invoice_id"],
  // WF-15a2 (ADR-136): due-date-relative reminder events; one event type per message class.
  "fees.reminder_week_start": ["amount_kobo", "due_at", "invoice_id", "offset_days"],
  "fees.reminder_week_end": ["amount_kobo", "due_at", "invoice_id", "offset_days"],
  "fees.reminder_due_day": ["amount_kobo", "due_at", "invoice_id", "offset_days"],
  "fees.reminder_overdue": ["amount_kobo", "due_at", "invoice_id", "offset_days"],
  "fees.reminder_escalation": ["amount_kobo", "due_at", "invoice_id", "offset_days"],
  "payment.succeeded": ["amount_kobo", "invoice_id", "method", "payment_id"],
  "wallet.topup_succeeded": ["amount_minor", "ledger_id"],
  "wallet.low_balance": ["alert_id", "kind"],
  "attendance.marked_absent": ["attendance_id", "status"],
  "admissions.stage_changed": ["application_id", "from_stage", "to_stage"],
  "results.published": ["grades_id"],
});

/** Abstract approver label; the tenant maps it to holders of `workflows.approve` (decision 4). */
export const PACK_APPROVER_ROLE = "workflow_approver";

export const PACK_ALLOWED_ACTION_KINDS = [
  "email",
  "in_app",
  "sms",
  "whatsapp",
  "task",
  "wait",
] as const;
const CUSTOMER_VISIBLE_KINDS = new Set(["email", "in_app", "whatsapp", "sms", "webhook"]);

export interface PackLawfulBasis {
  purpose: string;
  /** `pending_decision_7` means counsel has not yet chosen a basis. It blocks going live. */
  basis: "contract" | "legitimate_interest" | "legal_obligation" | "consent" | "pending_decision_7";
  involvesMinorData: boolean;
}

export interface PackEvalCase {
  id: string;
  /** What must hold. Evaluated by the AIN-04 suite runner once a tenant installs the template. */
  expect: string;
}

export interface PackTemplateMeta {
  agentRef: string | null;
  actors: readonly string[];
  /** Declared autonomy per step id; customer-visible steps must be `draft`. */
  stepAutonomy: Readonly<Record<string, WorkflowAutonomyLevel>>;
  lawfulBasis: readonly PackLawfulBasis[];
  evalSuite: { ref: string; cases: readonly PackEvalCase[] };
  shadowDefault: true;
  /** Decisions that must be answered before a tenant may turn the template live. */
  blockedUntil: readonly string[];
  changelog: readonly { version: number; note: string }[];
}

export interface PackTemplate {
  templateKey: string;
  version: number;
  name: string;
  description: string;
  definition: Omit<WorkflowDefinition, "tenantRef" | "definitionId" | "version" | "name">;
  meta: PackTemplateMeta;
}

const email = (
  stepId: string,
  templateRef: string,
  next: string | undefined,
  params: Record<string, string>,
  dataClass: string,
): WorkflowStep => ({
  stepId,
  kind: "action",
  assignment: { kind: "unassigned" },
  actionClass: "communication",
  action: { kind: "email", templateRef, templateParams: params, recipientIds: [], dataClass },
  authorizedActions: ["email"],
  ...(next ? { nextStepId: next } : {}),
});
const wait = (stepId: string, seconds: number, next: string): WorkflowStep => ({
  stepId,
  kind: "action",
  assignment: { kind: "unassigned" },
  actionClass: "wait",
  action: { kind: "wait", templateParams: { duration_seconds: seconds }, recipientIds: [] },
  authorizedActions: ["wait"],
  nextStepId: next,
});
const task = (stepId: string, templateRef: string, role: string): WorkflowStep => ({
  stepId,
  kind: "action",
  assignment: { kind: "human", roleRef: role },
  actionClass: "task",
  action: { kind: "task", templateRef, templateParams: {}, recipientIds: [] },
  authorizedActions: ["task"],
});
const DAY = 86_400;

const FEE_PARAMS = {
  invoice_id: "payload.invoice_id",
  amount_kobo: "payload.amount_kobo",
} as const;
const REMINDER_PARAMS = {
  invoice_id: "payload.invoice_id",
  amount_kobo: "payload.amount_kobo",
  due_at: "payload.due_at",
  offset_days: "payload.offset_days",
} as const;

const msg = (
  kind: "email" | "in_app" | "sms" | "whatsapp",
  stepId: string,
  templateRef: string,
  next: string | undefined,
  params: Record<string, string>,
  dataClass: string,
): WorkflowStep => ({
  stepId,
  kind: "action",
  assignment: { kind: "unassigned" },
  actionClass: "communication",
  action: { kind, templateRef, templateParams: params, recipientIds: [], dataClass },
  authorizedActions: [kind],
  ...(next ? { nextStepId: next } : {}),
});

export const PS_FEE_LADDER: PackTemplate = {
  templateKey: "ps_fee_ladder",
  version: 2,
  name: "Fee invoice notice",
  description:
    "When a fee invoice is issued: one notice to the payer, drafted for approval. Reminders now follow the due date (the five ps_fee_* reminder templates), not the issue date.",
  definition: {
    trigger: { kind: "event", eventType: "fees.invoice_issued" },
    steps: [msg("email", "notice", "ps.fee.invoice_notice", undefined, FEE_PARAMS, "confidential")],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: {
    agentRef: null,
    actors: ["engine"],
    stepAutonomy: { notice: "draft" },
    lawfulBasis: [
      { purpose: "Notify the payer of an issued fee", basis: "contract", involvesMinorData: false },
    ],
    evalSuite: {
      ref: "ps_fee_ladder_eval_v2",
      cases: [
        {
          id: "no-send-without-approval",
          expect: "no message leaves while the notice is an unapproved draft",
        },
        {
          id: "payload-keys-only",
          expect: "only invoice_id and amount_kobo are bound from the event",
        },
        { id: "one-message", expect: "the graph holds a single notice and no reminder rungs" },
      ],
    },
    shadowDefault: true,
    blockedUntil: [],
    changelog: [
      { version: 1, note: "First version: email only, issue-date ladder with 7-day waits." },
      {
        version: 2,
        note: "Reminders moved to due-date-relative templates (ADR-136); this template now sends the issue notice only.",
      },
    ],
  },
};

const reminderMeta = (
  ref: string,
  steps: Record<string, WorkflowAutonomyLevel>,
  blockedUntil: readonly string[],
  expectOrder: string,
): PackTemplateMeta => ({
  agentRef: null,
  actors: ["engine", "bursar"],
  stepAutonomy: steps,
  lawfulBasis: [
    {
      purpose: "Remind the payer of a fee that is due or overdue",
      basis: "contract",
      involvesMinorData: false,
    },
  ],
  evalSuite: {
    ref,
    cases: [
      {
        id: "no-send-without-approval",
        expect: "no message leaves while a step is an unapproved draft",
      },
      {
        id: "payload-keys-only",
        expect: "only invoice_id, amount_kobo, due_at and offset_days are bound",
      },
      { id: "stop-on-payment", expect: "a fully paid invoice ends the run and cancels its drafts" },
      { id: "channel-order", expect: expectOrder },
    ],
  },
  shadowDefault: true,
  blockedUntil,
  changelog: [{ version: 1, note: "First version: due-date-relative reminder (ADR-136)." }],
});

const META_GATE = ["meta-templates-approved"] as const;

export const PS_FEE_WEEK_START: PackTemplate = {
  templateKey: "ps_fee_week_start",
  version: 1,
  name: "Fee reminder, first day of the week",
  description:
    "On the first school day of each of the four weeks before the due date: an SMS and a push notification to the payer, each drafted for approval.",
  definition: {
    trigger: { kind: "event", eventType: "fees.reminder_week_start" },
    steps: [
      msg("sms", "sms", "ps.fee.week_start.sms", "push", REMINDER_PARAMS, "confidential"),
      msg("in_app", "push", "ps.fee.week_start.push", undefined, REMINDER_PARAMS, "confidential"),
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: reminderMeta(
    "ps_fee_week_start_eval_v1",
    { sms: "draft", push: "draft" },
    [],
    "sms then push; no whatsapp, no email",
  ),
};

export const PS_FEE_WEEK_END: PackTemplate = {
  templateKey: "ps_fee_week_end",
  version: 1,
  name: "Fee reminder, last day of the week",
  description:
    "On the last school day of each of the four weeks before the due date: a push notification only, drafted for approval.",
  definition: {
    trigger: { kind: "event", eventType: "fees.reminder_week_end" },
    steps: [
      msg("in_app", "push", "ps.fee.week_end.push", undefined, REMINDER_PARAMS, "confidential"),
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: reminderMeta(
    "ps_fee_week_end_eval_v1",
    { push: "draft" },
    [],
    "push only; no sms, no whatsapp",
  ),
};

export const PS_FEE_DUE_DAY: PackTemplate = {
  templateKey: "ps_fee_due_day",
  version: 1,
  name: "Fee due today",
  description:
    "On the due date: WhatsApp, SMS and push to the payer, each drafted for approval. Voice calls are added once a provider is chosen.",
  definition: {
    trigger: { kind: "event", eventType: "fees.reminder_due_day" },
    steps: [
      msg(
        "whatsapp",
        "whatsapp",
        "ps.fee.due_day.whatsapp",
        "sms",
        REMINDER_PARAMS,
        "confidential",
      ),
      msg("sms", "sms", "ps.fee.due_day.sms", "push", REMINDER_PARAMS, "confidential"),
      msg("in_app", "push", "ps.fee.due_day.push", undefined, REMINDER_PARAMS, "confidential"),
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: reminderMeta(
    "ps_fee_due_day_eval_v1",
    { whatsapp: "draft", sms: "draft", push: "draft" },
    META_GATE,
    "whatsapp, then sms, then push",
  ),
};

export const PS_FEE_OVERDUE: PackTemplate = {
  templateKey: "ps_fee_overdue",
  version: 1,
  name: "Fee overdue, weekly",
  description:
    "Every week after the due date, up to twelve weeks: WhatsApp, SMS and push to the payer, each drafted for approval, until the invoice is paid.",
  definition: {
    trigger: { kind: "event", eventType: "fees.reminder_overdue" },
    steps: [
      msg(
        "whatsapp",
        "whatsapp",
        "ps.fee.overdue.whatsapp",
        "sms",
        REMINDER_PARAMS,
        "confidential",
      ),
      msg("sms", "sms", "ps.fee.overdue.sms", "push", REMINDER_PARAMS, "confidential"),
      msg("in_app", "push", "ps.fee.overdue.push", undefined, REMINDER_PARAMS, "confidential"),
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: reminderMeta(
    "ps_fee_overdue_eval_v1",
    { whatsapp: "draft", sms: "draft", push: "draft" },
    META_GATE,
    "whatsapp, then sms, then push; at most twelve weekly events per invoice",
  ),
};

export const PS_FEE_ESCALATION: PackTemplate = {
  templateKey: "ps_fee_escalation",
  version: 1,
  name: "Fee four weeks overdue: bursar task",
  description:
    "Four weeks after the due date: one task for the bursar to contact the payer. No message is sent.",
  definition: {
    trigger: { kind: "event", eventType: "fees.reminder_escalation" },
    steps: [task("bursar_task", "ps.fee.review_unpaid", "bursar")],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: reminderMeta(
    "ps_fee_escalation_eval_v1",
    { bursar_task: "act_and_report" },
    [],
    "a task for the bursar and nothing else",
  ),
};

export const PS_PAYMENT_RECEIPT: PackTemplate = {
  templateKey: "ps_payment_receipt",
  version: 1,
  name: "Payment receipt",
  description:
    "When a fee payment is recorded: a receipt message drafted for approval and an in-app note for the bursar.",
  definition: {
    trigger: { kind: "event", eventType: "payment.succeeded" },
    steps: [
      email(
        "receipt",
        "ps.payment.receipt",
        "bursar_note",
        {
          payment_id: "payload.payment_id",
          invoice_id: "payload.invoice_id",
          amount_kobo: "payload.amount_kobo",
          method: "payload.method",
        },
        "confidential",
      ),
      {
        stepId: "bursar_note",
        kind: "action",
        assignment: { kind: "unassigned" },
        actionClass: "internal",
        action: {
          kind: "in_app",
          templateRef: "ps.payment.recorded",
          templateParams: { payment_id: "payload.payment_id" },
          recipientIds: [],
          dataClass: "internal",
        },
        authorizedActions: ["in_app"],
      },
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: {
    agentRef: null,
    actors: ["engine", "bursar"],
    stepAutonomy: { receipt: "draft", bursar_note: "act_and_report" },
    lawfulBasis: [
      {
        purpose: "Confirm receipt of a payment to the payer",
        basis: "contract",
        involvesMinorData: false,
      },
    ],
    evalSuite: {
      ref: "ps_payment_receipt_eval_v1",
      cases: [
        { id: "no-send-without-approval", expect: "receipt stays a draft until approved" },
        {
          id: "payload-keys-only",
          expect: "only payment_id, invoice_id, amount_kobo, method are bound",
        },
        { id: "no-money-movement", expect: "the graph moves no money and issues no refund" },
      ],
    },
    shadowDefault: true,
    blockedUntil: [],
    changelog: [{ version: 1, note: "First version: receipt draft plus bursar in-app note." }],
  },
};

export const PS_ABSENCE_ALERT: PackTemplate = {
  templateKey: "ps_absence_alert",
  version: 1,
  name: "Absence alert to guardian",
  description:
    "When a learner is marked absent: a message to the guardian drafted for approval and a follow-up task for the class teacher. Cannot go live until the minors decision is answered.",
  definition: {
    trigger: { kind: "event", eventType: "attendance.marked_absent" },
    steps: [
      {
        stepId: "is_absent",
        kind: "condition",
        assignment: { kind: "unassigned" },
        authorizedActions: [],
        condition: { field: "payload.status", operator: "equals", value: "absent" },
        branches: { onTrueStepId: "guardian_alert", onFalseStepId: null },
      },
      email(
        "guardian_alert",
        "ps.absence.guardian_alert",
        "teacher_follow_up",
        { attendance_id: "payload.attendance_id" },
        "minor_sensitive",
      ),
      task("teacher_follow_up", "ps.absence.follow_up", "class_teacher"),
    ],
    onFailure: { kind: "halt" },
    requiredApprovals: [],
  },
  meta: {
    agentRef: null,
    actors: ["engine", "class_teacher"],
    stepAutonomy: {
      is_absent: "act_and_report",
      guardian_alert: "draft",
      teacher_follow_up: "act_and_report",
    },
    lawfulBasis: [
      {
        purpose: "Tell a guardian their child was marked absent",
        basis: "pending_decision_7",
        involvesMinorData: true,
      },
    ],
    evalSuite: {
      ref: "ps_absence_alert_eval_v1",
      cases: [
        {
          id: "no-send-without-approval",
          expect: "the guardian message stays a draft until approved",
        },
        { id: "only-absent", expect: "a status other than absent ends the run with no message" },
        { id: "minor-data-class", expect: "the guardian message is classed minor_sensitive" },
        {
          id: "blocked-until-decision-7",
          expect: "the template cannot be turned live while decision 7 is open",
        },
      ],
    },
    shadowDefault: true,
    blockedUntil: ["decision-7"],
    changelog: [{ version: 1, note: "First version: guardian draft plus teacher follow-up task." }],
  },
};

export const PRIVATE_SCHOOL_PACK_V1 = Object.freeze({
  packKey: "private-school",
  version: 2,
  status: "proposed" as const,
  templates: Object.freeze([
    PS_FEE_LADDER,
    PS_FEE_WEEK_START,
    PS_FEE_WEEK_END,
    PS_FEE_DUE_DAY,
    PS_FEE_OVERDUE,
    PS_FEE_ESCALATION,
    PS_PAYMENT_RECEIPT,
    PS_ABSENCE_ALERT,
  ]),
});

export type PackValidation = { ok: true } | { ok: false; errors: string[] };

const RANK: Record<WorkflowAutonomyLevel, number> = {
  suggest: 0,
  draft: 1,
  act_with_approval: 2,
  act_and_report: 3,
};

export function validatePackTemplate(t: PackTemplate): PackValidation {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9_-]{1,62}$/.test(t.templateKey)) errors.push("bad templateKey");
  if (!Number.isInteger(t.version) || t.version < 1) errors.push("bad version");
  const def: WorkflowDefinition = {
    ...t.definition,
    tenantRef: "template" as never,
    definitionId: t.templateKey,
    version: String(t.version),
    name: t.name,
  };
  const v = validateWorkflowDefinition(def);
  if (!v.ok) errors.push(`definition: ${v.error}`);

  const trig = t.definition.trigger;
  const allowedKeys = trig.kind === "event" ? WF05_EVENT_PAYLOAD_KEYS[trig.eventType] : undefined;
  if (!allowedKeys) errors.push("trigger must be a WF-05 event source");

  for (const s of t.definition.steps) {
    const a = s.action;
    if (!a) continue;
    if (!(PACK_ALLOWED_ACTION_KINDS as readonly string[]).includes(a.kind))
      errors.push(`${s.stepId}: action kind ${a.kind} not allowed in v1`);
    if (!workflowActionDefinitionIsValid(a)) errors.push(`${s.stepId}: invalid action definition`);
    if (a.templateRef) {
      const entry: RegistryMessage | undefined = FEE_MESSAGE_REGISTRY[a.templateRef];
      if (!entry) errors.push(`${s.stepId}: ${a.templateRef} is not in the message registry`);
      else {
        if (entry.channel !== a.kind)
          errors.push(`${s.stepId}: registry channel ${entry.channel} differs from ${a.kind}`);
        if (
          a.kind === "whatsapp" &&
          entry.whatsapp?.status !== "approved" &&
          !t.meta.blockedUntil.includes("meta-templates-approved")
        )
          errors.push(
            `${s.stepId}: an unapproved WhatsApp template needs blockedUntil meta-templates-approved`,
          );
        const pay = messageVariables(entry.body).includes("pay_link");
        if (a.kind === "sms" && !pay) errors.push(`${s.stepId}: sms must carry the pay link`);
      }
    }
    for (const value of Object.values(a.templateParams ?? {})) {
      if (typeof value === "string" && value.startsWith("payload.")) {
        const key = value.slice("payload.".length);
        if (!allowedKeys?.includes(key))
          errors.push(`${s.stepId}: binds payload.${key}, not an event key`);
      }
    }
    const declared = t.meta.stepAutonomy[s.stepId];
    if (!declared) errors.push(`${s.stepId}: no declared autonomy`);
    if (CUSTOMER_VISIBLE_KINDS.has(a.kind) && a.dataClass !== "internal" && declared !== "draft")
      errors.push(`${s.stepId}: customer-visible step must be draft`);
    if (CUSTOMER_VISIBLE_KINDS.has(a.kind) && !a.dataClass)
      errors.push(`${s.stepId}: customer-visible step needs a data class`);
    if (declared && RANK[declared] > 1 && a.dataClass === "minor_sensitive")
      errors.push(`${s.stepId}: minor data above draft`);
  }
  if (!t.meta.shadowDefault) errors.push("must start in shadow mode");
  if (t.meta.lawfulBasis.length === 0) errors.push("lawful basis required");
  if (t.meta.evalSuite.cases.length < 3) errors.push("evaluation suite needs at least 3 cases");
  const touchesMinors = t.meta.lawfulBasis.some(
    (b) => b.involvesMinorData || b.basis === "pending_decision_7",
  );
  if (touchesMinors && !t.meta.blockedUntil.includes("decision-7"))
    errors.push("minor data needs blockedUntil decision-7");
  if (!t.meta.changelog.some((c) => c.version === t.version))
    errors.push("changelog entry for this version missing");
  return errors.length ? { ok: false, errors } : { ok: true };
}

export function validatePrivateSchoolPack(): PackValidation {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const t of PRIVATE_SCHOOL_PACK_V1.templates) {
    if (keys.has(t.templateKey)) errors.push(`duplicate ${t.templateKey}`);
    keys.add(t.templateKey);
    const r = validatePackTemplate(t);
    if (!r.ok) errors.push(...r.errors.map((e) => `${t.templateKey}: ${e}`));
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** Row shape for `wf_template` (WF-02). Install is a service-role, founder-approved action. */
export function packTemplateToCatalogRow(t: PackTemplate) {
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
        key: PRIVATE_SCHOOL_PACK_V1.packKey,
        version: PRIVATE_SCHOOL_PACK_V1.version,
        status: PRIVATE_SCHOOL_PACK_V1.status,
      },
      meta: t.meta,
    },
  };
}

/**
 * SQL used by the local integration harness (tests/integration/wf15a-pack-install.local.sql) to
 * install the pack rows into a disposable database. It is not a migration and is never applied to
 * a hosted database by this mission; production install is a separate founder-approved step.
 */
export function packInsertSql(): string {
  const rows = PRIVATE_SCHOOL_PACK_V1.templates.map((t) => {
    const r = packTemplateToCatalogRow(t);
    const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
    return `(${q(r.template_key)}, ${r.version}, ${q(r.name)}, ${q(r.description)}, ${q(JSON.stringify(r.graph))}::jsonb)`;
  });
  return `INSERT INTO public.wf_template (template_key, version, name, description, graph) VALUES\n  ${rows.join(",\n  ")};`;
}
