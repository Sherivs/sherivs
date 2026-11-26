import { describe, expect, it } from "vitest";
import {
  FEE_MESSAGE_REGISTRY,
  messageVariables,
  renderSample,
  validateFeeMessageRegistry,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/fee-message-registry";
import {
  PRIVATE_SCHOOL_PACK_V1,
  PS_FEE_DUE_DAY,
  PS_FEE_ESCALATION,
  PS_FEE_OVERDUE,
  PS_FEE_WEEK_END,
  PS_FEE_WEEK_START,
  PS_ABSENCE_ALERT,
  PS_FEE_LADDER,
  packTemplateToCatalogRow,
  validatePackTemplate,
  validatePrivateSchoolPack,
  WF05_EVENT_PAYLOAD_KEYS,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/private-school-pack";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("WF-15a private school pack", () => {
  it("passes its own validation and holds the eight templates of pack version 2", () => {
    expect(validatePrivateSchoolPack()).toEqual({ ok: true });
    expect(PRIVATE_SCHOOL_PACK_V1.version).toBe(2);
    expect(PRIVATE_SCHOOL_PACK_V1.templates.map((t) => t.templateKey)).toEqual([
      "ps_fee_ladder",
      "ps_fee_week_start",
      "ps_fee_week_end",
      "ps_fee_due_day",
      "ps_fee_overdue",
      "ps_fee_escalation",
      "ps_payment_receipt",
      "ps_absence_alert",
    ]);
    expect(PRIVATE_SCHOOL_PACK_V1.status).toBe("proposed");
  });
  it("every template starts in shadow mode with a lawful basis and an eval suite", () => {
    for (const t of PRIVATE_SCHOOL_PACK_V1.templates) {
      expect(t.meta.shadowDefault).toBe(true);
      expect(t.meta.lawfulBasis.length).toBeGreaterThan(0);
      expect(t.meta.evalSuite.cases.length).toBeGreaterThanOrEqual(3);
    }
  });
  it("uses only email, in_app, sms, whatsapp, task and wait (never a webhook)", () => {
    for (const t of PRIVATE_SCHOOL_PACK_V1.templates)
      for (const s of t.definition.steps)
        if (s.action)
          expect(["email", "in_app", "sms", "whatsapp", "task", "wait"]).toContain(s.action.kind);
  });
  it("triggers are WF-05 sources and bind only payload keys the event carries", () => {
    for (const t of PRIVATE_SCHOOL_PACK_V1.templates) {
      expect(t.definition.trigger.kind).toBe("event");
      if (t.definition.trigger.kind === "event")
        expect(WF05_EVENT_PAYLOAD_KEYS[t.definition.trigger.eventType]).toBeDefined();
    }
  });
  it("the absence alert is blocked until decision 7 and the guardian message is minor_sensitive at draft", () => {
    expect(PS_ABSENCE_ALERT.meta.blockedUntil).toContain("decision-7");
    const s = PS_ABSENCE_ALERT.definition.steps.find((x) => x.stepId === "guardian_alert");
    expect(s?.action?.dataClass).toBe("minor_sensitive");
    expect(PS_ABSENCE_ALERT.meta.stepAutonomy.guardian_alert).toBe("draft");
  });
  it("rejects a widened or unsafe template", () => {
    const widen = clone(PS_FEE_LADDER);
    (widen.meta.stepAutonomy as Record<string, string>).notice = "act_and_report";
    expect(validatePackTemplate(widen).ok).toBe(false);
    const hook = clone(PS_FEE_LADDER);
    (hook.definition.steps[0].action as { kind: string }).kind = "webhook";
    expect(validatePackTemplate(hook).ok).toBe(false);
    const wrongChannel = clone(PS_FEE_LADDER);
    (wrongChannel.definition.steps[0].action as { kind: string }).kind = "sms";
    expect(validatePackTemplate(wrongChannel).ok).toBe(false);
    const badKey = clone(PS_FEE_LADDER);
    badKey.definition.steps[0].action!.templateParams = { learner_name: "payload.learner_name" };
    expect(validatePackTemplate(badKey).ok).toBe(false);
    const noBlock = clone(PS_ABSENCE_ALERT);
    noBlock.meta.blockedUntil = [];
    expect(validatePackTemplate(noBlock).ok).toBe(false);
    const live = clone(PS_FEE_LADDER);
    (live.meta as { shadowDefault: boolean }).shadowDefault = false;
    expect(validatePackTemplate(live).ok).toBe(false);
  });
  it("catalog rows fit the wf_template constraints", () => {
    for (const t of PRIVATE_SCHOOL_PACK_V1.templates) {
      const row = packTemplateToCatalogRow(t);
      expect(row.template_key).toMatch(/^[a-z][a-z0-9_-]{1,62}$/);
      expect(row.description.length).toBeLessThanOrEqual(2000);
      expect(JSON.stringify(row.graph).length).toBeLessThan(262144);
    }
  });

  it("reminder timing: week start is sms then push, week end is push only, due day and overdue add whatsapp, escalation is a task", () => {
    const kinds = (t: (typeof PRIVATE_SCHOOL_PACK_V1.templates)[number]) =>
      t.definition.steps.map((x) => x.action?.kind);
    expect(kinds(PS_FEE_WEEK_START)).toEqual(["sms", "in_app"]);
    expect(kinds(PS_FEE_WEEK_END)).toEqual(["in_app"]);
    expect(kinds(PS_FEE_DUE_DAY)).toEqual(["whatsapp", "sms", "in_app"]);
    expect(kinds(PS_FEE_OVERDUE)).toEqual(["whatsapp", "sms", "in_app"]);
    expect(kinds(PS_FEE_ESCALATION)).toEqual(["task"]);
  });
  it("no reminder template waits or branches: timing belongs to the scheduler", () => {
    for (const t of [
      PS_FEE_WEEK_START,
      PS_FEE_WEEK_END,
      PS_FEE_DUE_DAY,
      PS_FEE_OVERDUE,
      PS_FEE_ESCALATION,
    ])
      for (const s of t.definition.steps)
        expect(["wait", "condition"]).not.toContain(s.kind === "action" ? s.action?.kind : s.kind);
  });
  it("whatsapp steps stay blocked until Meta approval is recorded", () => {
    for (const t of [PS_FEE_DUE_DAY, PS_FEE_OVERDUE])
      expect(t.meta.blockedUntil).toContain("meta-templates-approved");
    const open = clone(PS_FEE_DUE_DAY);
    (open.meta as unknown as { blockedUntil: string[] }).blockedUntil = [];
    expect(validatePackTemplate(open).ok).toBe(false);
  });
  it("a reference missing from the registry is rejected", () => {
    const t = clone(PS_FEE_WEEK_END);
    t.definition.steps[0].action!.templateRef = "ps.fee.not_written";
    expect(validatePackTemplate(t).ok).toBe(false);
  });
});

