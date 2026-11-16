import { describe, expect, it } from "vitest";
import {
  MAX_SIGNALS_PER_TICK,
  RETRY_BUCKET_MS,
  consolePathFor,
  runOwnerAlertTick,
  type OwnerSignal,
  type SendRequest,
  type TickConfig,
  type TickPorts,
} from "../../frontend/src/lib/jarvis-bridge/owner-alert-tick";
import type { OwnerExternalChannel } from "../../frontend/src/lib/jarvis-bridge/alert-delivery";
import type { SeverityFacts } from "../../frontend/src/lib/jarvis-executive/severity";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const ORIGIN = "https://console.sherivs.com";
const ALL = { voice: true, whatsapp: true, sms: true, email: true } as const;

const incident: SeverityFacts = {
  tier: "T1",
  scope: "platform",
  reversible: false,
  securityIncident: true,
  customerVisible: true,
};
const lowRisk: SeverityFacts = {
  tier: "T1",
  scope: "single_user",
  reversible: true,
  securityIncident: false,
  customerVisible: false,
};

const signal = (key: string, facts: SeverityFacts, title = "Deploy failed"): OwnerSignal => ({
  key,
  source: "test",
  title,
  facts,
});

interface Rig {
  ports: TickPorts;
  sent: SendRequest[];
  deliveries: Map<
    string,
    {
      alertId: string;
      channel: string;
      kind: string;
      status: string;
      reason: string | null;
      at: number;
    }
  >;
  alerts: Map<
    string,
    { id: string; status: "open" | "acknowledged" | "resolved"; severity: string }
  >;
  clock: { ms: number };
}

function rig(
  signals: OwnerSignal[],
  cfg: TickConfig | null,
  over: Partial<{
    paused: boolean | "throw";
    send: TickPorts["send"];
    signalsThrow: boolean;
  }> = {},
): Rig {
  const clock = { ms: NOW };
  const sent: SendRequest[] = [];
  const deliveries: Rig["deliveries"] = new Map();
  const alerts: Rig["alerts"] = new Map();
  let n = 0;
  const ports: TickPorts = {
    nowMs: () => clock.ms,
    isPaused: async () => {
      if (over.paused === "throw") throw new Error("db down");
      return over.paused === true;
    },
    loadConfig: async () => cfg,
    readSignals: async () => {
      if (over.signalsThrow) throw new Error("db down");
      return signals;
    },
    upsertAlert: async (i) => {
      const existing = alerts.get(i.dedupeKey);
      if (existing) return { id: existing.id, status: existing.status };
      n += 1;
      const row = { id: `alert-${n}`, status: "open" as const, severity: i.severity };
      alerts.set(i.dedupeKey, row);
      return { id: row.id, status: row.status };
    },
    history: async (key, severity) => {
      const a = alerts.get(key);
      const ids = new Set(
        [...alerts.values()].filter((x) => x.severity === severity).map((x) => x.id),
      );
      let last: number | null = null;
      let count = 0;
      for (const d of deliveries.values()) {
        if (d.status !== "sent" || d.channel === "console") continue;
        if (a && d.alertId === a.id) last = Math.max(last ?? 0, d.at);
        if (ids.has(d.alertId) && clock.ms - d.at < 3_600_000) count += 1;
      }
      return { lastSentMs: last, sentInLastHour: count };
    },
    claimDelivery: async (i) => {
      if (deliveries.has(i.idempotencyKey)) return false;
      deliveries.set(i.idempotencyKey, {
        alertId: i.alertId,
        channel: i.channel,
        kind: i.destinationKind,
        status: "claimed",
        reason: null,
        at: clock.ms,
      });
      return true;
    },
    finishDelivery: async (i) => {
      const d = deliveries.get(i.idempotencyKey)!;
      d.status = i.status;
      d.reason = i.reasonCode;
    },
    send:
      over.send ??
      (async (r) => {
        sent.push(r);
        return { ok: true, providerRef: "prov-1" };
      }),
  };
  return { ports, sent, deliveries, alerts, clock };
}

