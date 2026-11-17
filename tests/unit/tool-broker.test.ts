import { describe, expect, it } from "vitest";
import {
  decideToolCall,
  type ActingContext,
  type BrokerState,
  type ToolCall,
} from "../../frontend/src/lib/tool-broker/broker";
import {
  describeBinding,
  looksLikeSecretValue,
  validateConnectorBinding,
  type ConnectorBinding,
} from "../../frontend/src/lib/tool-broker/connector-vault";
import {
  FORBIDDEN_ACTIONS,
  PLATFORM_TOOLS,
  isForbiddenAction,
  toolById,
} from "../../frontend/src/lib/tool-broker/platform-tools";
import { argsDigest, redactArgs } from "../../frontend/src/lib/tool-broker/redact.server";
import {
  EFFECT_TIER_FLOOR,
  validateToolDefinition,
  type ToolDefinition,
} from "../../frontend/src/lib/tool-broker/tool-contract";
import { ROLE_PACK_TIERS, tierRank } from "../../frontend/src/lib/twin-engine/role-pack";
import { PLATFORM_WORKFORCE_PACKS } from "../../frontend/src/lib/twin-engine/packs/platform-workforce-packs";
import type { EffectiveAutonomy } from "../../frontend/src/lib/twin-engine/autonomy-ladder";

const tool = (id: string): ToolDefinition => {
  const t = toolById(id);
  if (!t) throw new Error(`missing tool ${id}`);
  return t;
};

const binding = (connector: string, over: Partial<ConnectorBinding> = {}): ConnectorBinding => ({
  connector,
  scope: "platform",
  secretRef: `vault://${connector.split(/[.:]/)[0]}/main#v1`,
  status: "active",
  ...over,
});

const ctx = (t: ToolDefinition, over: Partial<ActingContext> = {}): ActingContext => ({
  kind: "platform_staff",
  tenantRef: "sherivs-platform",
  status: "active",
  permissions: new Set(["perm.x"]),
  capability: { id: "cap.x", tier: t.tier, requiresPermission: "perm.x", connector: t.connector },
  effective: "act_autonomously",
  ...over,
});

const state = (t: ToolDefinition, over: Partial<BrokerState> = {}): BrokerState => ({
  killSwitch: false,
  disabledTools: new Set(),
  callsThisHour: 0,
  binding: binding(t.connector),
  ...over,
});

const call: ToolCall = { idempotencyKey: "k1" };

describe("ENGINE-03 tool catalog", () => {
  it("every shipped tool validates and respects its effect floor", () => {
    expect(PLATFORM_TOOLS.length).toBeGreaterThanOrEqual(15);
    for (const t of PLATFORM_TOOLS) {
      expect(validateToolDefinition(t), t.id).toEqual([]);
      expect(tierRank(t.tier)).toBeGreaterThanOrEqual(tierRank(EFFECT_TIER_FLOOR[t.effect]));
      expect(t.tier).not.toBe("T4");
    }
    expect(new Set(PLATFORM_TOOLS.map((t) => t.id)).size).toBe(PLATFORM_TOOLS.length);
  });

  it("money, public posts, production config and access grants are T3 and platform only", () => {
    for (const t of PLATFORM_TOOLS.filter((x) =>
      ["money", "public_post", "prod_config", "access_grant", "legal"].includes(x.effect),
    )) {
      expect(t.tier, t.id).toBe("T3");
      expect(t.platformOnly, t.id).toBe(true);
    }
  });

  it("rejects mutated definitions", () => {
    const base = tool("payments.refund.issue");
    const bad: Array<[string, unknown]> = [
      ["T4 registered", { ...base, tier: "T4" }],
      ["tier below floor", { ...base, tier: "T1" }],
      ["money not platform only", { ...base, platformOnly: false }],
      ["T3 write not idempotent", { ...base, idempotent: false }],
      ["write with no effect", { ...tool("github.pr.draft"), effect: "none" }],
      ["read with effect", { ...tool("github.read"), effect: "internal_state" }],
      ["unknown key", { ...base, secret: "x" }],
      ["bad id", { ...base, id: "Bad Id" }],
    ];
    for (const [name, c] of bad) expect(validateToolDefinition(c).length, name).toBeGreaterThan(0);
  });

  it("names a T4 forbidden list and registers none of it", () => {
    for (const f of FORBIDDEN_ACTIONS) {
      expect(isForbiddenAction(f)).toBe(true);
      expect(toolById(f)).toBeUndefined();
    }
  });

  it("every connector a shipped platform pack names has a tool at or below the capability tier", () => {
    for (const pack of PLATFORM_WORKFORCE_PACKS) {
      for (const cap of pack.capabilities) {
        if (!cap.connector) continue;
        const ok = PLATFORM_TOOLS.some(
          (t) => t.connector === cap.connector && tierRank(t.tier) <= tierRank(cap.tier),
        );
        expect(ok, `${pack.code}/${cap.id} -> ${cap.connector}`).toBe(true);
      }
    }
  });
});

