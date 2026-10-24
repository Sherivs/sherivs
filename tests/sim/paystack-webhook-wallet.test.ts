/**
 * SHERIVS-027 sim check: drive the REAL Paystack webhook route with HMAC-SHA512 signed test payloads
 * and let its settlement RPC run against the Sim Lab Postgres (service role). Skipped when the sim DB
 * is not running (e.g. in CI). Uses a throwaway sk_test_ value generated per run, never a real key.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

const SIM = { host: "127.0.0.1", port: Number(process.env.SIM_PG_PORT ?? 54329), user: "postgres" };
const SECRET = `sk_test_sim_${randomBytes(12).toString("hex")}`;
let client: pg.Client | null = null;
let simUp = false;

async function asService<T>(sql: string, params: unknown[]): Promise<T> {
  const c = client!;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL ROLE service_role");
    await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
    const r = await c.query(sql, params);
    await c.query("COMMIT");
    return r.rows[0] as T;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (fn: string, a: Record<string, unknown>) => {
      if (fn !== "wallet_topup_settle") return { data: null, error: { message: `unexpected rpc ${fn}` } };
      try {
        const row = await asService<{ r: unknown }>("select public.wallet_topup_settle($1,$2,$3,$4) r", [a.p_reference, a.p_status, a.p_amount_kobo, a.p_currency]);
        return { data: row.r, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    from: () => ({ insert: async () => ({ error: null }) }),
  },
}));
vi.mock("@/lib/security/public-rate-limit.server", () => ({ checkPublicRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));

const sign = (body: string, key = SECRET) => createHmac("sha512", key).update(body).digest("hex");
const charge = (reference: string, amount: number, status = "success", currency = "NGN") =>
  JSON.stringify({ event: "charge.success", data: { reference, amount, currency, status, metadata: { kind: "wallet_topup" } } });

let schoolId = "";
let reference = "";
let post: (req: Request) => Promise<Response>;

beforeAll(async () => {
  try {
    client = new pg.Client(SIM);
    await client.connect();
    simUp = true;
  } catch {
    simUp = false;
    return;
  }
  process.env.PAYSTACK_SECRET_KEY = SECRET;
  schoolId = (await client.query("select id from schools order by created_at limit 1")).rows[0].id;
  reference = `wtp_${randomUUID().replace(/-/g, "")}`;
  await client.query("insert into wallet_topup_intents (school_id, reference, amount, email, initiated_by) values ($1,$2,12345,'sim@sim.local',$3)", [schoolId, reference, randomUUID()]);
  const mod = await import("@/routes/api/public/webhooks/paystack");
  const handlers = (mod.Route as unknown as { options: { server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } } } }).options.server.handlers;
  post = (request) => handlers.POST({ request });
});

afterAll(async () => {
  if (client) {
    if (simUp) {
      await client.query("delete from wallet_topup_intents where reference=$1", [reference]).catch(() => {});
    }
    await client.end().catch(() => {});
  }
});

const balance = async () => Number((await client!.query("select coalesce((select balance from school_wallets where school_id=$1),0) b", [schoolId])).rows[0].b);
const req = (body: string, sig?: string) =>
  new Request("http://sim.local/api/public/webhooks/paystack", { method: "POST", body, headers: { "content-type": "application/json", ...(sig ? { "x-paystack-signature": sig } : {}) } });

describe("Paystack webhook → wallet top-up (signed test payloads, sim DB)", () => {
  it("rejects unsigned and wrongly signed payloads without crediting", async ({ skip }) => {
    if (!simUp) skip();
    const b0 = await balance();
    const body = charge(reference, 1234500);
    expect((await post(req(body))).status).toBe(401);
    expect((await post(req(body, sign(body, "sk_test_wrong")))).status).toBe(401);
    expect(await balance()).toBe(b0);
  });

  it("rejects a correctly signed payload whose amount does not match the intent", async ({ skip }) => {
    if (!simUp) skip();
    const other = `wtp_${randomUUID().replace(/-/g, "")}`;
    await client!.query("insert into wallet_topup_intents (school_id, reference, amount, email, initiated_by) values ($1,$2,500,'sim@sim.local',$3)", [schoolId, other, randomUUID()]);
    const b0 = await balance();
    const body = charge(other, 100);
    expect((await post(req(body, sign(body)))).status).toBe(200);
    expect(await balance()).toBe(b0);
    expect((await client!.query("select status from wallet_topup_intents where reference=$1", [other])).rows[0].status).toBe("failed");
    await client!.query("delete from wallet_topup_intents where reference=$1", [other]);
  });

  it("credits exactly once for a valid signed charge.success, and replays are no-ops", async ({ skip }) => {
    if (!simUp) skip();
    const b0 = await balance();
    const body = charge(reference, 1234500);
    expect((await post(req(body, sign(body)))).status).toBe(200);
    expect(await balance()).toBe(b0 + 12345);
    expect((await post(req(body, sign(body)))).status).toBe(200);
    expect(await balance()).toBe(b0 + 12345);
    expect((await client!.query("select status from wallet_topup_intents where reference=$1", [reference])).rows[0].status).toBe("paid");
  });
});
