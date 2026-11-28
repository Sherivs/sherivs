import { describe, expect, it } from "vitest";
import {
  EffectivePermissionCache,
  type EffectivePermission,
  type PermissionSource,
} from "../../frontend/src/lib/role-builder/effective-permission-cache";

const row = (code: string): EffectivePermission => ({
  permissionCode: code,
  kind: "mandatory",
  roleCodes: ["r"],
  scopes: null,
});

function source(initial: { epoch: string; rows: string[] }) {
  const state = { ...initial, epochReads: 0, loads: 0, epochFails: false, loadFails: false };
  const src: PermissionSource = {
    async epoch() {
      state.epochReads += 1;
      if (state.epochFails) throw new Error("epoch down");
      return state.epoch;
    },
    async load() {
      state.loads += 1;
      if (state.loadFails) throw new Error("load down");
      return state.rows.map(row);
    },
  };
  return { src, state };
}

describe("EffectivePermissionCache", () => {
  it("loads once and then serves from cache while the epoch holds", async () => {
    let t = 0;
    const cache = new EffectivePermissionCache({ ttlMs: 1000, now: () => t });
    const { src, state } = source({ epoch: "1:0:0:", rows: ["a.view"] });
    const first = await cache.get("o", "u", src);
    t = 500;
    const second = await cache.get("o", "u", src);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(state.loads).toBe(1);
    expect(second.permissions.map((p) => p.permissionCode)).toEqual(["a.view"]);
  });

  it("reloads when the override epoch moves", async () => {
    const cache = new EffectivePermissionCache({ ttlMs: 10_000, now: () => 0 });
    const { src, state } = source({ epoch: "1:0:0:", rows: ["a.view"] });
    await cache.get("o", "u", src);
    state.epoch = "1:1:0:x";
    state.rows = ["a.view", "b.edit"];
    const next = await cache.get("o", "u", src);
    expect(next.fromCache).toBe(false);
    expect(next.permissions).toHaveLength(2);
    expect(state.loads).toBe(2);
  });

  it("reloads after the time limit even if the epoch is unchanged", async () => {
    let t = 0;
    const cache = new EffectivePermissionCache({ ttlMs: 1000, now: () => t });
    const { src, state } = source({ epoch: "e", rows: ["a"] });
    await cache.get("o", "u", src);
    t = 1000;
    const next = await cache.get("o", "u", src);
    expect(next.fromCache).toBe(false);
    expect(state.loads).toBe(2);
  });

  it("fails closed: an unreadable epoch forces a reload, and a failed reload throws instead of serving stale rows", async () => {
    const cache = new EffectivePermissionCache({ ttlMs: 10_000, now: () => 0 });
    const { src, state } = source({ epoch: "e", rows: ["a"] });
    await cache.get("o", "u", src);
    state.epochFails = true;
    await expect(cache.get("o", "u", src)).rejects.toThrow("epoch down");
    state.epochFails = false;
    state.loadFails = true;
    state.epoch = "e2";
    await expect(cache.get("o", "u", src)).rejects.toThrow("load down");
  });

  it("keeps people and organizations apart", async () => {
    const cache = new EffectivePermissionCache({ now: () => 0 });
    const a = source({ epoch: "e", rows: ["a"] });
    const b = source({ epoch: "e", rows: ["b"] });
    expect((await cache.get("o", "u1", a.src)).permissions[0].permissionCode).toBe("a");
    expect((await cache.get("o", "u2", b.src)).permissions[0].permissionCode).toBe("b");
    expect((await cache.get("o2", "u1", b.src)).permissions[0].permissionCode).toBe("b");
  });

  it("invalidates one user, or a whole organization", async () => {
    const cache = new EffectivePermissionCache({ now: () => 0 });
    const { src, state } = source({ epoch: "e", rows: ["a"] });
    await cache.get("o", "u1", src);
    await cache.get("o", "u2", src);
    await cache.get("p", "u1", src);
    cache.invalidateUser("o", "u1");
    expect(cache.size).toBe(2);
    cache.invalidateOrg("o");
    expect(cache.size).toBe(1);
    await cache.get("o", "u2", src);
    expect(state.loads).toBe(4);
  });

  it("evicts the least recently used entry beyond its size", async () => {
    const cache = new EffectivePermissionCache({ maxEntries: 2, now: () => 0 });
    const { src } = source({ epoch: "e", rows: ["a"] });
    await cache.get("o", "u1", src);
    await cache.get("o", "u2", src);
    await cache.get("o", "u1", src);
    await cache.get("o", "u3", src);
    expect(cache.size).toBe(2);
    const again = await cache.get("o", "u2", src);
    expect(again.fromCache).toBe(false);
  });

  it("shares one read between concurrent callers", async () => {
    const cache = new EffectivePermissionCache({ now: () => 0 });
    const { src, state } = source({ epoch: "e", rows: ["a"] });
    await Promise.all([
      cache.get("o", "u", src),
      cache.get("o", "u", src),
      cache.get("o", "u", src),
    ]);
    expect(state.loads).toBe(1);
  });

  it("returns frozen rows so a caller cannot change the cache", async () => {
    const cache = new EffectivePermissionCache({ now: () => 0 });
    const { src } = source({ epoch: "e", rows: ["a"] });
    const result = await cache.get("o", "u", src);
    expect(Object.isFrozen(result.permissions)).toBe(true);
    expect(Object.isFrozen(result.permissions[0])).toBe(true);
  });

  it("rejects missing keys and bad options", async () => {
    expect(() => new EffectivePermissionCache({ ttlMs: 0 })).toThrow();
    const { src } = source({ epoch: "e", rows: [] });
    await expect(new EffectivePermissionCache().get("", "u", src)).rejects.toThrow();
  });
});
