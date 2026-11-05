import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createResendEmailAdapter,
  RESEND_API_KEY_ENV,
  RESEND_FROM_ADDRESS_ENV,
} from "../../../frontend/src/lib/communications/resend-email.server";
import {
  createResendWebhookHandler,
  dispatchQueuedEmail,
  RESEND_WEBHOOK_SECRET_ENV,
  verifyResendWebhookSignature,
  type ResendFabricDatabase,
} from "../../../frontend/src/lib/communications/resend-fabric.server";
import type { AuditInput } from "../../../frontend/src/lib/trust-ledger/hash-chain.server";

const ORG_A = "00000000-0000-4000-8000-0000000000a1";
const ORG_B = "00000000-0000-4000-8000-0000000000b1";
const USER_A = "00000000-0000-4000-8000-00000000aaa1";
const USER_B = "00000000-0000-4000-8000-00000000bbb1";
const MSG_A = "00000000-0000-4000-8000-0000000a0001";
const MSG_B = "00000000-0000-4000-8000-0000000b0001";
const KEY = "unit-key-sentinel";
const SECRET = `whsec_${Buffer.from("unit-webhook-secret").toString("base64")}`;
const ENV = {
  [RESEND_API_KEY_ENV]: KEY,
  [RESEND_FROM_ADDRESS_ENV]: "no-reply@example.test",
  [RESEND_WEBHOOK_SECRET_ENV]: SECRET,
};

type Row = Record<string, unknown>;

function makeDb(tables: Record<string, Row[]>, flagOn = true) {
  const writes: Array<{ table: string; values: Row; filters: Row }> = [];
  const db: ResendFabricDatabase = {
    rpc: async () => ({ data: flagOn, error: null }),
    from(table: string) {
      const filters: Row = {};
      let patch: Row | null = null;
      let single = false;
      let cap = Infinity;
      const run = () => {
        const rows = (tables[table] ?? []).filter((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v),
        );
        if (patch) {
          writes.push({ table, values: patch, filters: { ...filters } });
          rows.forEach((r) => Object.assign(r, patch));
        }
        return single ? (rows[0] ?? null) : rows.slice(0, cap).map((r) => ({ ...r }));
      };
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => ((filters[k] = v), q),
        limit: (n: number) => ((cap = n), q),
        update: (v: Row) => ((patch = v), q),
        maybeSingle: () => ((single = true), Promise.resolve({ data: run(), error: null })),
        then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
      };
      return q;
    },
  };
  return { db, writes };
}

function world() {
  const base = {
    channel: "email",
    status: "queued",
    category: "utility",
    body: "Hello from the school",
    template_code: "absence_alert",
  };
  return {
    outbound_messages: [
      { ...base, id: MSG_A, org_id: ORG_A, school_id: ORG_A, recipient_user_id: USER_A, to_address: "a@example.test" },
      { ...base, id: MSG_B, org_id: ORG_B, school_id: ORG_B, recipient_user_id: USER_B, to_address: "b@example.test" },
    ] as Row[],
    organization_memberships: [
      { user_id: USER_A, school_id: ORG_A, is_active: true },
      { user_id: USER_B, school_id: ORG_B, is_active: true },
    ],
    users: [
      { id: USER_A, email: "a@example.test", is_active: true },
      { id: USER_B, email: "b@example.test", is_active: true },
    ],
    schools: [
      { id: ORG_A, name: "School A" },
      { id: ORG_B, name: "School B" },
    ],
  };
}

function okFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    void init;
    return new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
  });
}

function deps(db: ResendFabricDatabase, env: Record<string, string> = ENV) {
  const audits: AuditInput[] = [];
  return {
    audits,
    deps: {
      db,
      env,
      adapter: createResendEmailAdapter({ apiKey: env[RESEND_API_KEY_ENV] ?? null, fromAddress: env[RESEND_FROM_ADDRESS_ENV] ?? null }),
      audit: async (i: AuditInput) => void audits.push(i),
    },
  };
}

