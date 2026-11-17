import { describe, expect, it } from "vitest";
import { DEFAULT_ESCALATION_CONFIG } from "../../frontend/src/lib/jarvis/inbox-escalation";
import {
  planAlertDelivery,
  type OwnerLiveAuthorization,
} from "../../frontend/src/lib/jarvis-bridge/alert-delivery";
import { SEVERITIES, type Severity } from "../../frontend/src/lib/jarvis-executive/severity";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const input = (severity: Severity, over: Record<string, unknown> = {}) => ({
  severity,
  title: "Deploy failed",
  consoleOrigin: "https://console.sherivs.com",
  consolePath: "/inbox/appr-1",
  nowMs: NOW,
  quiet: null,
  lastSentMs: null,
  sentInLastHour: 0,
  alertId: "alert-1",
  ...over,
});
const off = { whatsapp: false, voice: false } as const;
const on = { whatsapp: true, voice: true } as const;
const auth = (over: Partial<OwnerLiveAuthorization> = {}): OwnerLiveAuthorization => ({
  approvalRef: "ap-1",
  approvedBy: "human:sheriff-1",
  channels: ["whatsapp", "voice"],
  expiresAt: "2026-11-15T13:00:00.000Z",
  ...over,
});
const channels = (p: ReturnType<typeof planAlertDelivery>) =>
  p.send ? p.deliveries.map((d) => d.channel) : [];

