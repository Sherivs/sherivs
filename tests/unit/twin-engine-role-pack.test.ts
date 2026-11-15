/**
 * ENGINE-01 — Role Pack schema, validator and first-party packs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_AUTONOMOUS_TIER,
  MAX_DECLARABLE_TIER,
  ROLE_PACK_SCHEMA,
  canonicalJson,
  parseRolePack,
  tierRank,
  validateRolePack,
  type RolePack,
} from "../../frontend/src/lib/twin-engine/role-pack";
import { PLATFORM_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/platform-workforce-packs";
import { TENANT_ROLE_PACKS } from "../../frontend/src/lib/scholar/role-packs/tenant-role-packs";
import {
  NG_PERMISSIONS,
  NG_ROLE_TEMPLATES,
} from "../../frontend/src/lib/scholar/roles/ng-role-catalog.generated";

const ALL_PACKS: readonly RolePack[] = [...TENANT_ROLE_PACKS, ...PLATFORM_WORKFORCE_PACKS];

const clone = (p: RolePack): RolePack => JSON.parse(JSON.stringify(p)) as RolePack;
const base = (): RolePack => clone(TENANT_ROLE_PACKS.find((p) => p.code === "teacher") as RolePack);
const baseOf = (code: string): RolePack =>
  clone(ALL_PACKS.find((p) => p.code === code) as RolePack);

describe("shipped packs", () => {
  it("every first-party pack validates with no findings", () => {
    for (const pack of ALL_PACKS) expect(validateRolePack(pack), pack.code).toEqual([]);
  });

  it("codes are unique and appliesTo never overlaps within a kind", () => {
    expect(new Set(ALL_PACKS.map((p) => p.code)).size).toBe(ALL_PACKS.length);
    for (const set of [TENANT_ROLE_PACKS, PLATFORM_WORKFORCE_PACKS]) {
      const roles = set.flatMap((p) => p.appliesTo);
      expect(new Set(roles).size).toBe(roles.length);
    }
  });

  it("no pack declares T4, and tenant packs never exceed T2", () => {
    for (const pack of ALL_PACKS) {
      for (const c of pack.capabilities) {
        expect(c.tier, `${pack.code}/${c.id}`).not.toBe("T4");
        if (pack.kind === "tenant_role")
          expect(tierRank(c.tier)).toBeLessThanOrEqual(tierRank("T2"));
        if (c.autonomy === "act_autonomously")
          expect(tierRank(c.tier)).toBeLessThanOrEqual(tierRank(MAX_AUTONOMOUS_TIER));
      }
    }
  });

  it("every T3 capability routes to the sheriff and requires approval", () => {
    for (const pack of PLATFORM_WORKFORCE_PACKS) {
      for (const c of pack.capabilities.filter((x) => x.tier === "T3")) {
        expect(c.approver, `${pack.code}/${c.id}`).toBe("sheriff");
        expect(c.autonomy).toBe("act_with_approval");
      }
    }
  });

  it("tenant pack permissions come from the real catalog and the matching template", () => {
    const templateFor: Record<string, string> = {
      principal: "head_of_institution",
      teacher: "teacher",
      bursar: "bursar",
      parent: "parent",
      student: "student",
      admin: "admin_officer",
    };
    for (const pack of TENANT_ROLE_PACKS) {
      const tplCode = templateFor[pack.appliesTo[0] as string] as string;
      const tpl = NG_ROLE_TEMPLATES[tplCode] as unknown as {
        mandatory: string[];
        optionalOn: string[];
        optionalOff: string[];
      };
      const allowed = new Set([...tpl.mandatory, ...tpl.optionalOn, ...tpl.optionalOff]);
      for (const perm of pack.permissions) {
        expect(NG_PERMISSIONS[perm], `${pack.code}: ${perm} not in catalog`).toBeDefined();
        expect(allowed.has(perm), `${pack.code}: ${perm} not grantable to ${tplCode}`).toBe(true);
      }
    }
  });

  it("platform pack permissions are exactly capabilities seeded for the platform role", () => {
    const sql = readFileSync(
      new URL(
        "../../database/supabase/migrations/20261020000150_sherivs_008_platform_staff.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const pack of PLATFORM_WORKFORCE_PACKS) {
      const role = pack.appliesTo[0] as string;
      const m = new RegExp(`\\('${role}',[\\s\\S]*?ARRAY\\[([^\\]]+)\\]`).exec(sql);
      expect(m, `no seed for platform role ${role}`).not.toBeNull();
      const seeded = new Set(
        (m as RegExpExecArray)[1]!.split(",").map((s) => s.trim().replace(/'/g, "")),
      );
      for (const perm of pack.permissions)
        expect(seeded.has(perm), `${pack.code}: ${perm}`).toBe(true);
    }
  });

  it("every playbook step is a declared capability and every pack has a playbook", () => {
    for (const pack of ALL_PACKS) {
      expect(pack.playbooks.length, pack.code).toBeGreaterThan(0);
      const ids = new Set(pack.capabilities.map((c) => c.id));
      for (const pb of pack.playbooks)
        for (const s of pb.steps) expect(ids.has(s), `${pack.code}/${pb.id}/${s}`).toBe(true);
    }
  });
});

describe("validator rejects every unsafe pack (mutations)", () => {
  const mutate = (fn: (p: RolePack) => void, p: RolePack = base()): readonly string[] => {
    fn(p);
    return validateRolePack(p);
  };

  it("T4 is never declarable", () => {
    expect(
      mutate((p) => {
        (p.capabilities[0] as { tier: string }).tier = "T4";
      }).join(),
    ).toMatch(/T4/);
  });
  it("a tenant pack cannot declare T3", () => {
    const f = mutate((p) => {
      Object.assign(p.capabilities[0] as object, {
        tier: "T3",
        autonomy: "act_with_approval",
        approver: "sheriff",
      });
    });
    expect(f.join()).toMatch(/exceeds the T2 ceiling/);
  });
  it("a platform pack may declare T3 but not autonomously", () => {
    const p = baseOf("finance-agent");
    const refund = p.capabilities.find((c) => c.id === "request.refund") as { autonomy: string };
    refund.autonomy = "act_autonomously";
    expect(validateRolePack(p).join()).toMatch(/T3/);
  });
  it("T2 cannot be declared autonomous", () => {
    expect(
      mutate((p) => {
        (p.capabilities.find((c) => c.tier === "T2") as { autonomy: string }).autonomy =
          "act_autonomously";
      }).join(),
    ).toMatch(/autonomous/);
  });
  it("only T2 may be promotable", () => {
    expect(
      mutate((p) => {
        (
          p.capabilities.find((c) => c.tier === "T1") as { promotableToAutonomous?: boolean }
        ).promotableToAutonomous = true;
      }).join(),
    ).toMatch(/promotable/);
  });
  it("a capability must reference a declared permission", () => {
    expect(
      mutate((p) => {
        (p.capabilities[0] as { requiresPermission: string }).requiresPermission =
          "ghost.permission";
      }).join(),
    ).toMatch(/undeclared permission/);
  });
  it("a playbook cannot reference an unknown capability", () => {
    expect(
      mutate((p) => {
        (p.playbooks[0] as { steps: string[] }).steps.push("nope.step");
      }).join(),
    ).toMatch(/unknown capability/);
  });
  it("approval-gated capabilities need an approver", () => {
    expect(
      mutate((p) => {
        delete (
          p.capabilities.find((c) => c.autonomy === "act_with_approval") as { approver?: string }
        ).approver;
      }).join(),
    ).toMatch(/requires an approver/);
  });
  it("T3 cannot be approved by the role owner", () => {
    const p = baseOf("engineering-agent");
    (p.capabilities.find((c) => c.id === "request.deploy") as { approver: string }).approver =
      "role_owner";
    expect(validateRolePack(p).join()).toMatch(/role owner/);
  });
  it("cross-tenant memory is not declarable", () => {
    expect(
      mutate((p) => {
        (p.memory as { crossTenant: boolean }).crossTenant = true;
      }).length,
    ).toBeGreaterThan(0);
  });
  it("a pack must start in shadow", () => {
    expect(
      mutate((p) => {
        (p as { startsInShadow: boolean }).startsInShadow = false;
      }).length,
    ).toBeGreaterThan(0);
  });
  it("duplicate capability ids are rejected", () => {
    expect(
      mutate((p) => {
        p.capabilities.push(structuredClone(p.capabilities[0] as never));
      }).join(),
    ).toMatch(/duplicate capability/);
  });
  it("a tenant pack must not route default decisions to the sheriff", () => {
    expect(
      mutate((p) => {
        (p.escalation as { defaultApprover: string }).defaultApprover = "sheriff";
      }).join(),
    ).toMatch(/sheriff/);
  });
  it("unknown keys, a wrong schema tag and a bad code are rejected", () => {
    expect(validateRolePack({ ...base(), surprise: 1 }).length).toBeGreaterThan(0);
    expect(validateRolePack({ ...base(), schema: "other" }).length).toBeGreaterThan(0);
    expect(validateRolePack({ ...base(), code: "Bad Code" }).length).toBeGreaterThan(0);
  });
  it("garbage input fails closed with findings, never a throw", () => {
    for (const bad of [null, undefined, 42, "x", [], {}])
      expect(validateRolePack(bad).length).toBeGreaterThan(0);
  });
  it("parseRolePack returns the pack only when valid", () => {
    expect(parseRolePack(base()).ok).toBe(true);
    const bad = parseRolePack({ ...base(), schema: "x" });
    expect(bad.ok).toBe(false);
  });
});

describe("canonical form and SQL parity", () => {
  it("canonicalJson ignores key order and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe(
      canonicalJson({ a: [2, { c: undefined, d: 1 }], b: 1 }),
    );
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });

  it("the TypeScript ceilings equal the database guard", () => {
    const sql = readFileSync(
      new URL(
        "../../database/supabase/migrations/20261110000100_sherivs_engine01_person_twin_and_role_packs.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(MAX_DECLARABLE_TIER).toEqual({ tenant_role: "T2", platform_role: "T3" });
    expect(sql).toMatch(/WHEN 'tenant_role' THEN 2 ELSE 3/);
    expect(sql).toMatch(/v_cap->>'autonomy' = 'act_autonomously' AND v_rank > 1/);
    expect(MAX_AUTONOMOUS_TIER).toBe("T1");
    expect(sql).toContain(ROLE_PACK_SCHEMA);
  });
});
