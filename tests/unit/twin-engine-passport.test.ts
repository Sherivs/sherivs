/**
 * ENGINE-01 — passport view and pack registry operations.
 */
import { describe, expect, it } from "vitest";
import {
  buildPassportView,
  type TwinContextRow,
} from "../../frontend/src/lib/twin-engine/passport-view";
import {
  publishRolePack,
  reconcileTwins,
  type RegistryClient,
} from "../../frontend/src/lib/twin-engine/pack-registry.server";
import { TENANT_ROLE_PACKS } from "../../frontend/src/lib/scholar/role-packs/tenant-role-packs";

const TEACHER = TENANT_ROLE_PACKS.find((p) => p.code === "teacher")!;
const person = { id: "tw-1", identity_id: "id-1", status: "active" };
const ctx = (over: Partial<TwinContextRow> = {}): TwinContextRow => ({
  id: "ctx-1",
  context_kind: "tenant_membership",
  tenant_ref: "t-a",
  role_code: "teacher",
  status: "active",
  pack_code: "teacher",
  pack_version: "1.0.0",
  ...over,
});
const pack = { code: "teacher", version: "1.0.0", definition: TEACHER };

describe("buildPassportView", () => {
  it("active context with no trust rows is fully in shadow", () => {
    const v = buildPassportView({ person, contexts: [ctx()], trust: [], packs: [pack] });
    const caps = v.contexts[0]!.capabilities;
    expect(caps.length).toBe(TEACHER.capabilities.length);
    for (const c of caps) expect(c.effective).toBe("shadow");
  });

  it("earned trust raises effective autonomy but never above the pack or tier caps", () => {
    const trust = TEACHER.capabilities.map((c) => ({
      context_id: "ctx-1",
      capability_id: c.id,
      state: "autonomous",
      sheriff_promotion_id: null,
    }));
    const caps = buildPassportView({ person, contexts: [ctx()], trust, packs: [pack] }).contexts[0]!
      .capabilities;
    const by = (id: string) => caps.find((c) => c.id === id)!;
    expect(by("draft.lesson.plan").effective).toBe("act_autonomously");
    expect(by("mark.attendance").effective).toBe("act_with_approval");
    expect(by("message.parents").effective).toBe("act_with_approval");
  });

  it("a sheriff promotion lifts only a promotable T2 capability", () => {
    const trust = [
      {
        context_id: "ctx-1",
        capability_id: "message.parents",
        state: "autonomous",
        sheriff_promotion_id: "promo-1",
      },
    ];
    const caps = buildPassportView({ person, contexts: [ctx()], trust, packs: [pack] }).contexts[0]!
      .capabilities;
    expect(caps.find((c) => c.id === "message.parents")!.effective).toBe("act_autonomously");
  });

  it("suspended and pending contexts expose no capabilities", () => {
    const v = buildPassportView({
      person,
      contexts: [
        ctx({ id: "c2", status: "suspended" }),
        ctx({ id: "c3", status: "pending_pack", pack_code: null, pack_version: null }),
      ],
      trust: [],
      packs: [pack],
    });
    for (const c of v.contexts) expect(c.capabilities).toEqual([]);
  });

  it("an invalid or missing pack definition fails closed", () => {
    const bad = { ...pack, definition: { ...TEACHER, startsInShadow: false } };
    expect(
      buildPassportView({ person, contexts: [ctx()], trust: [], packs: [bad] }).contexts[0]!
        .capabilities,
    ).toEqual([]);
    expect(
      buildPassportView({ person, contexts: [ctx()], trust: [], packs: [] }).contexts[0]!
        .capabilities,
    ).toEqual([]);
  });

  it("an unknown trust state is treated as shadow", () => {
    const trust = [
      {
        context_id: "ctx-1",
        capability_id: "draft.lesson.plan",
        state: "godmode",
        sheriff_promotion_id: null,
      },
    ];
    const c = buildPassportView({
      person,
      contexts: [ctx()],
      trust,
      packs: [pack],
    }).contexts[0]!.capabilities.find((x) => x.id === "draft.lesson.plan")!;
    expect(c.effective).toBe("shadow");
    expect(c.trustState).toBe("shadow");
  });

  it("one person with two memberships yields one passport with two isolated contexts", () => {
    const v = buildPassportView({
      person,
      contexts: [
        ctx(),
        ctx({
          id: "ctx-2",
          tenant_ref: "t-b",
          role_code: "parent",
          pack_code: null,
          pack_version: null,
          status: "pending_pack",
        }),
      ],
      trust: [],
      packs: [pack],
    });
    expect(v.contexts.map((c) => c.contextId)).toEqual(["ctx-1", "ctx-2"]);
    expect(v.twinId).toBe("tw-1");
  });
});

describe("pack registry", () => {
  const recorder = (error: { message: string } | null = null) => {
    const inserted: Record<string, unknown>[] = [];
    const client: RegistryClient = {
      from: () => ({
        insert: async (row) => {
          inserted.push(row);
          return { error };
        },
      }),
      rpc: async () => ({ data: { contexts_ensured: 4, contexts_bound: 2 }, error: null }),
    };
    return { client, inserted };
  };

  it("an invalid pack never reaches the database", async () => {
    const { client, inserted } = recorder();
    const r = await publishRolePack(client, { ...TEACHER, startsInShadow: false });
    expect(r).toMatchObject({ ok: false, stage: "validation" });
    expect(inserted).toEqual([]);
  });
  it("a valid pack is published with its identity columns", async () => {
    const { client, inserted } = recorder();
    const r = await publishRolePack(client, TEACHER);
    expect(r.ok).toBe(true);
    expect(inserted[0]).toMatchObject({
      code: "teacher",
      version: "1.0.0",
      kind: "tenant_role",
      status: "published",
      applies_to: ["teacher"],
    });
  });
  it("a database refusal is surfaced, not swallowed", async () => {
    const { client } = recorder({ message: "role pack immutable" });
    expect(await publishRolePack(client, TEACHER)).toMatchObject({
      ok: false,
      stage: "database",
      findings: ["role pack immutable"],
    });
  });
  it("reconcile reports counts and raises on error", async () => {
    const { client } = recorder();
    expect(await reconcileTwins(client)).toEqual({ contextsEnsured: 4, contextsBound: 2 });
    await expect(
      reconcileTwins({ rpc: async () => ({ data: null, error: { message: "boom" } }) }),
    ).rejects.toThrow("boom");
  });
});
