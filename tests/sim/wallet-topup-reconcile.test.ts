/**
 * SHERIVS-028 sim check: the scheduled reconciler against the Sim Lab Postgres (service role),
 * with Paystack /transaction/verify mocked. Everything runs in one transaction that is rolled back.
 * Skipped when the sim DB is not running (e.g. in CI). Never uses a real key.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { reconcileWalletTopups } from "@/lib/payments/wallet-topup-reconcile.server";

const SIM = { host: "127.0.0.1", port: Number(process.env.SIM_PG_PORT ?? 54329), user: "postgres" };
const SECRET = `sk_test_sim_${randomBytes(12).toString("hex")}`;
let c: pg.Client | null = null;
let simUp = false;
let schoolId = "";
const ref = () => `wtp_${randomUUID().replace(/-/g, "")}`;
const paid = ref(), abandoned = ref(), stale = ref(), fresh = ref();
const amounts: Record<string, number> = { [paid]: 2500, [abandoned]: 700, [stale]: 900, [fresh]: 400 };

const ARGS: Record<string, string> = {
  wallet_topup_expire_stale: "select public.wallet_topup_expire_stale($1::interval) r",
  wallet_topup_pending_for_check: "select coalesce(array_agg(x), '{}') r from public.wallet_topup_pending_for_check($1::interval, $2) x",
  wallet_topup_mark_checked: "select public.wallet_topup_mark_checked($1) r",
  wallet_topup_settle: "select public.wallet_topup_settle($1,$2,$3,$4) r",
};
const admin = {
  rpc: async (fn: string, a: Record<string, unknown>) => {
    const sql = ARGS[fn];
    if (!sql) return { data: null, error: { message: `unexpected rpc ${fn}` } };
    await c!.query("SAVEPOINT svc");
    try {
      await c!.query("SET LOCAL ROLE service_role");
      await c!.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
      const r = await c!.query(sql, Object.values(a));
      await c!.query("RESET ROLE");
      await c!.query("RELEASE SAVEPOINT svc");
      return { data: r.rows[0].r, error: null };
    } catch (e) {
      await c!.query("ROLLBACK TO SAVEPOINT svc");
      await c!.query("RESET ROLE");
      return { data: null, error: { message: (e as Error).message } };
    }
  },
};
let verifyCalls: string[] = [];
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const r = decodeURIComponent(String(url).split("/").pop() ?? "");
  verifyCalls.push(r);
  if ((init?.headers as Record<string, string>)?.Authorization !== `Bearer ${SECRET}`) return new Response("{}", { status: 401 });
  if (r === paid) return Response.json({ status: true, data: { status: "success", amount: amounts[paid] * 100, currency: "NGN" } });
  if (r === abandoned) return Response.json({ status: true, data: { status: "abandoned", amount: amounts[abandoned] * 100, currency: "NGN" } });
  return Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 });
}) as unknown as typeof fetch;

const balance = async () => Number((await c!.query("select coalesce((select balance from school_wallets where school_id=$1),0) b", [schoolId])).rows[0].b);
const intent = async (r: string) => (await c!.query("select status, check_count, failure_reason from wallet_topup_intents where reference=$1", [r])).rows[0];

beforeAll(async () => {
  try {
    c = new pg.Client(SIM);
    await c.connect();
    await c.query("BEGIN");
    simUp = true;
  } catch {
    return;
  }
  schoolId = (await c.query("select id from schools order by created_at limit 1")).rows[0].id;
  const age: Record<string, string> = { [paid]: "10 minutes", [abandoned]: "10 minutes", [stale]: "30 hours", [fresh]: "1 minute" };
  for (const r of [paid, abandoned, stale, fresh])
    await c.query("insert into wallet_topup_intents (school_id, reference, amount, email, initiated_by, created_at) values ($1,$2,$3,'sim@sim.local',$4, now() - $5::interval)", [schoolId, r, amounts[r], randomUUID(), age[r]]);
});
afterAll(async () => {
  if (c) {
    if (simUp) await c.query("ROLLBACK").catch(() => {});
    await c.end().catch(() => {});
  }
});

describe("Wallet top-up reconciler (sim DB, mocked Paystack verify)", () => {
  it("refuses anything but a test key", async () => {
    await expect(reconcileWalletTopups({ admin, secret: "sk_live_x", fetchImpl: fakeFetch })).rejects.toThrow(/test key/);
  });

  it("expires stale, settles a paid one once, leaves abandoned/fresh pending, and is idempotent", async ({ skip }) => {
    if (!simUp) skip();
    const b0 = await balance();
    verifyCalls = [];
    const r1 = await reconcileWalletTopups({ admin, secret: SECRET, fetchImpl: fakeFetch });
    expect(r1.expired).toBeGreaterThanOrEqual(1);
    expect(r1.settled).toBe(1);
    expect(await balance()).toBe(b0 + amounts[paid]);
    expect((await intent(paid)).status).toBe("paid");
    expect((await intent(stale)).status).toBe("failed");
    expect((await intent(stale)).failure_reason).toMatch(/expired/);
    expect((await intent(abandoned)).status).toBe("pending");
    expect((await intent(abandoned)).check_count).toBe(1);
    expect(verifyCalls).not.toContain(fresh);
    expect(verifyCalls).not.toContain(stale);
    expect((await intent(fresh)).check_count).toBe(0);

    // Second run right away: nothing is re-checked (5-minute back-off), nothing is credited twice.
    verifyCalls = [];
    const r2 = await reconcileWalletTopups({ admin, secret: SECRET, fetchImpl: fakeFetch });
    expect(r2.settled).toBe(0);
    expect(verifyCalls).not.toContain(paid);
    expect(verifyCalls).not.toContain(abandoned);
    expect(await balance()).toBe(b0 + amounts[paid]);
  });
});
