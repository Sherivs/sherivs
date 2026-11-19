/**
 * M22 (ADR-120): the SMS fabric dispatcher re-checks consent and quiet hours at send time, records delivery evidence
 * for every attempt and refusal, never meters (the charge is taken once, at queue time, by comms_send/meter_usage), and
 * never sends a row twice. Nothing here can send a real message: fetch is mocked and credentials are sentinels.
 */
import { describe, expect, it, vi } from "vitest";
import { dispatchQueuedSms } from "../../../frontend/src/lib/communications/sms-fabric.server";
import { selectSmsGateway } from "../../../frontend/src/lib/communications/sms-gateway.server";
import { checkSendTimeConsent } from "../../../frontend/src/lib/communications/send-time-consent.server";
import { fakeDb, memorySink, type Tables } from "./m22-fake-db";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b1";
const USER = "00000000-0000-4000-8000-00000000aaa1";
const MSG = "00000000-0000-4000-8000-0000000a0001";
const PHONE = "+2348031234567";
const ENV = {
  SMS_PROVIDER: "bulksmsnigeria",
  BULKSMS_NG_TOKEN: ["unit", "token"].join("-"),
  BULKSMS_NG_SENDER: "Sherivs",
};
// 13:00 UTC on a fixed day.
const NOON = Date.parse("2026-11-18T13:00:00.000Z");

function world(over: Partial<Tables> = {}): Tables {
  return {
    outbound_messages: [
      {
        id: MSG,
        org_id: ORG,
        school_id: ORG,
        channel: "sms",
        status: "queued",
        to_address: PHONE,
        recipient_user_id: USER,
        category: "utility",
        priority: "normal",
        body: "Fees are due",
        provider: "bulksmsnigeria",
        provider_ref: null,
        reference: "r1",
      },
    ],
    organization_memberships: [{ user_id: USER, school_id: ORG, is_active: true }],
    users: [{ id: USER, phone: PHONE, is_active: true }],
    schools: [{ id: ORG, subscription_tier: "growth" }],
    comms_optins: [],
    notification_preferences: [],
    ...over,
  };
}

/** Models comms_sms_claim / comms_sms_settle (compare-and-set) and records refunds. */
function rpcs(t: Tables, refunds: string[]) {
  const row = (a: Record<string, unknown>) =>
    (t.outbound_messages ?? []).find((r) => r.id === a.p_message && r.org_id === a.p_org);
  return {
    flag_on: () => ({ data: true, error: null }),
    comms_sms_claim: (a: Record<string, unknown>) => {
      const r = row(a);
      if (!r || r.status !== "queued" || r.provider_ref !== null)
        return { data: false, error: null };
      r.provider_ref = a.p_claim;
      return { data: true, error: null };
    },
    comms_sms_settle: (a: Record<string, unknown>) => {
      const r = row(a);
      if (!r || r.status !== "queued" || (r.provider_ref ?? null) !== (a.p_expected_ref ?? null)) {
        return { data: false, error: null };
      }
      Object.assign(r, {
        status: a.p_status,
        provider_ref: a.p_provider_ref ?? null,
        error: a.p_error,
      });
      if (a.p_refund_reason) refunds.push(String(a.p_refund_reason));
      return { data: true, error: null };
    },
    comms_sms_hold: () => ({ data: true, error: null }),
  };
}

function setup(t = world(), nowMs = NOON) {
  const refunds: string[] = [];
  const db = fakeDb(t, rpcs(t, refunds));
  const f = vi.fn(
    async () =>
      new Response(JSON.stringify({ status: "success", data: { message_id: "bsng-9" } }), {
        status: 200,
      }),
  );
  const ev = memorySink();
  const deps = {
    db,
    selection: selectSmsGateway(ENV, f as never),
    evidence: ev.sink as never,
    now: () => new Date(nowMs).toISOString(),
  };
  return { t, db, f, ev, refunds, deps };
}

