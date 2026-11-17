/**
 * ENGINE-01 — compiler, provisioning plan and isolation rules.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canFlowToCore,
  compileContext,
  contextKeyOf,
  contextMemoryScopeId,
  personMemoryScopeId,
  personMemoryTenant,
  planProvisioning,
  resolveActingContext,
  visibleMemoryScopes,
  type ContextPlan,
  type MembershipFact,
  type PassportView,
} from "../../frontend/src/lib/twin-engine/engine";
import type { RolePack } from "../../frontend/src/lib/twin-engine/role-pack";
import { PLATFORM_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/platform-workforce-packs";
import { TENANT_ROLE_PACKS } from "../../frontend/src/lib/scholar/role-packs/tenant-role-packs";
import {
  buildRoleLens,
  type LensSpec,
  type RoleAssignmentView,
} from "../../frontend/src/lib/scholar/personal-twin/role-lens";

const PACKS: readonly RolePack[] = [...TENANT_ROLE_PACKS, ...PLATFORM_WORKFORCE_PACKS];
const lookup = (role: string) => PACKS.find((p) => p.appliesTo.includes(role));

const ID = "11111111-1111-4111-8111-111111111111";
const TA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const m = (over: Partial<MembershipFact> = {}): MembershipFact => ({
  identityId: ID,
  tenantId: TA,
  membershipId: "m-1",
  roleCode: "teacher",
  active: true,
  ...over,
});

describe("compileContext", () => {
  it("an active membership with a pack compiles to an active context with a shadow agent", () => {
    const c = compileContext(m(), lookup("teacher"));
    expect(c.status).toBe("active");
    expect(c.packCode).toBe("teacher");
    expect(c.agent?.capabilities.length).toBeGreaterThan(0);
    for (const cap of c.agent?.capabilities ?? []) expect(cap.effective).toBe("shadow");
    expect(c.agent?.trust.every((t) => t.state === "shadow")).toBe(true);
  });
  it("a role with no pack still gets a context, waiting without an agent", () => {
    const c = compileContext(m({ roleCode: "alumni" }), lookup("alumni"));
    expect(c).toMatchObject({ status: "pending_pack", packCode: null, lens: null, agent: null });
  });
  it("an inactive membership compiles to a suspended context with no agent", () => {
    const c = compileContext(m({ active: false }), lookup("teacher"));
    expect(c).toMatchObject({ status: "suspended", agent: null, lens: null });
  });
  it("wake events are the sorted union of playbook triggers", () => {
    const c = compileContext(m(), lookup("teacher"));
    expect(c.agent?.wakeEvents).toEqual([...(c.agent?.wakeEvents ?? [])].sort());
    expect(c.agent?.wakeEvents).toContain("class.starting");
  });
  it("is deterministic", () => {
    expect(compileContext(m(), lookup("teacher"))).toEqual(compileContext(m(), lookup("teacher")));
  });
  it("memory scope ids are distinct per context and never equal the person scope", () => {
    const a = compileContext(m(), lookup("teacher"));
    const b = compileContext(m({ tenantId: TB, roleCode: "parent" }), lookup("parent"));
    expect(a.memoryScopeId).not.toBe(b.memoryScopeId);
    expect(a.memoryScopeId).not.toBe(personMemoryScopeId(ID));
    expect(personMemoryTenant(ID)).not.toBe(TA);
  });
});

describe("compiled lens is a valid, narrowing role lens", () => {
  it("is assignable to the personal-twin LensSpec and can only narrow", () => {
    const c = compileContext(m(), lookup("teacher"));
    const spec: LensSpec = c.lens as LensSpec;
    const assignment: RoleAssignmentView = {
      assignmentId: "a1",
      roleCode: "role.teacher",
      templateCode: "teacher",
      workspaceId: "ws",
      permissions: ["attendance.take", "students.view"],
    };
    const lens = buildRoleLens(assignment, spec);
    expect(lens).not.toBeNull();
    for (const p of lens?.permissions ?? []) expect(assignment.permissions).toContain(p);
    expect(lens?.dropped).toContain("grades.enter");
    for (const t of lens?.tools ?? []) {
      const tool = spec.tools.find((x) => x.toolId === t);
      expect(lens?.permissions).toContain(tool?.requiresPermission);
    }
  });
});

describe("planProvisioning", () => {
  it("activation ensures the person and the context, in that order", () => {
    const plan = planProvisioning({ type: "activated", membership: m() }, lookup);
    expect(plan.map((a) => a.kind)).toEqual(["ensure_person", "ensure_context"]);
  });
  it("an unaccepted invitation (inactive) provisions nothing but a suspension of nothing", () => {
    const plan = planProvisioning({ type: "activated", membership: m({ active: false }) }, lookup);
    expect(plan.map((a) => a.kind)).toEqual(["suspend_context"]);
  });
  it("deactivation suspends only that context", () => {
    const plan = planProvisioning(
      { type: "deactivated", membership: m({ active: false }) },
      lookup,
    );
    expect(plan).toEqual([
      {
        kind: "suspend_context",
        contextKey: contextKeyOf(ID, TA, "teacher"),
        reason: "membership_inactive",
      },
    ]);
  });
  it("a role change suspends the old context and ensures the new one", () => {
    const plan = planProvisioning(
      { type: "role_changed", membership: m({ roleCode: "bursar" }), previousRoleCode: "teacher" },
      lookup,
    );
    expect(plan[0]).toMatchObject({
      kind: "suspend_context",
      contextKey: contextKeyOf(ID, TA, "teacher"),
    });
    expect(plan.map((a) => a.kind)).toEqual(["suspend_context", "ensure_person", "ensure_context"]);
  });
  it("incomplete input is a no-op, not a guess", () => {
    expect(
      planProvisioning({ type: "activated", membership: m({ identityId: "" }) }, lookup),
    ).toEqual([{ kind: "noop", reason: "incomplete_membership" }]);
  });
  it("is idempotent: the same event always yields the same plan", () => {
    const e = { type: "activated", membership: m() } as const;
    expect(planProvisioning(e, lookup)).toEqual(planProvisioning(e, lookup));
  });
});

describe("isolation across memberships", () => {
  const ctx = (tenantId: string, roleCode: string, status: ContextPlan["status"] = "active") => {
    const key = contextKeyOf(ID, tenantId, roleCode);
    return { contextKey: key, tenantId, status, memoryScopeId: contextMemoryScopeId(key) };
  };
  const passport: PassportView = {
    identityId: ID,
    contexts: [ctx(TA, "teacher"), ctx(TB, "parent"), ctx(TB, "bursar", "suspended")],
  };

  it("acting in one context exposes the person core and only that context", () => {
    const a = visibleMemoryScopes(passport, contextKeyOf(ID, TA, "teacher"));
    expect(a).toEqual([
      personMemoryScopeId(ID),
      contextMemoryScopeId(contextKeyOf(ID, TA, "teacher")),
    ]);
    expect(a.join()).not.toContain(TB);
  });
  it("an unknown or suspended context yields the core only", () => {
    expect(visibleMemoryScopes(passport, contextKeyOf(ID, TB, "bursar"))).toEqual([
      personMemoryScopeId(ID),
    ]);
    expect(visibleMemoryScopes(passport, "nonsense")).toEqual([personMemoryScopeId(ID)]);
    expect(resolveActingContext(passport, contextKeyOf(ID, TB, "bursar"))).toBeNull();
    expect(resolveActingContext(passport, contextKeyOf(ID, TB, "parent"))).not.toBeNull();
  });
  it("never reveals two tenants at once, for any context choice", () => {
    for (const c of passport.contexts) {
      const scopes = visibleMemoryScopes(passport, c.contextKey).filter((s) =>
        s.startsWith("twin-context:"),
      );
      const tenants = new Set(scopes.map((s) => s.split(":")[2]));
      expect(tenants.size).toBeLessThanOrEqual(1);
    }
  });
  it("context data flows to the person core only with tenant policy AND consent, never restricted", () => {
    const base = {
      originTenantId: TA,
      sensitivity: "internal",
      tenantPolicyAllowsExport: true,
      personConsented: true,
    } as const;
    expect(canFlowToCore(base)).toBe(true);
    expect(canFlowToCore({ ...base, tenantPolicyAllowsExport: false })).toBe(false);
    expect(canFlowToCore({ ...base, personConsented: false })).toBe(false);
    expect(canFlowToCore({ ...base, sensitivity: "restricted" })).toBe(false);
  });
});

describe("database parity", () => {
  const sql = readFileSync(
    new URL(
      "../../database/supabase/migrations/20261110000100_sherivs_engine01_person_twin_and_role_packs.sql",
      import.meta.url,
    ),
    "utf8",
  );
  it("scope id formulas match the SQL", () => {
    expect(personMemoryScopeId(ID)).toBe(`twin-person:${ID}`);
    expect(sql).toContain("'twin-person:' || p_identity::text");
    expect(personMemoryTenant(ID)).toBe(`person:${ID}`);
    expect(sql).toContain("'person:' || p_identity::text");
    expect(contextMemoryScopeId(contextKeyOf(ID, TA, "teacher"))).toBe(
      `twin-context:${ID}:${TA}:teacher`,
    );
    expect(sql).toContain(
      "'twin-context:' || p_identity::text || ':' || p_tenant_ref || ':' || p_role",
    );
  });
  it("every shipped pack role has a deterministic home", () => {
    const roles = PACKS.flatMap((p) => p.appliesTo);
    expect(new Set(roles).size).toBe(roles.length);
  });
});