describe("dispatchQueuedEmail", () => {
  it("sends only the target org's queued mail to the stored member address and audits", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const t = world();
    const { db } = makeDb(t);
    const d = deps(db);
    const out = await dispatchQueuedEmail(d.deps, ORG_A);
    expect(out).toEqual([{ id: MSG_A, outcome: "sent", providerMessageId: "re_123" }]);
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toBe("a@example.test");
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "Idempotency-Key": MSG_A });
    expect(t.outbound_messages[0]).toMatchObject({ status: "sent", provider_ref: "re_123" });
    expect(t.outbound_messages[1].status).toBe("queued");
    expect(d.audits).toHaveLength(1);
    expect(d.audits[0]).toMatchObject({ orgId: ORG_A, action: "comms.email.sent", actorKind: "system" });
    expect(JSON.stringify(d.audits)).not.toContain("a@example.test");
    vi.unstubAllGlobals();
  });

  it("rejects a raw/mismatched address and an org A row pointing at org B's member", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const t = world();
    t.outbound_messages[0].to_address = "attacker@evil.test";
    const { db } = makeDb(t);
    const d = deps(db);
    expect((await dispatchQueuedEmail(d.deps, ORG_A))[0]).toMatchObject({ outcome: "rejected" });
    expect(f).not.toHaveBeenCalled();
    expect(t.outbound_messages[0].status).toBe("failed");

    const t2 = world();
    t2.outbound_messages[0].recipient_user_id = USER_B;
    t2.outbound_messages[0].to_address = "b@example.test";
    const d2 = deps(makeDb(t2).db);
    expect((await dispatchQueuedEmail(d2.deps, ORG_A))[0]).toMatchObject({
      outcome: "rejected",
      reason: "recipient is not an active organization member",
    });
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects rows with no resolved recipient and marketing mail", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const t = world();
    t.outbound_messages[0].recipient_user_id = null;
    const d = deps(makeDb(t).db);
    expect((await dispatchQueuedEmail(d.deps, ORG_A))[0]).toMatchObject({ outcome: "rejected" });
    const t2 = world();
    t2.outbound_messages[0].category = "marketing";
    const d2 = deps(makeDb(t2).db);
    expect((await dispatchQueuedEmail(d2.deps, ORG_A))[0]).toMatchObject({ outcome: "rejected" });
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fails closed with a missing key: no provider call, row closed, audited", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const t = world();
    const d = deps(makeDb(t).db, { [RESEND_FROM_ADDRESS_ENV]: "no-reply@example.test" });
    const out = await dispatchQueuedEmail(d.deps, ORG_A);
    expect(out[0]).toMatchObject({ outcome: "failed", reason: "provider_not_configured", retryable: false });
    expect(f).not.toHaveBeenCalled();
    expect(t.outbound_messages[0].status).toBe("failed");
    expect(d.audits[0].action).toBe("comms.email.failed");
    vi.unstubAllGlobals();
  });

  it("does nothing when the org email_live flag is off or the org id is invalid", async () => {
    const f = okFetch();
    vi.stubGlobal("fetch", f);
    const d = deps(makeDb(world(), false).db);
    expect(await dispatchQueuedEmail(d.deps, ORG_A)).toEqual([]);
    await expect(dispatchQueuedEmail(d.deps, "not-a-uuid")).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps retryable provider failures queued", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const t = world();
    const d = deps(makeDb(t).db);
    expect((await dispatchQueuedEmail(d.deps, ORG_A))[0]).toMatchObject({ outcome: "failed", retryable: true });
    expect(t.outbound_messages[0].status).toBe("queued");
    vi.unstubAllGlobals();
  });
});

function signed(body: string, opts: { secret?: string; id?: string; ts?: number } = {}) {
  const id = opts.id ?? "msg_1";
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const key = Buffer.from((opts.secret ?? SECRET).slice(6), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` };
}

function hook(tables: Record<string, Row[]>, env: Record<string, string> = ENV) {
  const audits: AuditInput[] = [];
  const handler = createResendWebhookHandler({
    env,
    db: makeDb(tables).db,
    audit: async (i) => void audits.push(i),
  });
  return { handler, audits };
}

const post = (body: string, headers: Record<string, string>) =>
  new Request("https://x.test/api/public/webhooks/resend", { method: "POST", body, headers });

describe("resend webhook", () => {
  const sentWorld = () => {
    const t = world();
    t.outbound_messages.forEach((r) => Object.assign(r, { status: "sent", provider: "resend" }));
    t.outbound_messages[0].provider_ref = "re_A";
    t.outbound_messages[1].provider_ref = "re_B";
    return t;
  };
  const event = (type: string, emailId: string, extra: Row = {}) =>
    JSON.stringify({ type, data: { email_id: emailId, ...extra } });

  it("verifies signature, maps to the owning org from our row, audits", async () => {
    const t = sentWorld();
    const { handler, audits } = hook(t);
    const body = event("email.delivered", "re_A", { org_id: ORG_B });
    const res = await handler(post(body, signed(body)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, applied: true });
    expect(t.outbound_messages[0].status).toBe("delivered");
    expect(t.outbound_messages[1].status).toBe("sent");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ orgId: ORG_A, action: "comms.email.delivered" });
  });

  it("records bounces and complaints as failed", async () => {
    const t = sentWorld();
    const { handler } = hook(t);
    const body = event("email.bounced", "re_B");
    await handler(post(body, signed(body)));
    expect(t.outbound_messages[1]).toMatchObject({ status: "failed", error: "bounced" });
  });

  it("rejects bad, stale, missing or wrong-secret signatures without side effects", async () => {
    const t = sentWorld();
    const { handler, audits } = hook(t);
    const body = event("email.delivered", "re_A");
    const wrong = `whsec_${Buffer.from("other").toString("base64")}`;
    for (const headers of [
      signed(body, { secret: wrong }),
      signed(body, { ts: Math.floor(Date.now() / 1000) - 3600 }),
      {},
      { ...signed(body), "svix-signature": "v1,AAAA" },
    ]) {
      expect((await handler(post(body, headers))).status).toBe(403);
    }
    expect((await handler(post(body + " ", signed(body)))).status).toBe(403);
    expect(t.outbound_messages[0].status).toBe("sent");
    expect(audits).toHaveLength(0);
  });

  it("fails closed when the webhook secret is not configured", async () => {
    const { handler } = hook(sentWorld(), { [RESEND_API_KEY_ENV]: KEY });
    const body = event("email.delivered", "re_A");
    expect((await handler(post(body, signed(body)))).status).toBe(503);
  });

  it("ignores unknown provider ids without leaking and does not replay terminal states", async () => {
    const t = sentWorld();
    const { handler, audits } = hook(t);
    const unknown = event("email.delivered", "re_other_tenant");
    const res = await handler(post(unknown, signed(unknown)));
    expect(await res.json()).toEqual({ ok: true, applied: false });
    const body = event("email.delivered", "re_A");
    await handler(post(body, signed(body, { id: "m1" })));
    const replay = await handler(post(body, signed(body, { id: "m1" })));
    expect(await replay.json()).toEqual({ ok: true, applied: false });
    expect(audits).toHaveLength(1);
  });

  it("verifyResendWebhookSignature rejects a missing secret", () => {
    expect(
      verifyResendWebhookSignature({ rawBody: "{}", id: "a", timestamp: "1", signature: "v1,x", secret: undefined, nowSeconds: 1 }),
    ).toBe(false);
  });
});