describe("send-time consent gate", () => {
  const base = {
    orgId: ORG,
    recipientUserId: USER,
    phoneForms: [PHONE],
    priority: "normal",
    category: "utility",
    nowMs: NOON,
  };
  it("SMS utility without a recorded choice is allowed; an opt-out blocks it", async () => {
    expect(await checkSendTimeConsent(fakeDb(world(), {}), { ...base, channel: "sms" })).toEqual({
      ok: true,
    });
    const out = world({
      comms_optins: [{ org_id: ORG, channel: "sms", phone: PHONE, status: "opted_out" }],
    });
    expect(await checkSendTimeConsent(fakeDb(out, {}), { ...base, channel: "sms" })).toMatchObject({
      ok: false,
      code: "opted_out",
    });
  });
  it("WhatsApp and marketing need an explicit opt-in on that channel", async () => {
    const smsOnly = world({
      comms_optins: [{ org_id: ORG, channel: "sms", phone: PHONE, status: "opted_in" }],
    });
    expect(
      await checkSendTimeConsent(fakeDb(smsOnly, {}), { ...base, channel: "whatsapp" }),
    ).toMatchObject({
      code: "opt_in_required",
    });
    expect(
      await checkSendTimeConsent(fakeDb(world(), {}), {
        ...base,
        channel: "sms",
        category: "marketing",
      }),
    ).toMatchObject({ code: "opt_in_required" });
  });
  it("an opt-in in another organization does not count", async () => {
    const elsewhere = world({
      comms_optins: [{ org_id: OTHER, channel: "whatsapp", phone: PHONE, status: "opted_in" }],
    });
    expect(
      await checkSendTimeConsent(fakeDb(elsewhere, {}), { ...base, channel: "whatsapp" }),
    ).toMatchObject({
      code: "opt_in_required",
    });
  });
  it("quiet hours defer (they never drop); safety bypasses opt-out and quiet hours", async () => {
    const quiet = world({
      notification_preferences: [
        { user_id: USER, school_id: ORG, quiet_hours_start: "12:00", quiet_hours_end: "14:00" },
      ],
      comms_optins: [{ org_id: ORG, channel: "sms", phone: PHONE, status: "opted_out" }],
    });
    const noOptOut = { ...quiet, comms_optins: [] };
    expect(
      await checkSendTimeConsent(fakeDb(noOptOut, {}), { ...base, channel: "sms" }),
    ).toMatchObject({
      ok: false,
      code: "quiet_hours",
      defer: true,
    });
    expect(
      await checkSendTimeConsent(fakeDb(quiet, {}), {
        ...base,
        channel: "sms",
        priority: "safety",
      }),
    ).toEqual({ ok: true });
  });
  it("fails closed when consent cannot be read", async () => {
    const broken = {
      from: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q: any = {
          select: () => q,
          eq: () => q,
          in: () => Promise.resolve({ data: null, error: { message: "x" } }),
        };
        return q;
      },
    };
    expect(await checkSendTimeConsent(broken as never, { ...base, channel: "sms" })).toMatchObject({
      ok: false,
      code: "consent_unverifiable",
    });
  });
});

describe("SMS dispatcher (M22 additions)", () => {
  it("an opt-out recorded after queueing refuses the send: no provider call, refund, evidence", async () => {
    const s = setup(
      world({ comms_optins: [{ org_id: ORG, channel: "sms", phone: PHONE, status: "opted_out" }] }),
    );
    const run = await dispatchQueuedSms(s.deps, ORG);
    expect(run.status === "ran" && run.outcomes[0].outcome).toBe("rejected");
    expect(s.f).not.toHaveBeenCalled();
    expect(s.refunds).toEqual(["rejected_before_submission"]);
    expect(s.ev.rows).toHaveLength(1);
    expect(s.ev.rows[0]).toMatchObject({ channel: "sms", outcome: "undeliverable", tenantId: ORG });
  });

  it("quiet hours leave the row queued and unclaimed, with no provider call and no money movement", async () => {
    const s = setup(
      world({
        notification_preferences: [
          { user_id: USER, school_id: ORG, quiet_hours_start: "12:00", quiet_hours_end: "14:00" },
        ],
      }),
    );
    const run = await dispatchQueuedSms(s.deps, ORG);
    expect(run.status === "ran" && run.outcomes[0]).toMatchObject({ outcome: "skipped" });
    expect(s.f).not.toHaveBeenCalled();
    expect(s.t.outbound_messages[0]).toMatchObject({ status: "queued", provider_ref: null });
    expect(s.refunds).toEqual([]);
    expect(s.db.calls.map((c) => c.name)).not.toContain("comms_sms_claim");
  });

  it("a send records one evidence row with the provider id and a redacted number only", async () => {
    const s = setup();
    await dispatchQueuedSms(s.deps, ORG);
    expect(s.f).toHaveBeenCalledTimes(1);
    expect(s.ev.rows).toHaveLength(1);
    expect(s.ev.rows[0]).toMatchObject({
      channel: "sms",
      adapter: "bulksmsnigeria",
      outcome: "delivered",
      providerMessageId: "bsng-9",
      notificationRef: MSG,
    });
    expect(JSON.stringify(s.ev.rows)).not.toContain(PHONE);
  });

  it("never meters at send time (the queue-time charge is the only charge) and never sends twice", async () => {
    const s = setup();
    await dispatchQueuedSms(s.deps, ORG);
    await dispatchQueuedSms(s.deps, ORG);
    await Promise.all([dispatchQueuedSms(s.deps, ORG), dispatchQueuedSms(s.deps, ORG)]);
    expect(s.f).toHaveBeenCalledTimes(1);
    expect(s.db.calls.map((c) => c.name)).not.toContain("meter_usage");
  });

  it("an evidence-sink failure never changes the send result", async () => {
    const s = setup();
    const run = await dispatchQueuedSms(
      {
        ...s.deps,
        evidence: { kind: "broken", record: async () => Promise.reject(new Error("down")) },
      },
      ORG,
    );
    expect(run.status === "ran" && run.outcomes[0].outcome).toBe("sent");
  });
});
