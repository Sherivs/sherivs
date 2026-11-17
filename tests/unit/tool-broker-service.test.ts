import { describe, expect, it } from "vitest";
import type { ActingContext, BrokerState } from "../../frontend/src/lib/tool-broker/broker";
import {
  brokerToolCall,
  type AuthorityPort,
  type DecisionRecord,
  type LedgerPort,
} from "../../frontend/src/lib/tool-broker/broker-service.server";
import { toolById } from "../../frontend/src/lib/tool-broker/platform-tools";

const tool = toolById("slack.post.internal")!;
const ctx: ActingContext = {
  kind: "platform_staff",
  tenantRef: "sherivs-platform",
  status: "active",
  permissions: new Set(["p"]),
  capability: { id: "c", tier: "T1", requiresPermission: "p", connector: "slack" },
  effective: "act_autonomously",
};
const state: BrokerState = {
  killSwitch: false,
  disabledTools: new Set(),
  callsThisHour: 0,
  binding: {
    connector: "slack",
    scope: "platform",
    secretRef: "vault://slack/main#v1",
    status: "active",
  },
};

function memory(opts: { failAppend?: boolean } = {}) {
  const rows: Array<DecisionRecord & { key?: string; redacted: unknown }> = [];
  const ledger: LedgerPort = {
    async findDecision({ idempotencyKey }) {
      return rows.find((r) => r.key === idempotencyKey) ?? null;
    },
    async appendDecision(i) {
      if (opts.failAppend) throw new Error("boom: password=hunter2");
      const id = `row-${rows.length + 1}`;
      rows.push({
        id,
        decision: i.decision,
        argsDigest: i.argsDigest,
        key: i.idempotencyKey,
        redacted: i.argsRedacted,
      });
      return { id };
    },
  };
  let resolved = 0;
  const authority: AuthorityPort = {
    async resolve({ twinContextId }) {
      resolved++;
      return twinContextId === "ctx-1" ? { ctx, state } : null;
    },
  };
  return { rows, ports: { ledger, authority }, resolved: () => resolved };
}

describe("ENGINE-03 broker service", () => {
  it("decides, then records the decision with a redacted summary", async () => {
    const m = memory();
    const r = await brokerToolCall(m.ports, {
      twinContextId: "ctx-1",
      tool,
      args: { channel: "ops", api_key: "never", text: "hi" },
      idempotencyKey: "k1",
    });
    expect(r).toMatchObject({ ok: true, replayed: false, decision: { verdict: "execute" } });
    expect(m.rows).toHaveLength(1);
    expect(JSON.stringify(m.rows[0]!.redacted)).not.toContain("never");
  });

  it("replays the same key and arguments without deciding again", async () => {
    const m = memory();
    const req = { twinContextId: "ctx-1", tool, args: { text: "hi" }, idempotencyKey: "k1" };
    await brokerToolCall(m.ports, req);
    const again = await brokerToolCall(m.ports, req);
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(m.rows).toHaveLength(1);
    expect(m.resolved()).toBe(1);
  });

  it("refuses the same key with different arguments", async () => {
    const m = memory();
    await brokerToolCall(m.ports, {
      twinContextId: "ctx-1",
      tool,
      args: { text: "a" },
      idempotencyKey: "k1",
    });
    const r = await brokerToolCall(m.ports, {
      twinContextId: "ctx-1",
      tool,
      args: { text: "b" },
      idempotencyKey: "k1",
    });
    expect(r).toMatchObject({ ok: true, replayed: true, decision: { verdict: "deny" } });
    expect(m.rows).toHaveLength(1);
  });

  it("an unknown context is refused and nothing is recorded", async () => {
    const m = memory();
    const r = await brokerToolCall(m.ports, {
      twinContextId: "nope",
      tool,
      args: {},
      idempotencyKey: "k",
    });
    expect(r).toEqual({ ok: false, error: "unknown_context" });
    expect(m.rows).toHaveLength(0);
  });

  it("fails closed when the ledger is down and does not echo the error", async () => {
    const m = memory({ failAppend: true });
    const r = await brokerToolCall(m.ports, {
      twinContextId: "ctx-1",
      tool,
      args: {},
      idempotencyKey: "k",
    });
    expect(r).toEqual({ ok: false, error: "ledger_unavailable" });
    expect(JSON.stringify(r)).not.toContain("hunter2");
  });

  it("records denials too", async () => {
    const m = memory();
    const denied = { ...state, killSwitch: true };
    m.ports.authority.resolve = async () => ({ ctx, state: denied });
    const r = await brokerToolCall(m.ports, {
      twinContextId: "ctx-1",
      tool,
      args: {},
      idempotencyKey: "kd",
    });
    expect(r).toMatchObject({ ok: true, decision: { verdict: "deny", denyCode: "kill_switch" } });
    expect(m.rows).toHaveLength(1);
  });
});