describe("ENGINE-09 alert delivery through the JARVIS gates", () => {
  it("delivers to the console only when no external channel is enabled, and says why the rest were skipped", () => {
    const p = planAlertDelivery(input("S1"), { mode: "test", ownerEnabled: off });
    expect(p.send).toBe(true);
    if (!p.send) return;
    expect(p.deliveries).toEqual([
      { channel: "console", destination: { kind: "in_app" }, idempotencyKey: "alert-1:console" },
    ]);
    expect(p.skipped).toEqual([
      { channel: "voice", code: "channel_not_enabled" },
      { channel: "whatsapp", code: "channel_not_enabled" },
      { channel: "sms", code: "channel_not_enabled" },
      { channel: "email", code: "channel_not_enabled" },
    ]);
  });

  it("in test mode routes enabled external channels to synthetic sinks, never a contact", () => {
    const p = planAlertDelivery(input("S1"), { mode: "test", ownerEnabled: on });
    expect(channels(p)).toEqual(["voice", "whatsapp", "console"]);
    if (!p.send) return;
    expect(p.deliveries.filter((d) => d.destination.kind === "registered_contact")).toHaveLength(0);
    expect(p.deliveries[0]).toMatchObject({
      destination: { kind: "test_sink", sink: "test-sink:voice" },
      idempotencyKey: "alert-1:voice",
    });
  });

  it("in live mode needs an unexpired authorization that names the channel and an approver", () => {
    const cfg = { mode: "live" as const, ownerEnabled: on };
    const ok = planAlertDelivery(input("S2"), cfg, auth());
    expect(channels(ok)).toEqual(["whatsapp", "console"]);
    if (ok.send) expect(ok.deliveries[0]!.destination).toEqual({ kind: "registered_contact" });

    const bad: Array<[string, OwnerLiveAuthorization | undefined]> = [
      ["none", undefined],
      ["expired", auth({ expiresAt: "2026-11-15T11:59:59.000Z" })],
      ["expires now", auth({ expiresAt: "2026-11-15T12:00:00.000Z" })],
      ["other channel", auth({ channels: ["voice"] })],
      ["no ref", auth({ approvalRef: " " })],
      ["no approver", auth({ approvedBy: "" })],
    ];
    for (const [name, a] of bad) {
      const p = planAlertDelivery(input("S2"), cfg, a);
      expect(channels(p), name).toEqual(["console"]);
      if (p.send)
        expect(p.skipped, name).toContainEqual({
          channel: "whatsapp",
          code: "external_send_not_authorized",
        });
    }
  });

  it("owner enablement is required even with a live authorization", () => {
    const p = planAlertDelivery(input("S2"), { mode: "live", ownerEnabled: off }, auth());
    expect(channels(p)).toEqual(["console"]);
    if (p.send)
      expect(p.skipped).toContainEqual({ channel: "whatsapp", code: "channel_not_enabled" });
  });

  it("delivers by SMS and email only when each is enabled, and in live mode each is named in the authorization", () => {
    const all = { whatsapp: true, voice: true, sms: true, email: true } as const;
    // Enabled in test mode: synthetic sinks.
    const t = planAlertDelivery(input("S1"), { mode: "test", ownerEnabled: all });
    expect(channels(t)).toEqual(["voice", "whatsapp", "sms", "email", "console"]);
    // Live, authorization names only voice and whatsapp: sms and email are refused.
    const l = planAlertDelivery(input("S1"), { mode: "live", ownerEnabled: all }, auth());
    expect(channels(l)).toEqual(["voice", "whatsapp", "console"]);
    if (l.send) {
      expect(l.skipped).toEqual([
        { channel: "sms", code: "external_send_not_authorized" },
        { channel: "email", code: "external_send_not_authorized" },
      ]);
    }
    // Live, authorization names all four and is unexpired: all go to the registered contact.
    const full = auth({ channels: ["voice", "whatsapp", "sms", "email"] });
    const f = planAlertDelivery(input("S1"), { mode: "live", ownerEnabled: all }, full);
    expect(channels(f)).toEqual(["voice", "whatsapp", "sms", "email", "console"]);
    // An expired authorization refuses every external channel.
    const e = planAlertDelivery(
      input("S1"),
      { mode: "live", ownerEnabled: all },
      { ...full, expiresAt: "2026-11-15T11:00:00.000Z" },
    );
    expect(channels(e)).toEqual(["console"]);
    // S3 and S4 never reach an external channel.
    for (const s of ["S3", "S4"] as const)
      expect(
        channels(planAlertDelivery(input(s), { mode: "live", ownerEnabled: all }, full)),
      ).toEqual(["console"]);
    expect(SEVERITIES).toHaveLength(4);
  });

  it("S3 and S4 stay on the console", () => {
    for (const s of ["S3", "S4"] as const) {
      const p = planAlertDelivery(input(s), { mode: "live", ownerEnabled: on }, auth());
      expect(channels(p)).toEqual(["console"]);
      if (p.send) expect(p.skipped).toEqual([]);
    }
  });

  it("keeps the ENGINE-04 content rules: dedupe, rate limit, unsafe link, quiet hours with S1 break-through", () => {
    const cfg = { mode: "test" as const, ownerEnabled: on };
    expect(planAlertDelivery(input("S2", { lastSentMs: NOW - 60_000 }), cfg)).toEqual({
      send: false,
      reason: "deduped",
    });
    expect(planAlertDelivery(input("S4", { sentInLastHour: 1 }), cfg)).toEqual({
      send: false,
      reason: "rate_limited",
    });
    expect(planAlertDelivery(input("S2", { consolePath: "/inbox?approve=yes" }), cfg)).toEqual({
      send: false,
      reason: "unsafe_link",
    });
    const quiet = { startHour: 11, endHour: 13, utcOffsetMinutes: 0 };
    expect(planAlertDelivery(input("S2", { quiet }), cfg)).toEqual({
      send: false,
      reason: "quiet_hours",
    });
    expect(planAlertDelivery(input("S1", { quiet }), cfg).send).toBe(true);
  });

  it("carries the safe body and link through unchanged", () => {
    const p = planAlertDelivery(input("S1"), { mode: "test", ownerEnabled: off });
    if (!p.send) throw new Error("expected send");
    expect(p.link).toBe("https://console.sherivs.com/inbox/appr-1");
    expect(p.body).toContain("[S1] Deploy failed");
    expect(p.body).not.toMatch(/approve|code=|token=/i);
  });

  it("works with the JARVIS default escalation config (test mode, owner channels off)", () => {
    const p = planAlertDelivery(input("S1"), DEFAULT_ESCALATION_CONFIG);
    expect(channels(p)).toEqual(["console"]);
  });

  it("property: no registered contact is ever planned without enablement and, in live mode, authorization", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let i = 0; i < 1500; i++) {
      const s = SEVERITIES[Math.floor(rnd() * 4)] as Severity;
      const mode = rnd() < 0.5 ? "test" : "live";
      const ownerEnabled = { whatsapp: rnd() < 0.5, voice: rnd() < 0.5 };
      const a =
        rnd() < 0.6
          ? auth({
              channels: rnd() < 0.5 ? ["whatsapp"] : ["whatsapp", "voice"],
              expiresAt: rnd() < 0.7 ? "2026-11-15T13:00:00.000Z" : "2026-11-15T11:00:00.000Z",
            })
          : undefined;
      const p = planAlertDelivery(input(s), { mode, ownerEnabled }, a);
      if (!p.send) continue;
      for (const d of p.deliveries) {
        if (d.channel === "console") continue;
        expect(d.channel).not.toBe("sms");
        expect(ownerEnabled[d.channel as "whatsapp" | "voice"]).toBe(true);
        if (mode === "test") expect(d.destination.kind).toBe("test_sink");
        else {
          expect(d.destination.kind).toBe("registered_contact");
          expect(a?.channels).toContain(d.channel);
          expect(Date.parse(a!.expiresAt)).toBeGreaterThan(NOW);
        }
      }
    }
  });
});