describe("ENGINE-03 connector vault", () => {
  it("accepts references and describes them redacted", () => {
    const b = binding("github");
    expect(validateConnectorBinding(b)).toEqual([]);
    expect(JSON.stringify(describeBinding(b))).not.toContain("main#v1");
  });

  it("rejects credential values and mis-scoped bindings", () => {
    const secrets = [
      "ghp_" + "a".repeat(30),
      "sk_live_" + "b".repeat(20),
      "Bearer " + "c".repeat(30),
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c3ludGhldGljc2ln",
      "-----BEGIN PRIVATE KEY-----",
      "AKIA" + "A".repeat(16),
      "a".repeat(40),
    ];
    for (const s of secrets) expect(looksLikeSecretValue(s), s.slice(0, 12)).toBe(true);
    for (const s of secrets) {
      expect(
        validateConnectorBinding({ ...binding("github"), secretRef: s }).length,
      ).toBeGreaterThan(0);
    }
    expect(validateConnectorBinding(binding("github", { scope: "tenant" })).length).toBeGreaterThan(
      0,
    );
    expect(
      validateConnectorBinding(binding("github", { scope: "platform", tenantRef: "t1" })).length,
    ).toBeGreaterThan(0);
    expect(
      validateConnectorBinding({ ...binding("github"), secretRef: "vault://slack/main#v1" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("ENGINE-03 broker decisions", () => {
  const code = (t: ToolDefinition, c: Partial<ActingContext>, s: Partial<BrokerState>, k = call) =>
    decideToolCall(t, ctx(t, c), state(t, s), k);

  it("executes a T0 read, even from a shadow capability", () => {
    const t = tool("github.read");
    expect(code(t, { effective: "shadow" }, {}).verdict).toBe("execute");
  });

  it("maps earned autonomy to a verdict for T1", () => {
    const t = tool("slack.post.internal");
    const want: Record<EffectiveAutonomy, string> = {
      shadow: "shadow",
      propose_only: "propose",
      act_with_approval: "queue_approval",
      act_autonomously: "execute",
    };
    for (const [e, v] of Object.entries(want)) {
      expect(code(t, { effective: e as EffectiveAutonomy }, {}).verdict, e).toBe(v);
    }
  });

  it("T3 always goes to the sheriff passkey, whatever the autonomy", () => {
    for (const id of [
      "payments.refund.issue",
      "social.post.publish",
      "vercel.deploy.request",
      "iam.access.grant",
    ]) {
      const t = tool(id);
      for (const e of [
        "shadow",
        "propose_only",
        "act_with_approval",
        "act_autonomously",
      ] as const) {
        const d = code(t, { effective: e }, {});
        expect(d.verdict, `${id}/${e}`).toBe("sheriff_passkey");
        expect(d.approver).toBe("sheriff");
      }
    }
  });

  it("denies, with the specific code, for each broken invariant", () => {
    const t = tool("slack.post.internal");
    const cases: Array<[string, ReturnType<typeof decideToolCall>]> = [
      ["kill_switch", code(t, {}, { killSwitch: true })],
      ["tool_disabled", code(t, {}, { disabledTools: new Set([t.id]) })],
      ["context_inactive", code(t, { status: "suspended" }, {})],
      ["scope_violation", code(t, { kind: "tenant_membership", tenantRef: "t1" }, {})],
      ["capability_missing", code(t, { capability: null }, {})],
      ["permission_missing", code(t, { permissions: new Set() }, {})],
      [
        "tier_exceeds_capability",
        code(
          t,
          {
            capability: {
              id: "c",
              tier: "T0",
              requiresPermission: "perm.x",
              connector: t.connector,
            },
          },
          {},
        ),
      ],
      ["binding_missing", code(t, {}, { binding: null })],
      ["binding_missing", code(t, {}, { binding: binding(t.connector, { status: "revoked" }) })],
      [
        "binding_invalid",
        code(t, {}, { binding: binding(t.connector, { secretRef: "ghp_" + "a".repeat(30) }) }),
      ],
      ["rate_limited", code(t, {}, { callsThisHour: t.maxCallsPerHour })],
      ["idempotency_required", code(t, {}, {}, { idempotencyKey: undefined })],
      ["tool_invalid", decideToolCall({ ...t, tier: "T4" }, ctx(t), state(t), call)],
    ];
    for (const [expected, d] of cases) {
      expect(d.verdict, expected).toBe("deny");
      if (expected !== "tool_invalid") expect(d.denyCode, expected).toBe(expected);
    }
  });

  it("a tenant cannot use another tenant's binding or a platform binding", () => {
    const t = tool("email.send.customer");
    const tenantCtx = { kind: "tenant_membership" as const, tenantRef: "t1" };
    expect(
      code(t, tenantCtx, { binding: binding("email", { scope: "tenant", tenantRef: "t2" }) })
        .denyCode,
    ).toBe("scope_violation");
    expect(code(t, tenantCtx, { binding: binding("email", { scope: "platform" }) }).denyCode).toBe(
      "scope_violation",
    );
    expect(
      code(t, tenantCtx, { binding: binding("email", { scope: "tenant", tenantRef: "t1" }) })
        .verdict,
    ).not.toBe("deny");
  });

  it("a capability tied to a different connector cannot be used for this tool", () => {
    const t = tool("slack.post.internal");
    const d = code(
      t,
      { capability: { id: "c", tier: "T1", requiresPermission: "perm.x", connector: "github" } },
      {},
    );
    expect(d.denyCode).toBe("capability_missing");
  });

  it("property: invariants hold over 3000 seeded random situations", () => {
    let seed = 20261114;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)] as T;
    const effs: EffectiveAutonomy[] = [
      "shadow",
      "propose_only",
      "act_with_approval",
      "act_autonomously",
    ];
    for (let i = 0; i < 3000; i++) {
      const t = pick(PLATFORM_TOOLS);
      const tenant = rnd() < 0.5;
      const c = ctx(t, {
        kind: tenant ? "tenant_membership" : "platform_staff",
        tenantRef: tenant ? "t1" : "sherivs-platform",
        effective: pick(effs),
        status: rnd() < 0.9 ? "active" : "suspended",
        permissions: rnd() < 0.9 ? new Set(["perm.x"]) : new Set(),
        capability:
          rnd() < 0.9
            ? {
                id: "c",
                tier: pick(ROLE_PACK_TIERS),
                requiresPermission: "perm.x",
                connector: t.connector,
              }
            : null,
      });
      const kill = rnd() < 0.1;
      const b =
        rnd() < 0.9
          ? binding(
              t.connector,
              rnd() < 0.5 ? { scope: "tenant", tenantRef: rnd() < 0.5 ? "t1" : "t2" } : {},
            )
          : null;
      const d = decideToolCall(t, c, state(t, { killSwitch: kill, binding: b }), call);
      if (kill) expect(d.verdict).toBe("deny");
      if (d.verdict === "execute") {
        expect(t.tier).not.toBe("T3");
        expect(t.tier).not.toBe("T4");
        expect(c.status).toBe("active");
        expect(kill).toBe(false);
        if (t.platformOnly) expect(c.kind).toBe("platform_staff");
        expect(tierRank(t.tier)).toBeLessThanOrEqual(tierRank(c.capability!.tier));
        expect(t.direction === "read" || c.effective === "act_autonomously").toBe(true);
        if (b!.scope === "tenant") expect(b!.tenantRef).toBe(c.tenantRef);
      }
      if (t.tier === "T3" && d.verdict !== "deny") expect(d.verdict).toBe("sheriff_passkey");
    }
  });
});

describe("ENGINE-03 ledger redaction", () => {
  it("drops secret keys and secret-shaped values, keeps the rest", () => {
    const out = redactArgs({
      to: "parent@example.test",
      body: "hello",
      api_key: "x",
      nested: { password: "p", note: "ok", t: "ghp_" + "z".repeat(30) },
      Authorization: "Bearer " + "q".repeat(30),
    }) as {
      to?: string;
      api_key?: unknown;
      Authorization?: unknown;
      nested: { password?: unknown; note?: string; t?: string };
    };
    expect(out.to).toBe("parent@example.test");
    expect(out.api_key).toBeUndefined();
    expect(out.Authorization).toBeUndefined();
    expect(out.nested.password).toBeUndefined();
    expect(out.nested.note).toBe("ok");
    expect(out.nested.t).toBe("[withheld]");
    expect(JSON.stringify(out)).not.toMatch(/ghp_|Bearer/);
  });

  it("bounds size and cannot pollute prototypes", () => {
    const hostile = JSON.parse(
      '{"__proto__":{"polluted":1},"constructor":{"x":1},"a":"' + "x".repeat(500) + '"}',
    );
    const out = redactArgs(hostile) as Record<string, string>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(out)).toEqual(["a"]);
    expect(out.a!.length).toBeLessThanOrEqual(201);
  });

  it("withholds recipient identifiers and template parameters from the ledger", () => {
    const out = redactArgs({
      recipientIds: ["b8e4ba26-34e0-4ddd-b227-5d1d1276cfe1"],
      templateParams: { student_name: "Example", message: "private" },
      templateRef: "attendance.notice",
    }) as Record<string, unknown>;
    expect(out.recipientIds).toBe("[withheld]");
    expect(out.templateParams).toBe("[withheld]");
    expect(out.templateRef).toBe("attendance.notice");
  });

  it("digest is stable under key order and sensitive to change", () => {
    expect(argsDigest({ a: 1, b: 2 })).toBe(argsDigest({ b: 2, a: 1 }));
    expect(argsDigest({ a: 1 })).not.toBe(argsDigest({ a: 2 }));
  });
});
