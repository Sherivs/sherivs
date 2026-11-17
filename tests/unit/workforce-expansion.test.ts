import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JARVIS_EXECUTIVE_PACK } from "../../frontend/src/lib/jarvis-executive/executive-pack";
import {
  ACTION_MAP,
  validateActionCoverage,
} from "../../frontend/src/lib/jarvis-bridge/approval-bridge.server";
import { validateCharter, validateRoster } from "../../frontend/src/lib/workforce-charter/charter";
import { EXISTING_CHARTERS } from "../../frontend/src/lib/workforce-charter/charters/existing-charters";
import { COMPLETION_CHARTERS } from "../../frontend/src/lib/workforce-charter/charters/completion-charters";
import { EXPANSION_CHARTERS } from "../../frontend/src/lib/workforce-charter/charters/expansion-charters";
import { COMPLETION_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/completion-workforce-packs";
import { EXPANSION_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/expansion-workforce-packs";
import { PLATFORM_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/platform-workforce-packs";
import { validateRolePack, tierRank } from "../../frontend/src/lib/twin-engine/role-pack";

const allPacks = [
  ...PLATFORM_WORKFORCE_PACKS,
  JARVIS_EXECUTIVE_PACK,
  ...EXPANSION_WORKFORCE_PACKS,
  ...COMPLETION_WORKFORCE_PACKS,
];
const packOf = (code: string) => allPacks.find((p) => p.code === code)!;
const roster = [...EXISTING_CHARTERS, ...EXPANSION_CHARTERS, ...COMPLETION_CHARTERS].map(
  (charter) => ({
    charter,
    pack: packOf(charter.packCode),
  }),
);
const sql = readFileSync("database/proposals/ENGINE-11_workforce_roles.sql", "utf8");

describe("ENGINE-11 additional agent packs", () => {
  it("adds the eight recommended agents", () => {
    expect(EXPANSION_WORKFORCE_PACKS.map((p) => p.code)).toEqual([
      "compliance-agent",
      "reliability-agent",
      "customer-success-agent",
      "revenue-assurance-agent",
      "sentinel-agent",
      "archivist-agent",
      "product-intelligence-agent",
      "market-intelligence-agent",
    ]);
  });

  it("every pack is a valid Role Pack that starts in shadow", () => {
    for (const p of EXPANSION_WORKFORCE_PACKS) {
      expect(validateRolePack(p), p.code).toEqual([]);
      expect(p.startsInShadow).toBe(true);
    }
  });

  it("none reaches T3, and every T2 capability needs approval", () => {
    for (const p of EXPANSION_WORKFORCE_PACKS) {
      for (const c of p.capabilities) {
        expect(tierRank(c.tier), `${p.code} ${c.id}`).toBeLessThanOrEqual(tierRank("T2"));
        if (c.tier === "T2") expect(c.autonomy).toBe("act_with_approval");
      }
    }
  });

  it("capability ids are unique across the whole workforce", () => {
    const ids = allPacks.flatMap((p) => p.capabilities.map((c) => c.id));
    const sharedByDesign = [
      "request.deploy",
      "request.refund",
      "publish.social.post",
      "request.access.grant",
    ];
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i && !sharedByDesign.includes(id));
    expect(dupes).toEqual([]);
  });

  it("only the compliance agent may hold restricted memory", () => {
    const restricted = EXPANSION_WORKFORCE_PACKS.filter(
      (p) => p.memory.maxSensitivity === "restricted",
    );
    expect(restricted.map((p) => p.code)).toEqual(["compliance-agent"]);
  });

  it("each new platform role and permission is in the role proposal and the applied migration", () => {
    for (const p of EXPANSION_WORKFORCE_PACKS) {
      for (const role of p.appliesTo) expect(sql, role).toContain(`('${role}',`);
      for (const perm of p.permissions) expect(sql, perm).toContain(`'${perm}'`);
    }
    const applied = readFileSync(
      "database/supabase/migrations/20261115000700_sherivs_engine11_13_platform_roles.sql",
      "utf8",
    );
    for (const p of EXPANSION_WORKFORCE_PACKS) {
      for (const role of p.appliesTo) expect(applied, role).toContain(`('${role}',`);
      for (const perm of p.permissions) expect(applied, perm).toContain(`'${perm}'`);
    }
    expect(applied).not.toMatch(/,\s*true,\s*\d+\)/);
    expect(sql).toContain("APPLIED TO PRODUCTION");
    expect(sql).toContain("is_privileged");
    expect(sql).not.toMatch(/,\s*true,\s*\d+\)/);
  });
});

describe("ENGINE-11 additional agent charters", () => {
  it("every charter is sound for its pack", () => {
    for (const c of EXPANSION_CHARTERS) {
      expect(validateCharter(c, packOf(c.packCode)), c.packCode).toEqual([]);
    }
    expect(EXPANSION_CHARTERS).toHaveLength(EXPANSION_WORKFORCE_PACKS.length);
  });

  it("the twenty-five-agent roster has no problems and every handoff target exists", () => {
    expect(validateRoster(roster)).toEqual([]);
    expect(roster).toHaveLength(25);
  });

  it("the audit agent is the only assurance agent, reports to the sheriff, and is read-only", () => {
    const assurance = EXPANSION_CHARTERS.filter((c) => c.agentTier === "assurance");
    expect(assurance.map((c) => c.packCode)).toEqual(["sentinel-agent"]);
    const s = assurance[0]!;
    expect(s.supervisor).toBe("sheriff");
    expect(s.killScope).toBe("agent");
    expect(Object.values(s.duties)).not.toContain("originate");
    const caps = packOf("sentinel-agent").capabilities;
    expect(caps.every((c) => tierRank(c.tier) <= tierRank("T1"))).toBe(true);
    expect(caps.filter((c) => c.connector !== undefined).map((c) => c.connector)).toEqual([
      "owner-alert",
    ]);
  });

  it("department agents report to JARVIS and no new agent owns a T3 capability", () => {
    for (const c of EXPANSION_CHARTERS.filter((x) => x.agentTier === "department")) {
      expect(c.supervisor, c.packCode).toBe("jarvis-executive");
      expect(c.t3Rules).toEqual({});
    }
  });

  it("every customer-visible send of a new agent maps to a JARVIS approval action", () => {
    for (const code of [
      "send.data.notice",
      "publish.status.update",
      "send.checkin",
      "send.payment.reminder",
    ]) {
      expect(ACTION_MAP[code], code).toBe("send_customer_communications");
    }
    expect(validateActionCoverage(allPacks)).toEqual([]);
  });

  it("only agents that see customer content declare it", () => {
    const sees = EXPANSION_CHARTERS.filter((c) => c.modelPolicy.seesCustomerContent).map(
      (c) => c.packCode,
    );
    expect(sees).toEqual(["compliance-agent", "customer-success-agent"]);
  });
});
