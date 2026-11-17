import { describe, expect, it } from "vitest";
import {
  effectiveWorkflowAutonomy,
  isWorkflowConfidentialDataClass,
  isWorkflowEffectfulAction,
  isWorkflowMassCommunication,
  isWorkflowWebhookTargetAllowed,
  parseWorkflowDeliveryMode,
  workflowActionHasMoneyEffect,
  workflowActionCategory,
  workflowActionDefinitionIsValid,
  workflowDeliveryGate,
  WORKFLOW_ACTION_CATEGORY_CAPS,
  WORKFLOW_AUTONOMY_LEVELS,
  WORKFLOW_MASS_RECIPIENT_THRESHOLD,
  type WorkflowAutonomyLevel,
  type WorkflowDeliveryEnvironment,
} from "../../frontend/src/lib/workflow/workflow-actions";

const combinations = (): Array<
  [WorkflowAutonomyLevel, WorkflowAutonomyLevel, WorkflowAutonomyLevel]
> =>
  WORKFLOW_AUTONOMY_LEVELS.flatMap((template) =>
    WORKFLOW_AUTONOMY_LEVELS.flatMap((tenant) =>
      WORKFLOW_AUTONOMY_LEVELS.map((agent) => [template, tenant, agent]),
    ),
  ) as Array<[WorkflowAutonomyLevel, WorkflowAutonomyLevel, WorkflowAutonomyLevel]>;