const testCfg = (over: Partial<TickConfig> = {}): TickConfig => ({
  config: { mode: "test", ownerEnabled: ALL },
  quiet: null,
  consoleOrigin: ORIGIN,
  ...over,
});
const liveCfg = (
  channels: readonly OwnerExternalChannel[] = ["voice", "whatsapp", "sms", "email"],
): TickConfig => ({
  config: { mode: "live", ownerEnabled: ALL },
  authorization: {
    approvalRef: "owner-chat-2026-11-16",
    approvedBy: "human:sheriff-1",
    channels: [...channels],
    expiresAt: "2026-11-16T18:00:00.000Z",
  },
  quiet: null,
  consoleOrigin: ORIGIN,
});

describe("owner-alert tick: refuses to run unsafely", () => {
  it("does nothing while JARVIS is paused, and fails closed when the pause state is unreadable", async () => {
    for (const paused of [true, "throw"] as const) {
      const r = rig([signal("incident:1", incident)], testCfg(), { paused });
      const out = await runOwnerAlertTick(r.ports);
      expect(out.status).toBe("paused");
      expect(r.alerts.size).toBe(0);
      expect(r.sent).toHaveLength(0);
    }
  });

  it("reports not_configured without a config or console origin", async () => {
    expect((await runOwnerAlertTick(rig([], null).ports)).status).toBe("not_configured");
    expect((await runOwnerAlertTick(rig([], testCfg({ consoleOrigin: null })).ports)).status).toBe(
      "not_configured",
    );
  });

  it("survives an unreadable signal source", async () => {
    const out = await runOwnerAlertTick(rig([], testCfg(), { signalsThrow: true }).ports);
    expect(out.status).toBe("signals_unavailable");
    expect(out.errors).toContain("signals_unavailable");
  });
});

describe("owner-alert tick: test mode never leaves the system", () => {
  it("writes console and test-sink rows for every enabled channel and never calls the sender", async () => {
    const r = rig([signal("incident:1", incident)], testCfg());
    const out = await runOwnerAlertTick(r.ports);
    expect(out.status).toBe("ok");
    expect(r.sent).toHaveLength(0);
    expect(out.delivered).toEqual({
      "voice:test_sink": 1,
      "whatsapp:test_sink": 1,
      "sms:test_sink": 1,
      "email:test_sink": 1,
      "console:in_app": 1,
    });
    expect([...r.deliveries.values()].every((d) => d.kind !== "registered_contact")).toBe(true);
  });
});