describe("WF-15a2 message registry", () => {
  it("passes its own validation", () => {
    expect(validateFeeMessageRegistry()).toEqual({ ok: true });
  });
  it("every SMS carries the pay link and STOP wording and fits two GSM-7 segments with real-length values", () => {
    for (const [ref, m] of Object.entries(FEE_MESSAGE_REGISTRY).filter(
      ([, m]) => m.channel === "sms",
    )) {
      expect(m.body, ref).toContain("{{pay_link}}");
      expect(m.body, ref).toContain("Reply STOP");
      expect(renderSample(m.body).length, ref).toBeLessThanOrEqual(306);
    }
  });
  it("the two WhatsApp entries match the Meta submission pack (names, parameter order, utility category)", () => {
    const due = FEE_MESSAGE_REGISTRY["ps.fee.due_day.whatsapp"].whatsapp!;
    const over = FEE_MESSAGE_REGISTRY["ps.fee.overdue.whatsapp"].whatsapp!;
    expect([due.name, due.category, due.status]).toEqual([
      "fee_due_today",
      "UTILITY",
      "not_submitted",
    ]);
    expect(due.params).toEqual(["guardian", "amount", "student", "school", "due_date", "pay_link"]);
    expect([over.name, over.category]).toEqual(["fee_overdue_weekly", "UTILITY"]);
    expect(over.params).toEqual([
      "guardian",
      "balance",
      "student",
      "school",
      "due_date",
      "pay_link",
    ]);
  });
  it("rejects promotional wording, unknown variables, a missing STOP and a bad WhatsApp binding", () => {
    const base = FEE_MESSAGE_REGISTRY["ps.fee.due_day.sms"];
    const bad = (patch: Record<string, unknown>) =>
      validateFeeMessageRegistry({ "ps.fee.x.sms": { ...base, ...patch } as never }).ok;
    expect(bad({ body: "Free offer: {{pay_link}} Reply STOP to opt out." })).toBe(false);
    expect(bad({ body: "Hi {{surname}} {{pay_link}} Reply STOP to opt out." })).toBe(false);
    expect(bad({ body: "{{school}} fees due {{pay_link}}" })).toBe(false);
    expect(bad({ body: "Fees ✓ {{pay_link}} Reply STOP to opt out." })).toBe(false);
    const wa = FEE_MESSAGE_REGISTRY["ps.fee.due_day.whatsapp"];
    expect(
      validateFeeMessageRegistry({
        "ps.fee.y.whatsapp": {
          ...wa,
          whatsapp: { ...wa.whatsapp!, category: "MARKETING" },
        } as never,
      }).ok,
    ).toBe(false);
    expect(
      validateFeeMessageRegistry({
        "ps.fee.y.whatsapp": {
          ...wa,
          body: "{{guardian}}, fees are due on {{due_date}}.",
        } as never,
      }).ok,
    ).toBe(false);
  });
  it("variables are only payload-bound or derived from the invoice, never free text", () => {
    for (const m of Object.values(FEE_MESSAGE_REGISTRY))
      for (const v of messageVariables(m.body))
        expect([
          "guardian",
          "student",
          "school",
          "pay_link",
          "balance",
          "amount",
          "due_date",
        ]).toContain(v);
  });
});
