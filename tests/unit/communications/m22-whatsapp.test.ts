/**
 * M22 (ADR-120): every proactive WhatsApp send goes through the template registry gate; the tenant fabric dispatcher
 * honours opt-in/opt-out at send time, records evidence, claims before sending, never retries, and never sends twice.
 * The Cloud adapter runs over a mocked fetch with a sentinel token: nothing can reach Meta.
 */
import { describe, expect, it, vi } from "vitest";
import { WhatsAppCloudAdapter } from "../../../frontend/src/lib/communications/whatsapp-cloud.server";
import {
  checkProactiveTemplate,
  platformWhatsAppTemplate,
  sendProactiveWhatsApp,
} from "../../../frontend/src/lib/communications/whatsapp-template-registry";
import {
  classifyWhatsAppFailure,
  createWhatsAppDispatchCronHandler,
  dispatchQueuedWhatsApp,
} from "../../../frontend/src/lib/communications/whatsapp-fabric.server";
import { fakeDb, memorySink, type Tables } from "./m22-fake-db";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const USER = "00000000-0000-4000-8000-00000000aaa1";
const MSG = "00000000-0000-4000-8000-0000000a0001";
const PHONE = "+2348031234567";
const TOKEN = ["wa", "token", "sentinel"].join("-");
const APPROVED = {
  code: "fee_reminder",
  name: "fee_reminder_v1",
  language: "en",
  paramCount: 2,
  status: "approved",
};
const ok = (id = "wamid.1") =>
  new Response(JSON.stringify({ messages: [{ id }] }), { status: 200 });

function adapter(f: ReturnType<typeof vi.fn>) {
  return new WhatsAppCloudAdapter(TOKEN, "1234567890", f as never, async () => undefined, "v21.0");
}

describe("template registry gate", () => {
  it("refuses unregistered, unapproved, nameless, languageless and wrong-count templates", () => {
    expect(checkProactiveTemplate(null, [])).toEqual({
      ok: false,
      code: "template_not_registered",
    });
    expect(checkProactiveTemplate({ ...APPROVED, status: "draft" }, ["a", "b"])).toMatchObject({
      code: "template_not_approved",
    });
    expect(checkProactiveTemplate({ ...APPROVED, name: null }, ["a", "b"])).toMatchObject({
      code: "template_name_invalid",
    });
    expect(checkProactiveTemplate({ ...APPROVED, language: null }, ["a", "b"])).toMatchObject({
      code: "template_language_missing",
    });
    expect(checkProactiveTemplate({ ...APPROVED, paramCount: null }, ["a", "b"])).toMatchObject({
      code: "template_param_count_unknown",
    });
    expect(checkProactiveTemplate(APPROVED, ["a"])).toMatchObject({
      code: "template_param_count_mismatch",
    });
    expect(checkProactiveTemplate(APPROVED, ["a", "line\nbreak"])).toMatchObject({
      code: "template_param_invalid",
    });
    expect(checkProactiveTemplate(APPROVED, ["a", "b"])).toEqual({
      ok: true,
      name: "fee_reminder_v1",
      language: "en",
    });
  });

  it("the platform owner-alert template is approved only once its name is configured", () => {
    expect(platformWhatsAppTemplate("owner_alert", {}).status).toBe("draft");
    expect(
      platformWhatsAppTemplate("owner_alert", { OWNER_ALERT_WHATSAPP_TEMPLATE: "owner_alert" }),
    ).toMatchObject({
      status: "approved",
      paramCount: 1,
      language: "en",
    });
  });

  it("refuses a proactive send without an approved template, with no network call", async () => {
    const f = vi.fn(async () => ok());
    const r = await sendProactiveWhatsApp(adapter(f), {
      to: PHONE,
      template: null,
      parameters: [],
    });
    expect(r).toMatchObject({ ok: false, refusal: "template_not_registered" });
    expect(f).not.toHaveBeenCalled();
  });

  it("makes exactly one provider attempt even on a 5xx (no automatic retry = no duplicate)", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 500 }));
    const r = await sendProactiveWhatsApp(adapter(f), {
      to: PHONE,
      template: APPROVED,
      parameters: ["a", "b"],
    });
    expect(r.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("sends a template message with the registered name, language and parameters", async () => {
    const f = vi.fn(async () => ok());
    const r = await sendProactiveWhatsApp(adapter(f), {
      to: PHONE,
      template: APPROVED,
      parameters: ["Ada", "NGN 5"],
    });
    expect(r).toEqual({ ok: true, providerRef: "wamid.1" });
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({
      type: "template",
      template: { name: "fee_reminder_v1", language: { code: "en" } },
    });
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Ada",
      "NGN 5",
    ]);
  });

  it("classifies provider failures: only provable non-acceptance releases or rejects", () => {
    expect(classifyWhatsAppFailure("whatsapp not configured")).toEqual({ kind: "release" });
    expect(classifyWhatsAppFailure("WhatsApp provider returned HTTP 429")).toEqual({
      kind: "release",
    });
    expect(classifyWhatsAppFailure("WhatsApp provider returned HTTP 400")).toEqual({
      kind: "reject",
    });
    expect(classifyWhatsAppFailure("invalid WhatsApp recipient")).toEqual({ kind: "reject" });
    expect(classifyWhatsAppFailure("WhatsApp provider returned HTTP 500")).toEqual({
      kind: "hold",
    });
    expect(classifyWhatsAppFailure("WhatsApp provider returned HTTP 408")).toEqual({
      kind: "hold",
    });
    expect(classifyWhatsAppFailure("WhatsApp provider request failed")).toEqual({ kind: "hold" });
    expect(classifyWhatsAppFailure("WhatsApp provider returned no message receipt")).toEqual({
      kind: "hold",
    });
  });
});

