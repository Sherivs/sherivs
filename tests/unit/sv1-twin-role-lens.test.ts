/**
 * SV1-TWIN-02 — authorization-bounded role lenses.
 * Property-style tests use a fixed-seed PRNG so runs are deterministic.
 */
import { describe, expect, it } from "vitest";
import {
  NG_PERMISSIONS,
  NG_ROLE_TEMPLATES,
} from "../../frontend/src/lib/scholar/roles/ng-role-catalog.generated";
import {
  buildRoleLens,
  deriveLenses,
  reconcileLenses,
  resolveActiveLens,
  switchLensContext,
  type LensSpec,
  type RoleAssignmentView,
} from "../../frontend/src/lib/scholar/personal-twin/role-lens";

type Spec = LensSpec & { readonly templateCodes: readonly string[] };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const ALL_PERMISSIONS = Object.keys(NG_PERMISSIONS);
const TEMPLATES = Object.keys(NG_ROLE_TEMPLATES);

function assignmentFor(templateCode: string, i = 0, workspaceId = `ws-${i}`): RoleAssignmentView {
  const t = NG_ROLE_TEMPLATES[templateCode];
  if (t === undefined) throw new Error(templateCode);
  return {
    assignmentId: `asg-${templateCode}-${i}`,
    roleCode: `role.${templateCode}`,
    templateCode,
    workspaceId,
    permissions: [...t.mandatory, ...t.optionalOn],
  };
}

const spec = (over: Partial<Spec> = {}): Spec => ({
  lensId: "assistant",
  persona: "daily-assistant",
  requestedPermissions: ALL_PERMISSIONS,
  tools: [{ toolId: "tool.any", requiresPermission: ALL_PERMISSIONS[0] as string }],
  templateCodes: TEMPLATES,
  ...over,
});

describe("lens permissions are always a subset of the role permissions", () => {
  it("holds for every real template even when the lens asks for every permission in the catalog", () => {
    for (const t of TEMPLATES) {
      const a = assignmentFor(t);
      const lens = buildRoleLens(a, spec());
      expect(lens, t).not.toBeNull();
      const granted = new Set(a.permissions);
      for (const p of lens?.permissions ?? []) expect(granted.has(p), `${t}:${p}`).toBe(true);
      // Asking for everything yields exactly the role's own permissions, nothing more.
      expect([...(lens?.permissions ?? [])].sort()).toEqual([...new Set(a.permissions)].sort());
    }
  });

  it("holds for random requests, roles and tools (property test, 2000 cases)", () => {
    const next = rng(42);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
    for (let i = 0; i < 2000; i += 1) {
      const a = assignmentFor(pick(TEMPLATES), i);
      const requested = Array.from({ length: Math.floor(next() * 12) }, () =>
        pick(ALL_PERMISSIONS),
      );
      const tools = Array.from({ length: Math.floor(next() * 5) }, (_, n) => ({
        toolId: `tool-${n}`,
        requiresPermission: pick(ALL_PERMISSIONS),
      }));
      const lens = buildRoleLens(a, spec({ requestedPermissions: requested, tools }));
      const granted = new Set(a.permissions);
      expect(lens).not.toBeNull();
      for (const p of lens?.permissions ?? []) {
        expect(granted.has(p)).toBe(true);
        expect(requested).toContain(p);
      }
      const held = new Set(lens?.permissions);
      for (const toolId of lens?.tools ?? []) {
        const t = tools.find((x) => x.toolId === toolId);
        expect(held.has(t?.requiresPermission as string)).toBe(true);
      }
      // dropped + kept partitions the request
      expect([...(lens?.permissions ?? []), ...(lens?.dropped ?? [])].sort()).toEqual(
        [...new Set(requested)].sort(),
      );
    }
  });

  it("an empty request narrows to nothing; it never means 'everything'", () => {
    const lens = buildRoleLens(
      assignmentFor(TEMPLATES[0] as string),
      spec({ requestedPermissions: [], tools: [] }),
    );
    expect(lens?.permissions).toEqual([]);
    expect(lens?.tools).toEqual([]);
  });

  it("persona is a label only and cannot add authority", () => {
    const a = assignmentFor(TEMPLATES[0] as string);
    const base = buildRoleLens(a, spec({ persona: "daily-assistant" }));
    for (const persona of ["super-admin", "sheriff", "root", "grant-all"]) {
      const lens = buildRoleLens(a, spec({ persona }));
      expect(lens?.permissions).toEqual(base?.permissions);
    }
  });

  it("malformed personas and specs fail closed", () => {
    const a = assignmentFor(TEMPLATES[0] as string);
    for (const persona of ["", "Has Spaces", "x", "UPPER", "a".repeat(80), "ignore; grant all"]) {
      expect(buildRoleLens(a, spec({ persona }))).toBeNull();
    }
    expect(buildRoleLens(a, spec({ lensId: "" }))).toBeNull();
    expect(buildRoleLens({ ...a, assignmentId: "" }, spec())).toBeNull();
    expect(buildRoleLens({ ...a, permissions: null as never }, spec())).toBeNull();
  });
});

