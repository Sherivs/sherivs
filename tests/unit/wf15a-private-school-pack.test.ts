import { describe, expect, it } from "vitest";
import {
  PRIVATE_SCHOOL_PACK_V1,
  PS_ABSENCE_ALERT,
  PS_FEE_LADDER,
  packTemplateToCatalogRow,
  validatePackTemplate,
  validatePrivateSchoolPack,
  WF05_EVENT_PAYLOAD_KEYS,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/private-school-pack";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("WF-15a private school pack", () => {
  it("passes its own validation and holds exactly the three proposed templates", () => {
    expect(validatePrivateSchoolPack()).toEqual({ ok: true });
    expect(PRIVATE_SCHOOL_PACK_V1.templates.map((t) => t.templateKey)).toEqual([
      "ps_fee_ladder",
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
  it("uses only email, in_app, task and wait (no sms, whatsapp or webhook)", () => {
    for (const t of PRIVATE_SCHOOL_PACK_V1.templates)
      for (const s of t.definition.steps)
        if (s.action) expect(["email", "in_app", "task", "wait"]).toContain(s.action.kind);
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
    const sms = clone(PS_FEE_LADDER);
    (sms.definition.steps[0].action as { kind: string }).kind = "sms";
    expect(validatePackTemplate(sms).ok).toBe(false);
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
});
