import { describe, expect, it } from "vitest";
import { JARVIS_EXECUTIVE_PACK } from "../../frontend/src/lib/jarvis-executive/executive-pack";
import {
  ACTION_MAP,
  UNMAPPED_BY_DESIGN,
  actionMapFor,
  validateActionCoverage,
} from "../../frontend/src/lib/jarvis-bridge/approval-bridge.server";
import { JARVIS_RISK_TIER_POLICY } from "../../frontend/src/lib/jarvis/risk-policy";
import { COMPLETION_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/completion-workforce-packs";
import { EXPANSION_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/expansion-workforce-packs";
import { PLATFORM_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/platform-workforce-packs";

const packs = [
  ...PLATFORM_WORKFORCE_PACKS,
  JARVIS_EXECUTIVE_PACK,
  ...EXPANSION_WORKFORCE_PACKS,
  ...COMPLETION_WORKFORCE_PACKS,
];

describe("ENGINE-11 approval action coverage", () => {
  it("every gated capability in every pack is mapped or an explicit exception", () => {
    expect(validateActionCoverage(packs)).toEqual([]);
  });

  it("the only exception is publishing to social media, which has no risk-policy action yet", () => {
    expect(UNMAPPED_BY_DESIGN).toEqual(["publish.social.post"]);
    expect(Object.keys(ACTION_MAP)).not.toContain("publish.social.post");
  });

  it("maps customer-visible sends to T2 and secrets, money, deploy and access to T3", () => {
    expect(ACTION_MAP["send.reply"]).toBe("send_customer_communications");
    expect(ACTION_MAP["send.outreach"]).toBe("send_customer_communications");
    expect(ACTION_MAP["notify.tenants"]).toBe("send_customer_communications");
    expect(ACTION_MAP["schedule.maintenance"]).toBe("change_platform_configuration");
    expect(ACTION_MAP["quarantine.worker"]).toBe("change_platform_configuration");
    for (const id of [
      "request.credential.rotation",
      "request.refund",
      "request.deploy",
      "request.access.grant",
    ]) {
      expect(JARVIS_RISK_TIER_POLICY[ACTION_MAP[id]!], id).toBe("T3");
    }
  });

  it("reports a gated capability that has no action and is not an exception", () => {
    const { "send.reply": _drop, ...rest } = ACTION_MAP;
    expect(validateActionCoverage(packs, rest)).toEqual([
      "support-agent: send.reply (T2) has no JARVIS action and is not listed as unmapped",
    ]);
  });

  it("reports an unmapped T3 capability in every pack that declares it", () => {
    const { "request.deploy": _drop, ...rest } = ACTION_MAP;
    expect(validateActionCoverage(packs, rest)).toEqual([
      "engineering-agent: request.deploy (T3) has no JARVIS action and is not listed as unmapped",
      "jarvis-executive: request.deploy (T3) has no JARVIS action and is not listed as unmapped",
    ]);
  });

  it("reports a tier mismatch, an unknown action and an entry for no capability", () => {
    const problems = validateActionCoverage(packs, {
      ...ACTION_MAP,
      "request.refund": "send_customer_communications",
      "send.reply": "no_such_action",
      "ghost.cap": "spend_money",
    }).join("|");
    expect(problems).toContain(
      "finance-agent: request.refund: tier T3 differs from JARVIS send_customer_communications T2",
    );
    expect(problems).toContain("support-agent: send.reply: unknown JARVIS action no_such_action");
    expect(problems).toContain("ghost.cap: not a capability of any pack");
  });

  it("reports an exception that does not exist or is also mapped", () => {
    expect(validateActionCoverage(packs, ACTION_MAP, ["publish.social.post", "ghost.cap"])).toEqual(
      ["ghost.cap: listed as unmapped but not a capability of any pack"],
    );
    const both = validateActionCoverage(packs, {
      ...ACTION_MAP,
      "publish.social.post": "spend_money",
    });
    expect(both).toContain("publish.social.post: both mapped and listed as unmapped");
  });

  it("actionMapFor keeps only the entries a pack has", () => {
    expect(Object.keys(actionMapFor(JARVIS_EXECUTIVE_PACK)).sort()).toEqual([
      "request.access.grant",
      "request.deploy",
      "request.refund",
      "send.customer.message",
    ]);
    expect(
      Object.keys(actionMapFor(PLATFORM_WORKFORCE_PACKS.find((p) => p.code === "support-agent")!)),
    ).toEqual(["send.reply"]);
  });
});