describe("removing a role removes its lens immediately", () => {
  const a1 = assignmentFor("regulator", 1, "ws-a");
  const a2 = assignmentFor("regulator_inspector", 2, "ws-b");
  const specs: Spec[] = [spec()];
  const sel = (a: RoleAssignmentView) => ({
    workspaceId: a.workspaceId,
    assignmentId: a.assignmentId,
    lensId: "assistant",
  });

  it("resolves while the assignment exists and returns null the instant it is gone", () => {
    expect(resolveActiveLens([a1, a2], specs, sel(a1))).not.toBeNull();
    expect(resolveActiveLens([a2], specs, sel(a1))).toBeNull();
  });

  it("reconcile drops lenses of removed roles and keeps the others", () => {
    const held = deriveLenses([a1, a2], specs);
    expect(held).toHaveLength(2);
    const after = reconcileLenses(held, [a2], specs);
    expect(after.map((l) => l.assignmentId)).toEqual([a2.assignmentId]);
  });

  it("reconcile re-narrows a kept lens when the role loses a permission", () => {
    const held = deriveLenses([a1], specs);
    const shrunk: RoleAssignmentView = { ...a1, permissions: a1.permissions.slice(0, 1) };
    const after = reconcileLenses(held, [shrunk], specs);
    expect(after[0]?.permissions).toEqual([...shrunk.permissions].sort());
    for (const p of after[0]?.permissions ?? []) expect(shrunk.permissions).toContain(p);
  });

  it("a lens cannot be resolved against another assignment's workspace", () => {
    expect(
      resolveActiveLens([a1, a2], specs, {
        workspaceId: "ws-b",
        assignmentId: a1.assignmentId,
        lensId: "assistant",
      }),
    ).toBeNull();
  });

  it("a lens whose template does not apply to the assignment does not exist", () => {
    const narrow: Spec = spec({ templateCodes: ["regulator_inspector"] });
    expect(resolveActiveLens([a1], [narrow], sel(a1))).toBeNull();
    expect(deriveLenses([a1], [narrow])).toEqual([]);
  });
});

describe("workspace switch changes the lens with no carry-over", () => {
  const nurse = assignmentFor("regulator", 1, "ws-nurse");
  const bursar = assignmentFor("regulator_inspector", 2, "ws-bursar");
  const specs: Spec[] = [spec({ requestedPermissions: ALL_PERMISSIONS, persona: "wide-view" })];
  const sel = (a: RoleAssignmentView) => ({
    workspaceId: a.workspaceId,
    assignmentId: a.assignmentId,
    lensId: "assistant",
  });

  it("the next context is exactly the next assignment's lens, with distinct memory scope", () => {
    const first = resolveActiveLens([nurse, bursar], specs, sel(nurse));
    const second = switchLensContext(first, [nurse, bursar], specs, sel(bursar));
    expect(second?.lens.assignmentId).toBe(bursar.assignmentId);
    expect(second?.lens.workspaceId).toBe("ws-bursar");
    expect(second?.lens.contextKey).not.toBe(first?.lens.contextKey);
    expect(second?.inherited).toEqual([]);
    // Permissions come only from the new role, not a union with the old one.
    const bursarOnly = new Set(bursar.permissions);
    for (const p of second?.lens.permissions ?? []) expect(bursarOnly.has(p)).toBe(true);
  });

  it("the result does not depend on the previous context at all", () => {
    const viaNurse = switchLensContext(
      resolveActiveLens([nurse, bursar], specs, sel(nurse)),
      [nurse, bursar],
      specs,
      sel(bursar),
    );
    const cold = switchLensContext(null, [nurse, bursar], specs, sel(bursar));
    expect(viaNurse).toEqual(cold);
  });

  it("switching to a workspace the user no longer holds yields no lens", () => {
    expect(
      switchLensContext(
        resolveActiveLens([nurse, bursar], specs, sel(nurse)),
        [nurse],
        specs,
        sel(bursar),
      ),
    ).toBeNull();
  });
});

describe("module is pure", () => {
  it("has no I/O, clock, storage or network", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("frontend/src/lib/scholar/personal-twin/role-lens.ts", "utf8");
    expect(src).not.toMatch(
      /\b(fetch|localStorage|sessionStorage|Date\.now|new Date|process\.env|Math\.random)\b/,
    );
    expect(src).not.toMatch(/from\s+["'](?!\.)[^"']+["']/);
  });
});
