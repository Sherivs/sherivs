import { describe, expect, it } from "vitest";
import {
  GRP_FINANCE_CLOSE,
  GRP_KPI_BREACH_ALERT,
  GRP_WEEKLY_ROLLUP,
  GROUP_MESSAGE_REGISTRY,
  GROUP_WORKFLOW_PACK_V1,
  groupTemplateToCatalogRow,
  validateGroupWorkflowPack,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/group-workflow-pack";
import { GROUP_PACK_V1 } from "../../frontend/src/lib/runtime/scholar/workflow-packs/group-pack-v1";
import {
  WF05_EVENT_PAYLOAD_KEYS,
  validatePackTemplate,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/private-school-pack";

describe("Group workflow pack (WF-15b3)", () => {
  it("is valid", () => {
    expect(validateGroupWorkflowPack()).toEqual({ ok: true });
    expect(GROUP_WORKFLOW_PACK_V1.templates).toHaveLength(3);
  });
  it("knows the three group events and their payload keys", () => {
    expect(WF05_EVENT_PAYLOAD_KEYS["schedule.weekly"]).toEqual(["campuses", "week"]);
    expect(WF05_EVENT_PAYLOAD_KEYS["schedule.month_end"]).toEqual(["campuses", "month"]);
    expect(WF05_EVENT_PAYLOAD_KEYS["group.kpi_below_threshold"]).toEqual([
      "campus_org",
      "metric",
      "threshold",
    ]);
  });
  it("keeps every group message free of digits and personal data", () => {
    for (const m of Object.values(GROUP_MESSAGE_REGISTRY)) {
      expect(m.channel).toBe("in_app");
      expect(/\d/.test(m.body)).toBe(false);
      expect(m.body).not.toMatch(/\{\{(student|guardian|school|amount|balance|campus_org)\}\}/);
    }
  });
  it("sends in-app drafts only", () => {
    for (const t of GROUP_WORKFLOW_PACK_V1.templates)
      for (const s of t.definition.steps)
        if (s.action) {
          expect(s.action.kind).toBe("in_app");
          expect(t.meta.stepAutonomy[s.stepId]).toBe("draft");
        }
  });
  it("makes the month-end close wait for a human group director", () => {
    const steps = GRP_FINANCE_CLOSE.definition.steps;
    expect(steps[0].kind).toBe("approval");
    expect(steps[0].nextStepId).toBe("close_note");
    expect(GRP_FINANCE_CLOSE.definition.requiredApprovals).toEqual([
      { stepId: "close_pack", approverRoleRef: "group_director" },
    ]);
    const entry = GROUP_PACK_V1.find((e) => e.key === "group.finance_close")!;
    expect(entry.approvals.some((a) => a.stepUp)).toBe(true);
  });
  it("rejects a template that binds a key the event does not carry", () => {
    const bad = {
      ...GRP_WEEKLY_ROLLUP,
      definition: {
        ...GRP_WEEKLY_ROLLUP.definition,
        steps: [
          {
            ...GRP_WEEKLY_ROLLUP.definition.steps[0],
            action: {
              ...GRP_WEEKLY_ROLLUP.definition.steps[0].action!,
              templateParams: { week: "payload.campus_count" },
            },
          },
        ],
      },
    };
    const r = validatePackTemplate(bad, GROUP_MESSAGE_REGISTRY);
    expect(r.ok).toBe(false);
  });
  it("rejects a template whose message is not in the group registry", () => {
    const r = validatePackTemplate(GRP_KPI_BREACH_ALERT);
    expect(r.ok).toBe(false);
  });
  it("matches the catalog: three group entries are built and point at these templates", () => {
    for (const k of ["group.weekly_rollup", "group.kpi_breach_alert", "group.finance_close"]) {
      const e = GROUP_PACK_V1.find((x) => x.key === k)!;
      expect(e.buildState).toBe("built");
      expect(GROUP_WORKFLOW_PACK_V1.templates.map((t) => t.templateKey)).toContain(
        e.sourceTemplateKey,
      );
    }
  });
  it("produces catalog rows for the group pack", () => {
    const row = groupTemplateToCatalogRow(GRP_WEEKLY_ROLLUP);
    expect(row.graph.pack.key).toBe("group");
    expect(row.template_key).toBe("group_weekly_rollup");
  });
});
