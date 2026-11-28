import { describe, expect, it } from "vitest";
import { EffectivePermissionCache } from "../../frontend/src/lib/role-builder/effective-permission-cache";
import {
  describeOverride,
  handleApproveOverride,
  handleCreateOverride,
  handleEndOverride,
  handleListOverrides,
  handleMyEffectivePermissions,
  overrideInputSchema,
  overrideState,
  type OverridePort,
  type OverrideRow,
} from "../../frontend/src/lib/role-builder/role-overrides";
import type { CallerContext } from "../../frontend/src/lib/role-builder/role-builder-port";

const NOW = Date.parse("2026-11-28T10:00:00Z");
const future = new Date(NOW + 86_400_000).toISOString();

const fakePort = (caller: CallerContext, rows: OverrideRow[] = []) => {
  const calls: string[] = [];
  const port: OverridePort = {
    async caller() {
      return caller;
    },
    async list() {
      return rows;
    },
    async create() {
      calls.push("create");
      return "11111111-1111-4111-8111-111111111111";
    },
    async approve(id) {
      calls.push(`approve:${id}`);
    },
    async end(id) {
      calls.push(`end:${id}`);
    },
  };
  return { port, calls };
};
const admin: CallerContext = { userId: "u1", orgId: "o1", isAdmin: true };
const member: CallerContext = { userId: "u2", orgId: "o1", isAdmin: false };

describe("override input", () => {
  it("accepts each kind with exactly its own payload", () => {
    const ok = (kind: string, payload: Record<string, unknown>) =>
      overrideInputSchema.safeParse({ template: "accountant", kind, payload }).success;
    expect(ok("rename", { name: "Bursar" })).toBe(true);
    expect(ok("enable", {})).toBe(true);
    expect(ok("disable", { reason: "restructure" })).toBe(true);
    expect(ok("add_optional_permission", { permission: "fees.view" })).toBe(true);
    expect(ok("remove_optional_permission", { permission: "fees.view" })).toBe(true);
    expect(ok("scope_narrow", { scope: "campus" })).toBe(true);
    expect(ok("approval_limit", { limit_ngn: 50000 })).toBe(true);
    expect(ok("add_responsibility", { responsibility: "zz.resp" })).toBe(true);
  });
  it("refuses a payload key the kind does not accept, a bad scope, a negative limit and a short name", () => {
    const bad = (kind: string, payload: Record<string, unknown>) =>
      overrideInputSchema.safeParse({ template: "accountant", kind, payload }).success;
    expect(bad("rename", { name: "Bursar", extra: 1 })).toBe(false);
    expect(bad("enable", { x: 1 })).toBe(false);
    expect(bad("scope_narrow", { scope: "institution" })).toBe(false);
    expect(bad("approval_limit", { limit_ngn: -1 })).toBe(false);
    expect(bad("rename", { name: "x" })).toBe(false);
  });
  it("needs an end time in the future and a template code", () => {
    expect(
      overrideInputSchema.safeParse({
        template: "accountant",
        kind: "enable",
        effectiveTo: "2020-01-01T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(overrideInputSchema.safeParse({ template: "", kind: "enable" }).success).toBe(false);
  });
});

describe("override state and wording", () => {
  const base = { effectiveFrom: new Date(NOW - 1000).toISOString(), effectiveTo: null };
  it("is pending until a second person approves, then in force", () => {
    expect(overrideState({ ...base, approvedBy: null }, NOW)).toBe("pending");
    expect(overrideState({ ...base, approvedBy: "u2" }, NOW)).toBe("in_force");
  });
  it("is scheduled before its start and ended after its end, and ended wins", () => {
    expect(overrideState({ ...base, effectiveFrom: future, approvedBy: "u2" }, NOW)).toBe(
      "scheduled",
    );
    expect(
      overrideState(
        { ...base, effectiveTo: new Date(NOW - 1).toISOString(), approvedBy: null },
        NOW,
      ),
    ).toBe("ended");
  });
  it("describes each kind in one plain sentence", () => {
    expect(describeOverride("rename", { name: "Bursar" })).toBe('Rename the role to "Bursar"');
    expect(describeOverride("approval_limit", { limit_ngn: 5000 })).toContain("5,000");
    expect(describeOverride("scope_narrow", { scope: "class" })).toContain("class");
    expect(describeOverride("disable", {})).toBe("Turn the role off");
  });
});

describe("handlers", () => {
  it("lists nothing for a member and the rows with their state for an administrator", async () => {
    const row: OverrideRow = {
      id: "i1",
      template: "accountant",
      kind: "rename",
      payload: { name: "Bursar" },
      effectiveFrom: new Date(NOW - 1000).toISOString(),
      effectiveTo: null,
      createdBy: "u1",
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date(NOW - 2000).toISOString(),
      state: "ended",
    };
    expect((await handleListOverrides(fakePort(member, [row]).port, NOW)).rows).toEqual([]);
    const view = await handleListOverrides(fakePort(admin, [row]).port, NOW);
    expect(view.rows[0].state).toBe("pending");
  });
  it("refuses a member before calling the database", async () => {
    const { port, calls } = fakePort(member);
    const cache = new EffectivePermissionCache();
    await expect(
      handleCreateOverride(port, cache, {
        template: "t",
        kind: "enable",
        payload: {},
        effectiveTo: null,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(handleApproveOverride(port, cache, "x")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(handleEndOverride(port, cache, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toEqual([]);
  });
  it("drops the organization's cached permissions after every change", async () => {
    const cache = new EffectivePermissionCache({ now: () => 0 });
    const src = { epoch: async () => "e", load: async () => [] };
    const { port, calls } = fakePort(admin);
    for (const act of [
      () =>
        handleCreateOverride(port, cache, {
          template: "t",
          kind: "enable",
          payload: {},
          effectiveTo: null,
        }),
      () => handleApproveOverride(port, cache, "a"),
      () => handleEndOverride(port, cache, "b"),
    ]) {
      await cache.get("o1", "u9", src);
      expect(cache.size).toBe(1);
      await act();
      expect(cache.size).toBe(0);
    }
    expect(calls).toEqual(["create", "approve:a", "end:b"]);
  });
  it("serves the caller's own permissions through the cache", async () => {
    const cache = new EffectivePermissionCache({ now: () => 0 });
    let loads = 0;
    const source = () => ({
      epoch: async () => "e",
      load: async () => {
        loads += 1;
        return [{ permissionCode: "fees.view", kind: "mandatory", roleCodes: ["r"], scopes: null }];
      },
    });
    const { port } = fakePort(member);
    const a = await handleMyEffectivePermissions(port, source, cache);
    const b = await handleMyEffectivePermissions(port, source, cache);
    expect(a.fromCache).toBe(false);
    expect(b.fromCache).toBe(true);
    expect(loads).toBe(1);
    const none = await handleMyEffectivePermissions(
      fakePort({ userId: "u3", orgId: null, isAdmin: false }).port,
      source,
      cache,
    );
    expect(none.permissions).toEqual([]);
  });
});
