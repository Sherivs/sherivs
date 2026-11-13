/**
 * Sherivs — SMS through the communication fabric tests (COMMS-03).
 *
 * Proves (against an in-memory database double that honours eq/in/is filters and atomic
 * conditional updates, and the real BulkSMS Nigeria gateway over a mocked fetch):
 * 1. A successful send reaches only the target organization's queued row, to the member's
 *    stored number, and records the provider message id.
 * 2. A raw/mismatched number and a cross-tenant recipient are rejected with no provider call.
 * 3. Missing opt-in, opt-out, and a plan without SMS block the send; safety bypasses opt-out.
 * 4. Invalid credentials and retryable provider failures fail closed, keep rows queued, halt.
 * 5. A row can be sent at most once, even by concurrent workers.
 * 6. The delivery-report webhook rejects every bad token, resolves the organization from OUR
 *    row, and ignores unknown/replayed/mismatched reports.
 * 7. The database trigger that audits every outbound_messages change is still present.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BULKSMS_NG_SENDER_ENV,
  BULKSMS_NG_TOKEN_ENV,
  BULKSMS_NG_WEBHOOK_SECRET_ENV,
  BULKSMS_NG_WEBHOOK_URL_ENV,
  signBulkSmsCallback,
} from "../../../frontend/src/lib/communications/bulksms-nigeria.server";
import { SMS_PROVIDER_ENV } from "../../../frontend/src/lib/communications/sms-gateway-contract";
import { selectSmsGateway } from "../../../frontend/src/lib/communications/sms-gateway.server";
import {
  SMS_DISPATCH_MAX_MESSAGES_PER_RUN,
  createBulkSmsWebhookHandler,
  createSmsDispatchCronHandler,
  dispatchQueuedSms,
  type SmsFabricDatabase,
} from "../../../frontend/src/lib/communications/sms-fabric.server";

const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b1";
const USER_A = "00000000-0000-4000-8000-00000000aaa1";
const USER_B = "00000000-0000-4000-8000-00000000bbb1";
const MSG_A = "00000000-0000-4000-8000-0000000a0001";
const MSG_A2 = "00000000-0000-4000-8000-0000000a0002";
const MSG_B = "00000000-0000-4000-8000-0000000b0001";
const TOKEN = "unit-token-sentinel";
const SECRET = "unit-webhook-secret-sentinel";
const ENV = {
  [SMS_PROVIDER_ENV]: "bulksmsnigeria",
  [BULKSMS_NG_TOKEN_ENV]: TOKEN,
  [BULKSMS_NG_SENDER_ENV]: "Sherivs",
  [BULKSMS_NG_WEBHOOK_SECRET_ENV]: SECRET,
  [BULKSMS_NG_WEBHOOK_URL_ENV]: "https://app.example.test/api/public/webhooks/bulksms",
};

type Row = Record<string, unknown>;

function makeDb(tables: Record<string, Row[]>, flagOn = true): SmsFabricDatabase {
  return {
    rpc: async () => ({ data: flagOn, error: null }),
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      let single = false;
      let returning = false;
      let cap = Infinity;
      const run = () => {
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        const data =
          patch && !returning
            ? null
            : single
              ? rows[0]
                ? { ...rows[0] }
                : null
              : rows.slice(0, cap).map((r) => ({ ...r }));
        return { data, error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => ((returning = true), q),
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
        is: (k: string, v: null) => (filters.push((r) => (r[k] ?? null) === v), q),
        like: (k: string, pattern: string) => (
          filters.push(
            (r) =>
              typeof r[k] === "string" && (r[k] as string).startsWith(pattern.replace(/%$/, "")),
          ),
          q
        ),
        lt: (k: string, v: string) => (
          filters.push((r) => typeof r[k] === "string" && (r[k] as string) < v),
          q
        ),
        limit: (n: number) => ((cap = n), q),
        update: (v: Row) => ((patch = v), q),
        maybeSingle: () => ((single = true), Promise.resolve(run())),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  } as SmsFabricDatabase;
}

function world() {
  const base = {
    channel: "sms",
    status: "queued",
    category: "utility",
    priority: "normal",
    body: "Hello from the school",
    provider: "bulksmsnigeria",
    provider_ref: null,
  };
  return {
    outbound_messages: [
      {
        ...base,
        id: MSG_A,
        org_id: ORG_A,
        school_id: ORG_A,
        recipient_user_id: USER_A,
        to_address: "+2348031234567",
      },
      {
        ...base,
        id: MSG_B,
        org_id: ORG_B,
        school_id: ORG_B,
        recipient_user_id: USER_B,
        to_address: "+2348027654321",
      },
    ] as Row[],
    organization_memberships: [
      { user_id: USER_A, school_id: ORG_A, is_active: true },
      { user_id: USER_B, school_id: ORG_B, is_active: true },
    ] as Row[],
    users: [
      { id: USER_A, phone: "+2348031234567", is_active: true },
      { id: USER_B, phone: "+2348027654321", is_active: true },
    ] as Row[],
    schools: [
      { id: ORG_A, subscription_tier: "growth" },
      { id: ORG_B, subscription_tier: "growth" },
    ] as Row[],
    comms_optins: [] as Row[],
  };
}

const sentResponse = (id = "bsng-1") =>
  new Response(JSON.stringify({ status: "success", code: "BSNG-0000", data: { message_id: id } }), {
    status: 200,
  });

function setup(
  tables = world(),
  opts: { flag?: boolean; env?: Record<string, string | undefined> } = {},
) {
  const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => sentResponse());
  const selection = selectSmsGateway(opts.env ?? ENV, f as unknown as typeof fetch);
  const db = makeDb(tables, opts.flag ?? true);
  return { f, tables, db, deps: { db, selection } };
}

describe("dispatchQueuedSms", () => {
  it("sends only the target org's queued row to the member's stored number", async () => {
    const t = setup();
    const run = await dispatchQueuedSms(t.deps, ORG_A);
    expect(run).toEqual({
      status: "ran",
      outcomes: [{ id: MSG_A, outcome: "sent", providerMessageId: "bsng-1" }],
      haltedReason: null,
    });
    expect(t.f).toHaveBeenCalledTimes(1);
    const body = JSON.parse((t.f.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.to).toBe("2348031234567");
    expect(t.tables.outbound_messages[0]).toMatchObject({
      status: "sent",
      provider: "bulksmsnigeria",
      provider_ref: "bsng-1",
      error: null,
    });
    expect(t.tables.outbound_messages[1]).toMatchObject({ status: "queued", provider_ref: null });
    expect(JSON.stringify(run)).not.toContain(TOKEN);
  });

  it("rejects a raw or mismatched number and never contacts the provider", async () => {
    const tables = world();
    tables.outbound_messages[0]!.to_address = "+2348099999999";
    const t = setup(tables);
    const run = await dispatchQueuedSms(t.deps, ORG_A);
    expect(run).toMatchObject({ status: "ran", outcomes: [{ outcome: "rejected" }] });
    expect(t.f).not.toHaveBeenCalled();
    expect(tables.outbound_messages[0]!.status).toBe("failed");
  });

  it("rejects an org A row that points at org B's member", async () => {
    const tables = world();
    Object.assign(tables.outbound_messages[0]!, {
      recipient_user_id: USER_B,
      to_address: "+2348027654321",
    });
    const t = setup(tables);
    const run = await dispatchQueuedSms(t.deps, ORG_A);
    expect(run).toMatchObject({
      outcomes: [{ outcome: "rejected", reason: "recipient is not an active organization member" }],
    });
    expect(t.f).not.toHaveBeenCalled();
  });

  it("rejects rows with no resolved recipient, an org/school mismatch, or an inactive member", async () => {
    for (const mutate of [
      (r: Row) => (r.recipient_user_id = null),
      (r: Row) => (r.school_id = ORG_B),
    ]) {
      const tables = world();
      mutate(tables.outbound_messages[0]!);
      const t = setup(tables);
      expect(await dispatchQueuedSms(t.deps, ORG_A)).toMatchObject({
        outcomes: [{ outcome: "rejected" }],
      });
      expect(t.f).not.toHaveBeenCalled();
    }
    const tables = world();
    tables.organization_memberships[0]!.is_active = false;
    const t = setup(tables);
    expect(await dispatchQueuedSms(t.deps, ORG_A)).toMatchObject({
      outcomes: [{ outcome: "rejected" }],
    });
    expect(t.f).not.toHaveBeenCalled();
  });

  it("blocks marketing without an opt-in and any message after an opt-out", async () => {
    const marketing = world();
    marketing.outbound_messages[0]!.category = "marketing";
    const a = setup(marketing);
    expect(await dispatchQueuedSms(a.deps, ORG_A)).toMatchObject({
      outcomes: [{ outcome: "rejected" }],
    });
    expect(a.f).not.toHaveBeenCalled();

    const optedOut = world();
    optedOut.comms_optins.push({
      org_id: ORG_A,
      channel: "sms",
      phone: "+2348031234567",
      status: "opted_out",
    });
    const b = setup(optedOut);
    expect(await dispatchQueuedSms(b.deps, ORG_A)).toMatchObject({
      outcomes: [{ outcome: "rejected" }],
    });
    expect(b.f).not.toHaveBeenCalled();
  });

  it("sends marketing with an opt-in and lets safety messages bypass an opt-out", async () => {
    const marketing = world();
    marketing.outbound_messages[0]!.category = "marketing";
    marketing.comms_optins.push({
      org_id: ORG_A,
      channel: "sms",
      phone: "2348031234567",
      status: "opted_in",
    });
    const a = setup(marketing);
    expect(await dispatchQueuedSms(a.deps, ORG_A)).toMatchObject({
      outcomes: [{ outcome: "sent" }],
    });

    const safety = world();
    safety.outbound_messages[0]!.priority = "safety";
    safety.comms_optins.push({
      org_id: ORG_A,
      channel: "sms",
      phone: "+2348031234567",
      status: "opted_out",
    });
    const b = setup(safety);
    expect(await dispatchQueuedSms(b.deps, ORG_A)).toMatchObject({
      outcomes: [{ outcome: "sent" }],
    });
  });

  it("ignores another organization's opt-in record", async () => {
    const tables = world();
    tables.outbound_messages[0]!.category = "marketing";
    tables.comms_optins.push({
      org_id: ORG_B,
      channel: "sms",
      phone: "+2348031234567",
      status: "opted_in",
    });
    const t = setup(tables);
    expect(await dispatchQueuedSms(t.deps, ORG_A)).toMatchObject({
      outcomes: [{ outcome: "rejected" }],
    });
  });

  it("refuses plans that do not include SMS", async () => {
    for (const tier of ["trial", "starter", null, "unknown-plan"]) {
      const tables = world();
      tables.schools[0]!.subscription_tier = tier;
      const t = setup(tables);
      const run = await dispatchQueuedSms(t.deps, ORG_A);
      expect(run).toMatchObject({ outcomes: [{ outcome: "rejected" }] });
      expect(t.f).not.toHaveBeenCalled();
    }
    for (const tier of ["growth", "professional", "enterprise"]) {
      const tables = world();
      tables.schools[0]!.subscription_tier = tier;
      expect(await dispatchQueuedSms(setup(tables).deps, ORG_A)).toMatchObject({
        outcomes: [{ outcome: "sent" }],
      });
    }
  });

  it("does nothing when the sms_live flag is off or the org id is invalid", async () => {
    const t = setup(world(), { flag: false });
    expect(await dispatchQueuedSms(t.deps, ORG_A)).toEqual({
      status: "skipped",
      reason: "sms_live_off",
      outcomes: [],
    });
    await expect(dispatchQueuedSms(t.deps, "not-a-uuid")).rejects.toThrow();
    expect(t.f).not.toHaveBeenCalled();
  });

  it("sends nothing and leaves rows queued when the provider is unselected or unconfigured", async () => {
    for (const env of [
      {},
      { [SMS_PROVIDER_ENV]: "bulksmsnigeria" },
      { ...ENV, [BULKSMS_NG_TOKEN_ENV]: "" },
    ]) {
      const t = setup(world(), { env });
      const run = await dispatchQueuedSms(t.deps, ORG_A);
      expect(run).toMatchObject({ status: "skipped", outcomes: [] });
      expect(t.f).not.toHaveBeenCalled();
      expect(t.tables.outbound_messages[0]).toMatchObject({ status: "queued", provider_ref: null });
    }
  });

  it("fails closed on invalid credentials: one provider call, row stays queued, run halts", async () => {
    const tables = world();
    tables.outbound_messages.push({ ...tables.outbound_messages[0]!, id: MSG_A2 });
    const t = setup(tables);
    t.f.mockImplementation(
      async () => new Response(JSON.stringify({ status: "error" }), { status: 401 }),
    );
    const run = await dispatchQueuedSms(t.deps, ORG_A);
    expect(t.f).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ status: "ran", haltedReason: "provider_auth_failed" });
    expect(tables.outbound_messages[0]).toMatchObject({
      status: "queued",
      provider_ref: null,
      error: "provider_auth_failed",
    });
    expect(tables.outbound_messages[2]).toMatchObject({ status: "queued", provider_ref: null });
    expect(JSON.stringify(run)).not.toContain(TOKEN);
  });

  it("keeps a rate-limited send queued and halts; closes a terminal refusal and continues", async () => {
    const limited = world();
    limited.outbound_messages.push({ ...limited.outbound_messages[0]!, id: MSG_A2 });
    const a = setup(limited);
    a.f.mockImplementation(async () => new Response("{}", { status: 429 }));
    expect(await dispatchQueuedSms(a.deps, ORG_A)).toMatchObject({
      haltedReason: "provider_rejected",
    });
    expect(a.f).toHaveBeenCalledTimes(1);
    expect(limited.outbound_messages[0]).toMatchObject({ status: "queued", provider_ref: null });

    const refused = world();
    refused.outbound_messages.push({ ...refused.outbound_messages[0]!, id: MSG_A2 });
    const b = setup(refused);
    b.f.mockImplementationOnce(async () => new Response("{}", { status: 422 }));
    const run = await dispatchQueuedSms(b.deps, ORG_A);
    expect(run).toMatchObject({ haltedReason: null });
    expect(refused.outbound_messages[0]).toMatchObject({
      status: "failed",
      error: "provider_rejected",
    });
    expect(refused.outbound_messages[2]).toMatchObject({ status: "sent" });
  });

  it("sends a row at most once even when workers race", async () => {
    const t = setup();
    const [r1, r2] = await Promise.all([
      dispatchQueuedSms(t.deps, ORG_A),
      dispatchQueuedSms(t.deps, ORG_A),
    ]);
    expect(t.f).toHaveBeenCalledTimes(1);
    const outcomes = [...r1.outcomes, ...r2.outcomes].map((o) => o.outcome).sort();
    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
  });

  it("never re-sends a row that already holds a claim or a provider id", async () => {
    const tables = world();
    tables.outbound_messages[0]!.provider_ref = "claim:crashed-mid-send";
    const t = setup(tables);
    expect(await dispatchQueuedSms(t.deps, ORG_A)).toMatchObject({ status: "ran", outcomes: [] });
    expect(t.f).not.toHaveBeenCalled();
  });
});

describe("bulksms delivery-report webhook", () => {
  const sentWorld = () => {
    const t = world();
    Object.assign(t.outbound_messages[0]!, { status: "sent", provider_ref: "bsng-A" });
    Object.assign(t.outbound_messages[1]!, { status: "sent", provider_ref: "bsng-B" });
    return t;
  };
  const url = (ref = MSG_A, sig = signBulkSmsCallback(SECRET, ref)) =>
    `https://app.example.test/api/public/webhooks/bulksms?ref=${ref}&sig=${sig}`;
  const post = (target: string, body: unknown) =>
    new Request(target, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const event = (delivery_status: string, extra: Row = {}) => ({
    message_id: "bsng-A",
    recipient: "2348031234567",
    delivery_status,
    ...extra,
  });
  const hook = (tables: Record<string, Row[]>, env: Record<string, string> = ENV) =>
    createBulkSmsWebhookHandler({ env, db: makeDb(tables) });

  it("verifies the token, resolves the org from our row and marks delivered", async () => {
    const t = sentWorld();
    const res = await hook(t)(post(url(), event("delivrd", { org_id: ORG_B })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: true });
    expect(t.outbound_messages[0]).toMatchObject({ status: "delivered", error: null });
    expect(t.outbound_messages[1]!.status).toBe("sent");
  });

  it("records a failed delivery with a bounded code", async () => {
    const t = sentWorld();
    await hook(t)(post(url(), event("undeliv")));
    expect(t.outbound_messages[0]).toMatchObject({ status: "failed", error: "dlr_undeliv" });
  });

  it("rejects missing, wrong, stale-ref and wrong-secret tokens without side effects", async () => {
    const t = sentWorld();
    const handler = hook(t);
    const body = event("delivrd");
    const base = "https://app.example.test/api/public/webhooks/bulksms";
    for (const target of [
      base,
      `${base}?ref=${MSG_A}`,
      `${base}?ref=${MSG_A}&sig=AAAA`,
      url(MSG_A, signBulkSmsCallback("another-secret", MSG_A)),
      url(MSG_A, signBulkSmsCallback(SECRET, MSG_B)),
      `${base}?ref=not-a-uuid&sig=${signBulkSmsCallback(SECRET, "not-a-uuid")}`,
    ]) {
      expect((await handler(post(target, body))).status).toBe(403);
    }
    expect(t.outbound_messages[0]!.status).toBe("sent");
  });

  it("fails closed with 503 when the webhook secret is not configured, 405 for non-POST", async () => {
    const t = sentWorld();
    const noSecret = { ...ENV, [BULKSMS_NG_WEBHOOK_SECRET_ENV]: "" };
    expect((await hook(t, noSecret)(post(url(), event("delivrd")))).status).toBe(503);
    const res = await hook(t)(new Request(url(), { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("ignores pending, unknown, mismatched and replayed reports", async () => {
    const t = sentWorld();
    const handler = hook(t);
    const applied = async (req: Request) =>
      (await (await handler(req)).json()) as { applied: boolean };
    expect(await applied(post(url(), event("sent awaiting status")))).toEqual({
      ok: true,
      applied: false,
    });
    expect(
      await applied(post(url(), event("delivrd", { message_id: "bsng-OTHER" }))),
    ).toMatchObject({ applied: false });
    expect(
      await applied(post(url(), event("delivrd", { recipient: "2348000000000" }))),
    ).toMatchObject({ applied: false });
    const unknownRef = "00000000-0000-4000-8000-0000000c0001";
    expect(await applied(post(url(unknownRef), event("delivrd")))).toMatchObject({
      applied: false,
    });
    expect(await applied(post(url(), event("delivrd")))).toMatchObject({ applied: true });
    expect(await applied(post(url(), event("undeliv")))).toMatchObject({ applied: false });
    expect(t.outbound_messages[0]!.status).toBe("delivered");
  });

  it("asks the provider to retry while our send state has not been written yet", async () => {
    const t = sentWorld();
    Object.assign(t.outbound_messages[0]!, { status: "queued", provider_ref: "claim:in-flight" });
    expect((await hook(t)(post(url(), event("delivrd")))).status).toBe(503);
  });

  it("rejects malformed JSON and an invalid payload", async () => {
    const t = sentWorld();
    expect((await hook(t)(post(url(), "{not json"))).status).toBe(400);
    expect((await hook(t)(post(url(), { delivery_status: "delivrd" }))).status).toBe(400);
  });
});

describe("scheduled dispatcher (cron)", () => {
  const CRON = "unit-cron-secret-sentinel";
  const NOW = "2026-11-13T12:00:00.000Z";
  const call = (
    tables: ReturnType<typeof world>,
    opts: {
      env?: Record<string, string | undefined>;
      auth?: string | null;
      method?: string;
      flag?: boolean;
    } = {},
  ) => {
    const f = vi.fn(async () => sentResponse());
    const handler = createSmsDispatchCronHandler({
      env: opts.env ?? { ...ENV, CRON_SECRET: CRON },
      db: makeDb(tables, opts.flag ?? true),
      fetchImpl: f as unknown as typeof fetch,
      now: () => NOW,
    });
    const headers: Record<string, string> = {};
    if (opts.auth !== null) headers.authorization = opts.auth ?? `Bearer ${CRON}`;
    return {
      f,
      res: handler(
        new Request("https://app.example.test/api/public/cron/sms-dispatch", {
          method: opts.method ?? "POST",
          headers,
        }),
      ),
    };
  };

  it("fails closed: 503 without CRON_SECRET, 401 without or with a wrong bearer, 405 for other verbs", async () => {
    const t = world();
    expect((await call(t, { env: { ...ENV } }).res).status).toBe(503);
    expect((await call(t, { auth: null }).res).status).toBe(401);
    expect((await call(t, { auth: "Bearer nope" }).res).status).toBe(401);
    expect((await call(t, { method: "DELETE" }).res).status).toBe(405);
    const probe = call(t, { auth: "Bearer nope" });
    await probe.res;
    expect(probe.f).not.toHaveBeenCalled();
    expect(t.outbound_messages.every((r) => r.status === "queued" && r.provider_ref === null)).toBe(
      true,
    );
  });

  it("drains every organization's queue through the gateway and reports counts only", async () => {
    const t = world();
    const { f, res } = call(t);
    const response = await res;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, status: "ran", orgsVisited: 2, sent: 2, failed: 0 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(t.outbound_messages.map((r) => r.status)).toEqual(["sent", "sent"]);
    const text = JSON.stringify(body);
    for (const secret of [TOKEN, SECRET, CRON, "+234803", "Hello from the school"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("sends nothing while sms_live is off or the provider is not selected", async () => {
    const off = world();
    const a = call(off, { flag: false });
    expect(await (await a.res).json()).toMatchObject({ ok: true, status: "ran", sent: 0 });
    expect(a.f).not.toHaveBeenCalled();

    const unselected = world();
    const b = call(unselected, {
      env: { ...ENV, [SMS_PROVIDER_ENV]: undefined, CRON_SECRET: CRON },
    });
    expect(await (await b.res).json()).toMatchObject({
      ok: true,
      status: "skipped",
      reason: "provider_not_selected",
    });
    expect(b.f).not.toHaveBeenCalled();
    expect(unselected.outbound_messages.every((r) => r.status === "queued")).toBe(true);
  });

  it("halts the whole run on a provider-level failure and keeps rows queued", async () => {
    const t = world();
    const f = vi.fn(async () => new Response("{}", { status: 401 }));
    const handler = createSmsDispatchCronHandler({
      env: { ...ENV, CRON_SECRET: CRON },
      db: makeDb(t),
      fetchImpl: f as unknown as typeof fetch,
      now: () => NOW,
    });
    const response = await handler(
      new Request("https://app.example.test/x", {
        method: "GET",
        headers: { authorization: `Bearer ${CRON}` },
      }),
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      haltedReason: "provider_auth_failed",
      orgsVisited: 1,
    });
    expect(f).toHaveBeenCalledTimes(1);
    expect(t.outbound_messages.every((r) => r.status === "queued" && r.provider_ref === null)).toBe(
      true,
    );
  });

  it("caps one run at the per-run message limit", async () => {
    const t = world();
    for (let i = 0; i < SMS_DISPATCH_MAX_MESSAGES_PER_RUN + 5; i += 1) {
      t.outbound_messages.push({
        ...t.outbound_messages[0],
        id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`,
      });
    }
    const { f, res } = call(t);
    const body = await (await res).json();
    expect(body.sent).toBeLessThanOrEqual(SMS_DISPATCH_MAX_MESSAGES_PER_RUN);
    expect(f.mock.calls.length).toBeLessThanOrEqual(SMS_DISPATCH_MAX_MESSAGES_PER_RUN);
  });

  it("reports stale claims without re-sending or releasing them", async () => {
    const t = world();
    t.outbound_messages[0].provider_ref = "claim:crashed-worker";
    t.outbound_messages[0].updated_at = "2026-11-13T11:00:00.000Z";
    t.outbound_messages[1].provider_ref = "claim:in-flight";
    t.outbound_messages[1].updated_at = "2026-11-13T11:59:00.000Z";
    const { f, res } = call(t);
    const body = await (await res).json();
    expect(body.staleClaims).toEqual([MSG_A]);
    expect(f).not.toHaveBeenCalled();
    expect(t.outbound_messages[0]).toMatchObject({
      status: "queued",
      provider_ref: "claim:crashed-worker",
    });
  });
});

describe("audit posture", () => {
  it("still audits every outbound_messages change into audit_chain via the database trigger", () => {
    const migration = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../database/supabase/migrations/20261101001000_sherivs_033_communication_scope_lock.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      "ARRAY['comms_optins','outbound_messages','inbound_messages','comms_send_proposals']",
    );
    expect(migration).toContain("AFTER INSERT OR UPDATE ON public.%1$I");
    expect(migration).toContain("EXECUTE FUNCTION public.comms_audit_event()");
  });
});