function world(over: Partial<Tables> = {}): Tables {
  return {
    outbound_messages: [
      {
        id: MSG,
        org_id: ORG,
        school_id: ORG,
        channel: "whatsapp",
        status: "queued",
        to_address: PHONE,
        recipient_user_id: USER,
        category: "utility",
        priority: "normal",
        template_code: "fee_reminder",
        language: "en",
        template_parameters: ["Ada", "NGN 5"],
        provider_ref: null,
        reference: "r1",
      },
    ],
    organization_memberships: [{ user_id: USER, school_id: ORG, is_active: true }],
    users: [{ id: USER, phone: PHONE, is_active: true }],
    comms_optins: [{ org_id: ORG, channel: "whatsapp", phone: PHONE, status: "opted_in" }],
    comms_templates: [
      {
        code: "fee_reminder",
        org_id: null,
        channel: "whatsapp",
        language: "en",
        wa_template_name: "fee_reminder_v1",
        wa_param_count: 2,
        status: "approved",
      },
    ],
    notification_preferences: [],
    ...over,
  };
}

function setup(t = world(), response: () => Response = () => ok()) {
  const refunds: string[] = [];
  const holds: string[] = [];
  const row = (a: Record<string, unknown>) =>
    (t.outbound_messages ?? []).find((r) => r.id === a.p_message && r.org_id === a.p_org);
  const db = fakeDb(t, {
    flag_on: () => ({ data: true, error: null }),
    comms_wa_claim: (a) => {
      const r = row(a);
      if (!r || r.status !== "queued" || r.provider_ref !== null)
        return { data: false, error: null };
      r.provider_ref = a.p_claim;
      return { data: true, error: null };
    },
    comms_wa_settle: (a) => {
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
    comms_wa_hold: (a) => {
      const r = row(a);
      if (!r || r.provider_ref !== a.p_expected_ref) return { data: false, error: null };
      r.error = `held:${a.p_code}`;
      holds.push(String(a.p_code));
      return { data: true, error: null };
    },
  });
  const f = vi.fn(async () => response());
  const ev = memorySink();
  const deps = {
    db: db as never,
    adapter: adapter(f),
    evidence: ev.sink as never,
    nowMs: () => Date.parse("2026-11-18T13:00:00Z"),
  };
  return { t, db, f, ev, refunds, holds, deps };
}

describe("WhatsApp fabric dispatcher", () => {
  it("sends an opted-in member's queued message once, with evidence and no raw number in it", async () => {
    const s = setup();
    const run = await dispatchQueuedWhatsApp(s.deps, ORG);
    expect(run).toMatchObject({
      status: "ran",
      outcomes: [{ outcome: "sent", providerMessageId: "wamid.1" }],
    });
    expect(s.f).toHaveBeenCalledTimes(1);
    expect(s.t.outbound_messages[0]).toMatchObject({ status: "sent", provider_ref: "wamid.1" });
    expect(s.ev.rows).toEqual([
      expect.objectContaining({ channel: "whatsapp", outcome: "delivered", tenantId: ORG }),
    ]);
    expect(JSON.stringify(s.ev.rows)).not.toContain(PHONE);
  });

  it("refuses without an opt-in, and after an opt-out: no provider call, refund, evidence", async () => {
    for (const optins of [
      [],
      [{ org_id: ORG, channel: "whatsapp", phone: PHONE, status: "opted_out" }],
    ]) {
      const s = setup(world({ comms_optins: optins }));
      const run = await dispatchQueuedWhatsApp(s.deps, ORG);
      expect(run.status === "ran" && run.outcomes[0].outcome).toBe("rejected");
      expect(s.f).not.toHaveBeenCalled();
      expect(s.refunds).toEqual(["rejected_before_submission"]);
      expect(s.ev.rows[0]).toMatchObject({ outcome: "undeliverable" });
    }
  });

  it("refuses a message whose template is unregistered, unapproved or has the wrong parameter count", async () => {
    const variants: Partial<Tables>[] = [
      { comms_templates: [] },
      { comms_templates: [{ ...world().comms_templates[0], status: "draft" }] },
      { comms_templates: [{ ...world().comms_templates[0], wa_param_count: 3 }] },
    ];
    for (const v of variants) {
      const s = setup(world(v));
      const run = await dispatchQueuedWhatsApp(s.deps, ORG);
      expect(run.status === "ran" && run.outcomes[0].outcome).toBe("rejected");
      expect(s.f).not.toHaveBeenCalled();
      expect(s.db.calls.map((c) => c.name)).not.toContain("comms_wa_claim");
    }
  });

  it("safety messages still need the template but bypass an opt-out", async () => {
    const t = world({
      comms_optins: [{ org_id: ORG, channel: "whatsapp", phone: PHONE, status: "opted_out" }],
    });
    t.outbound_messages[0].priority = "safety";
    const s = setup(t);
    const run = await dispatchQueuedWhatsApp(s.deps, ORG);
    expect(run.status === "ran" && run.outcomes[0].outcome).toBe("sent");
  });

  it("quiet hours defer without claiming", async () => {
    const s = setup(
      world({
        notification_preferences: [
          { user_id: USER, school_id: ORG, quiet_hours_start: "12:00", quiet_hours_end: "14:00" },
        ],
      }),
    );
    const run = await dispatchQueuedWhatsApp(s.deps, ORG);
    expect(run.status === "ran" && run.outcomes[0]).toMatchObject({
      outcome: "skipped",
      reason: "quiet_hours",
    });
    expect(s.f).not.toHaveBeenCalled();
    expect(s.t.outbound_messages[0].provider_ref).toBeNull();
  });

  it("a recipient who is no longer a member, or whose number changed, is refused", async () => {
    const s1 = setup(world({ organization_memberships: [] }));
    expect((await dispatchQueuedWhatsApp(s1.deps, ORG)).outcomes[0]).toMatchObject({
      outcome: "rejected",
      code: "not_member",
    });
    const s2 = setup(world({ users: [{ id: USER, phone: "+2348000000000", is_active: true }] }));
    expect((await dispatchQueuedWhatsApp(s2.deps, ORG)).outcomes[0]).toMatchObject({
      outcome: "rejected",
      code: "address_mismatch",
    });
    expect(s1.f).not.toHaveBeenCalled();
    expect(s2.f).not.toHaveBeenCalled();
  });

  it("concurrent and repeated runs send the message exactly once", async () => {
    const s = setup();
    await Promise.all([dispatchQueuedWhatsApp(s.deps, ORG), dispatchQueuedWhatsApp(s.deps, ORG)]);
    await dispatchQueuedWhatsApp(s.deps, ORG);
    expect(s.f).toHaveBeenCalledTimes(1);
  });

  it("an ambiguous provider failure is held: never retried, never refunded, run halted", async () => {
    const s = setup(world(), () => new Response("{}", { status: 502 }));
    const run = await dispatchQueuedWhatsApp(s.deps, ORG);
    expect(run).toMatchObject({
      status: "ran",
      haltedReason: "provider_error",
      outcomes: [{ outcome: "held" }],
    });
    await dispatchQueuedWhatsApp(s.deps, ORG);
    expect(s.f).toHaveBeenCalledTimes(1);
    expect(s.refunds).toEqual([]);
    expect(s.holds).toEqual(["provider_error"]);
  });

  it("a definitive 4xx refusal closes and refunds; an unconfigured adapter sends nothing", async () => {
    const s = setup(world(), () => new Response("{}", { status: 400 }));
    await dispatchQueuedWhatsApp(s.deps, ORG);
    expect(s.refunds).toEqual(["provider_rejected"]);
    const off = setup();
    const run = await dispatchQueuedWhatsApp(
      { ...off.deps, adapter: new WhatsAppCloudAdapter("", "", off.f as never) },
      ORG,
    );
    expect(run).toMatchObject({ status: "skipped", reason: "provider_not_configured" });
    expect(off.f).not.toHaveBeenCalled();
  });

  it("does nothing while whatsapp_live is off", async () => {
    const s = setup();
    const db = { ...s.db, rpc: async () => ({ data: false, error: null }) };
    const run = await dispatchQueuedWhatsApp({ ...s.deps, db: db as never }, ORG);
    expect(run).toMatchObject({ status: "skipped", reason: "whatsapp_live_off" });
    expect(s.f).not.toHaveBeenCalled();
  });
});

describe("WhatsApp dispatch cron", () => {
  const secret = ["cron", "sentinel"].join("-");
  it("is 503 without CRON_SECRET and 401 without the bearer", async () => {
    const s = setup();
    const h0 = createWhatsAppDispatchCronHandler({
      env: {},
      db: s.deps.db,
      adapter: s.deps.adapter,
      evidence: null,
    });
    expect((await h0(new Request("https://x.test/c"))).status).toBe(503);
    const h1 = createWhatsAppDispatchCronHandler({
      env: { CRON_SECRET: secret },
      db: s.deps.db,
      adapter: s.deps.adapter,
      evidence: null,
    });
    expect((await h1(new Request("https://x.test/c"))).status).toBe(401);
    expect(s.f).not.toHaveBeenCalled();
  });
  it("drains queued rows and answers with counts only", async () => {
    const s = setup();
    const h = createWhatsAppDispatchCronHandler({
      env: { CRON_SECRET: secret },
      db: s.deps.db,
      adapter: s.deps.adapter,
      evidence: null,
      nowMs: s.deps.nowMs,
    });
    const res = await h(
      new Request("https://x.test/c", { headers: { authorization: `Bearer ${secret}` } }),
    );
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "ran", sent: 1 });
    expect(JSON.stringify(body)).not.toContain(PHONE);
  });
});