describe("owner-alert tick: live mode", () => {
  it("skips external channels with a reason when there is no authorization, and sends none", async () => {
    const r = rig([signal("incident:1", incident)], {
      ...liveCfg(),
      authorization: undefined,
    });
    const out = await runOwnerAlertTick(r.ports);
    expect(r.sent).toHaveLength(0);
    expect(out.skipped).toEqual({
      "voice:external_send_not_authorized": 1,
      "whatsapp:external_send_not_authorized": 1,
      "sms:external_send_not_authorized": 1,
      "email:external_send_not_authorized": 1,
    });
    expect(out.delivered).toEqual({ "console:in_app": 1 });
  });

  it("sends only the channels the authorization names, with a safe link and no secret material", async () => {
    const r = rig([signal("incident:1", incident)], liveCfg(["whatsapp", "email"]));
    const out = await runOwnerAlertTick(r.ports);
    expect(r.sent.map((s) => s.channel).sort()).toEqual(["email", "whatsapp"]);
    for (const s of r.sent) {
      const url = new URL(s.link);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/console/alerts");
      expect([...url.searchParams.keys()]).toEqual(["ref"]);
      expect(s.body).toContain(s.link);
      expect(s.body).not.toMatch(/approve|token|secret|otp/i);
    }
    expect(out.skipped).toMatchObject({
      "voice:external_send_not_authorized": 1,
      "sms:external_send_not_authorized": 1,
    });
  });

  it("records a failed send by code, and a throwing sender cannot break the tick", async () => {
    const failing = rig([signal("incident:1", incident)], liveCfg(), {
      send: async () => ({ ok: false, code: "not_configured" }),
    });
    const a = await runOwnerAlertTick(failing.ports);
    expect(a.failed["sms:not_configured"]).toBe(1);
    expect(a.status).toBe("ok");

    const throwing = rig([signal("incident:2", incident)], liveCfg(), {
      send: async () => {
        throw new Error("boom with +2348000000000");
      },
    });
    const b = await runOwnerAlertTick(throwing.ports);
    expect(b.failed["voice:sender_threw"]).toBe(1);
    expect(JSON.stringify(b)).not.toContain("+234");
  });

  it("withholds a secret-shaped title instead of sending it", async () => {
    const r = rig(
      [signal("incident:1", incident, "key " + ["sk", "live", "abcdefghijklmnopqrstuvwxyz123456"].join("_") + "")],
      liveCfg(["email"]),
    );
    await runOwnerAlertTick(r.ports);
    expect(r.sent[0]?.body).toContain("[withheld]");
    expect(r.sent[0]?.body).not.toContain("sk_live");
  });
});

describe("owner-alert tick: dedupe, retries and owner decisions", () => {
  it("does not resend inside the dedupe window, but retries after the bucket when still open", async () => {
    const r = rig([signal("incident:1", incident)], liveCfg(["email"]));
    await runOwnerAlertTick(r.ports);
    expect(r.sent).toHaveLength(1);
    r.clock.ms += 60_000;
    const again = await runOwnerAlertTick(r.ports);
    expect(r.sent).toHaveLength(1);
    expect(again.suppressed["deduped"]).toBe(1);
    r.clock.ms += RETRY_BUCKET_MS;
    await runOwnerAlertTick(r.ports);
    expect(r.sent).toHaveLength(2);
  });

  it("does not claim the same delivery twice when ticks overlap", async () => {
    const r = rig([signal("incident:1", incident)], liveCfg(["email"]));
    const claim = r.ports.claimDelivery;
    let calls = 0;
    r.ports.claimDelivery = async (i) => {
      calls += 1;
      return i.channel === "email" ? false : claim(i);
    };
    const out = await runOwnerAlertTick(r.ports);
    expect(calls).toBeGreaterThan(0);
    expect(r.sent).toHaveLength(0);
    expect(out.suppressed["already_claimed"]).toBe(1);
  });

  it("leaves an acknowledged or resolved alert alone", async () => {
    const r = rig([signal("incident:1", incident)], liveCfg());
    await runOwnerAlertTick(r.ports);
    const sentBefore = r.sent.length;
    r.alerts.get("incident:1")!.status = "acknowledged";
    r.clock.ms += RETRY_BUCKET_MS * 2;
    const out = await runOwnerAlertTick(r.ports);
    expect(r.sent).toHaveLength(sentBefore);
    expect(out.suppressed["not_open"]).toBe(1);
  });

  it("alerts the most severe signals first and caps the work per tick", async () => {
    const many = Array.from({ length: MAX_SIGNALS_PER_TICK + 10 }, (_, i) =>
      signal(`low:${i}`, lowRisk),
    );
    const r = rig([...many, signal("incident:1", incident)], testCfg());
    const out = await runOwnerAlertTick(r.ports);
    expect(out.signals).toBe(MAX_SIGNALS_PER_TICK + 11);
    expect(r.alerts.size).toBe(MAX_SIGNALS_PER_TICK);
    expect(r.alerts.has("incident:1")).toBe(true);
  });

  it("builds a console path that the link guard accepts", () => {
    expect(consolePathFor("approval:abc-1")).toBe("/console/alerts?ref=approval%3Aabc-1");
  });
});