describe("WF-06 action policy", () => {
  it("never raises a capped category above draft for any autonomy combination", () => {
    for (const actionClass of Object.keys(WORKFLOW_ACTION_CATEGORY_CAPS)) {
      for (const [template, tenant, agent] of combinations()) {
        const effective = effectiveWorkflowAutonomy({ template, tenant, agent, actionClass });
        expect(
          WORKFLOW_AUTONOMY_LEVELS.indexOf(effective),
          `${actionClass}: ${template}/${tenant}/${agent}`,
        ).toBeLessThanOrEqual(WORKFLOW_AUTONOMY_LEVELS.indexOf("draft"));
      }
    }
  });

  it("uses the minimum ceiling and fails closed for unclassified action classes", () => {
    expect(
      effectiveWorkflowAutonomy({
        template: "act_and_report",
        tenant: "act_with_approval",
        agent: "act_and_report",
        actionClass: "internal",
      }),
    ).toBe("act_with_approval");
    for (const [template, tenant, agent] of combinations()) {
      const effective = effectiveWorkflowAutonomy({
        template,
        tenant,
        agent,
        actionClass: "unknown",
      });
      expect(WORKFLOW_AUTONOMY_LEVELS.indexOf(effective)).toBeLessThanOrEqual(
        WORKFLOW_AUTONOMY_LEVELS.indexOf("draft"),
      );
    }
  });

  it("caps communication at the recipient threshold and for any audience selector", () => {
    expect(WORKFLOW_MASS_RECIPIENT_THRESHOLD).toBe(25);
    expect(isWorkflowMassCommunication({ recipientCount: 25, hasAudienceSelector: false })).toBe(
      false,
    );
    expect(isWorkflowMassCommunication({ recipientCount: 26, hasAudienceSelector: false })).toBe(
      true,
    );
    expect(isWorkflowMassCommunication({ recipientCount: 1, hasAudienceSelector: true })).toBe(
      true,
    );
    expect(
      isWorkflowMassCommunication({ recipientCount: Number.NaN, hasAudienceSelector: false }),
    ).toBe(true);
  });

  it("caps confidential and minor-sensitive messages without reading event text", () => {
    for (const dataClass of ["confidential", "minor_sensitive", "minor-sensitive"]) {
      expect(isWorkflowConfidentialDataClass(dataClass)).toBe(true);
      expect(
        workflowActionCategory({
          actionClass: "internal",
          recipientCount: 1,
          hasAudienceSelector: false,
          dataClass,
        }),
      ).toBe("mass_message");
    }
    expect(isWorkflowConfidentialDataClass("internal")).toBe(false);
    expect(
      workflowActionCategory({
        actionClass: "internal",
        recipientCount: 25,
        hasAudienceSelector: false,
        dataClass: "internal",
      }),
    ).toBe("internal");
  });

  it("accepts only template references and recipient IDs, never message or address fields", () => {
    expect(
      workflowActionDefinitionIsValid({
        kind: "email",
        templateRef: "attendance.notice",
        templateParams: { first_name: "Ada" },
        recipientIds: ["a3f77e2c-0f47-4a80-81dc-f520a885c772"],
      }),
    ).toBe(true);
    expect(
      workflowActionDefinitionIsValid({
        kind: "email",
        templateRef: "attendance.notice",
        body: "untrusted event text",
      }),
    ).toBe(false);
    expect(
      workflowActionDefinitionIsValid({
        kind: "email",
        templateRef: "attendance.notice",
        recipientAddresses: ["ada@example.test"],
      }),
    ).toBe(false);
  });

  it("defaults unset and invalid delivery modes to off", () => {
    for (const value of [undefined, "", "OFF", "invalid"]) {
      expect(parseWorkflowDeliveryMode(value)).toBe("off");
    }
    expect(parseWorkflowDeliveryMode("sandbox")).toBe("sandbox");
    expect(parseWorkflowDeliveryMode("live")).toBe("live");
  });

  it("allows live effects only with both flags and production environment", () => {
    const environments: Array<WorkflowDeliveryEnvironment> = [
      {},
      { WORKFLOW_DELIVERY_MODE: "live", WORKFLOWS_ENABLED: "false", APP_ENV: "production" },
      { WORKFLOW_DELIVERY_MODE: "live", WORKFLOWS_ENABLED: "true", APP_ENV: "staging" },
      { WORKFLOW_DELIVERY_MODE: "live", WORKFLOWS_ENABLED: "true", APP_ENV: "development" },
      { WORKFLOW_DELIVERY_MODE: "live", WORKFLOWS_ENABLED: "true", APP_ENV: "production" },
      { WORKFLOW_DELIVERY_MODE: "sandbox", WORKFLOWS_ENABLED: "true", APP_ENV: "staging" },
    ];
    for (const env of environments) {
      for (const orgWorkflowsEnabled of [false, true]) {
        const gate = workflowDeliveryGate({ env, orgWorkflowsEnabled, kind: "sms" });
        const expectedLive =
          env.WORKFLOW_DELIVERY_MODE === "live" &&
          env.WORKFLOWS_ENABLED === "true" &&
          env.APP_ENV === "production" &&
          orgWorkflowsEnabled;
        const expectedSandbox =
          env.WORKFLOW_DELIVERY_MODE === "sandbox" &&
          env.WORKFLOWS_ENABLED === "true" &&
          orgWorkflowsEnabled;
        expect(gate.allowed).toBe(expectedLive || expectedSandbox);
        if (expectedLive) expect(gate).toEqual({ allowed: true, mode: "live" });
        if (expectedSandbox) expect(gate).toEqual({ allowed: true, mode: "sandbox" });
      }
    }
  });

  it("puts all human-facing and external actions behind the delivery gate", () => {
    for (const kind of ["email", "in_app", "whatsapp", "sms", "webhook"] as const) {
      expect(isWorkflowEffectfulAction(kind)).toBe(true);
      expect(
        workflowDeliveryGate({
          env: {
            WORKFLOW_DELIVERY_MODE: "live",
            WORKFLOWS_ENABLED: "false",
            APP_ENV: "production",
          },
          orgWorkflowsEnabled: true,
          kind,
        }),
      ).toMatchObject({ allowed: false, mode: "off" });
    }
    expect(isWorkflowEffectfulAction("task")).toBe(false);
    expect(isWorkflowEffectfulAction("wait")).toBe(false);
  });

  it("recognizes all registry forms of money effects", () => {
    expect(workflowActionHasMoneyEffect("money")).toBe(true);
    expect(workflowActionHasMoneyEffect("money_movement")).toBe(true);
    expect(workflowActionHasMoneyEffect("customer_visible")).toBe(false);
  });

  it("allows only registered, public HTTPS webhook endpoints", () => {
    const now = () => "2026-11-17T00:00:00.000Z";
    const targetUrl = "https://hooks.example.test/workflow";
    expect(isWorkflowWebhookTargetAllowed({ targetUrl, registeredTargetUrl: targetUrl, now })).toBe(
      true,
    );
    for (const target of [
      "http://hooks.example.test/workflow",
      "https://127.0.0.1/workflow",
      "https://10.0.0.1/workflow",
      "https://localhost/workflow",
      "******hooks.example.test/workflow",
      "https://hooks.example.test.evil.test/workflow",
    ]) {
      expect(
        isWorkflowWebhookTargetAllowed({
          targetUrl: target,
          registeredTargetUrl: targetUrl,
          now,
        }),
      ).toBe(false);
    }
  });
});
