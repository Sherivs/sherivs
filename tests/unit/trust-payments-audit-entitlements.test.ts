import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { SplitPaymentBinder, assertTestSecret, type BindingStore, type StoredIntent, type Subaccount } from "@/lib/payments/split-binding.server";
import { AuditChain, InMemoryChainStore } from "@/lib/trust-ledger/hash-chain.server";
import { EntitlementService, InMemoryUsageStore, PLANS } from "@/lib/entitlements/metering.server";

const ORG_A = "org-a", ORG_B = "org-b";
const SK = "sk_test_" + "x".repeat(32); // fake test key
const SIGNING = "s".repeat(48);

function bindingStore() {
  const ben = new Map<string, string>([["ben-1", ORG_A], ["ben-2", ORG_B]]);
  const subs = new Map<string, Subaccount>([
    [ORG_A, { orgId: ORG_A, subaccountCode: "ACCT_aaa", active: true, platformChargeKobo: 10_000 }],
    [ORG_B, { orgId: ORG_B, subaccountCode: "ACCT_bbb", active: true, platformChargeKobo: 10_000 }],
  ]);
  const intents = new Map<string, StoredIntent>();
  const store: BindingStore = {
    orgOfBeneficiary: async (id) => ben.get(id) ?? null,
    subaccountOf: async (o) => subs.get(o) ?? null,
    saveIntent: async (i) => { intents.set(i.reference, { ...i }); },
    intentByReference: async (r) => intents.get(r) ?? null,
    markIntent: async (r, s, reason) => { const i = intents.get(r); if (i) { i.status = s; (i as StoredIntent & { reason?: string }).reason = reason; } },
  };
  return { store, ben, subs, intents };
}
function webhook(data: Record<string, unknown>) {
  const raw = Buffer.from(JSON.stringify({ event: "charge.success", data: { status: "success", currency: "NGN", ...data } }));
  return { rawBody: new Uint8Array(raw), headers: { "x-paystack-signature": createHmac("sha512", SK).update(raw).digest("hex") }, paystackSecret: SK };
}

describe("Paystack split binding", () => {
  it("binds beneficiary -> org -> subaccount server-side and credits only the right org", async () => {
    const { store } = bindingStore();
    const b = new SplitPaymentBinder({ store, intentSigningKey: SIGNING, now: () => 1_000 });
    const { intent, signature, initializeBody } = await b.createIntent({ reference: "ref-1", beneficiaryId: "ben-1", payerId: "payer-1", amountKobo: 5_000_000, purpose: "term invoice", email: "p@example.com" });
    expect(intent.orgId).toBe(ORG_A);
    expect(initializeBody.subaccount).toBe("ACCT_aaa");
    expect(initializeBody.bearer).toBe("subaccount");
    const r = await b.reconcileWebhook(webhook({ reference: "ref-1", amount: 5_000_000, subaccount: { subaccount_code: "ACCT_aaa" }, metadata: { sherivs_sig: signature } }));
    expect(r).toEqual({ ok: true, orgId: ORG_A, reference: "ref-1" });
    const again = await b.reconcileWebhook(webhook({ reference: "ref-1", amount: 5_000_000, subaccount: { subaccount_code: "ACCT_aaa" }, metadata: { sherivs_sig: signature } }));
    expect(again.ok).toBe(false);
  });

  it("quarantines a payment routed to another org's subaccount", async () => {
    const { store, intents } = bindingStore();
    const b = new SplitPaymentBinder({ store, intentSigningKey: SIGNING, now: () => 1_000 });
    const { signature } = await b.createIntent({ reference: "ref-2", beneficiaryId: "ben-1", payerId: "p", amountKobo: 200_000, purpose: "invoice", email: "p@example.com" });
    const r = await b.reconcileWebhook(webhook({ reference: "ref-2", amount: 200_000, subaccount: { subaccount_code: "ACCT_bbb" }, metadata: { sherivs_sig: signature } }));
    expect(r).toMatchObject({ ok: false, reason: "subaccount mismatch" });
    expect(intents.get("ref-2")!.status).toBe("quarantined");
  });

  it("rejects bad HMAC, amount tampering, rebinding and live keys", async () => {
    const { store, ben } = bindingStore();
    const b = new SplitPaymentBinder({ store, intentSigningKey: SIGNING, now: () => 1_000 });
    const { signature } = await b.createIntent({ reference: "ref-3", beneficiaryId: "ben-1", payerId: "p", amountKobo: 200_000, purpose: "invoice", email: "p@example.com" });
    const w = webhook({ reference: "ref-3", amount: 200_000, subaccount: { subaccount_code: "ACCT_aaa" }, metadata: { sherivs_sig: signature } });
    expect((await b.reconcileWebhook({ ...w, headers: { "x-paystack-signature": "ab".repeat(64) } })).ok).toBe(false);
    expect(await b.reconcileWebhook(webhook({ reference: "ref-3", amount: 100, subaccount: { subaccount_code: "ACCT_aaa" }, metadata: { sherivs_sig: signature } }))).toMatchObject({ reason: "amount or currency mismatch" });
    const { signature: s4 } = await b.createIntent({ reference: "ref-4", beneficiaryId: "ben-1", payerId: "p", amountKobo: 200_000, purpose: "invoice", email: "p@example.com" });
    ben.set("ben-1", ORG_B);
    expect(await b.reconcileWebhook(webhook({ reference: "ref-4", amount: 200_000, subaccount: { subaccount_code: "ACCT_aaa" }, metadata: { sherivs_sig: s4 } }))).toMatchObject({ reason: "beneficiary binding changed" });
    expect(() => assertTestSecret("sk_live_abc")).toThrow();
  });
});

describe("audit hash chain", () => {
  it("chains entries per org and detects tampering, deletion and reordering", async () => {
    const store = new InMemoryChainStore();
    let t = 0; const chain = new AuditChain(store, () => `2026-10-22T08:00:0${t++}Z`);
    await Promise.all([1, 2, 3].map((n) => chain.record({ orgId: ORG_A, actorKind: "agent", actorId: "jarvis", action: "record.update", targetType: "record", targetId: `r${n}`, ip: "10.0.0.1", before: { v: n }, after: { v: n + 1 } })));
    await chain.record({ orgId: ORG_B, actorKind: "system", actorId: "cron", action: "job.run", targetType: "job", targetId: "j1" });
    const a = await store.list(ORG_A);
    expect(a.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(JSON.stringify(a)).not.toContain('"v":');
    expect(AuditChain.verify(a).ok).toBe(true);
    expect(AuditChain.verify([{ ...a[0], targetId: "evil" }, a[1], a[2]])).toMatchObject({ ok: false, brokenAt: 1 });
    expect(AuditChain.verify([a[0], a[2]])).toMatchObject({ ok: false });
    expect(AuditChain.verify(await store.list(ORG_B)).ok).toBe(true);
  });
});

describe("entitlements and metering", () => {
  function svc(plan = PLANS.growth) {
    const alerts: { level: number }[] = [];
    const chain = new AuditChain(new InMemoryChainStore());
    const s = new EntitlementService({ store: new InMemoryUsageStore(), planOf: async () => plan, audit: chain, alerter: { notify: async (a) => { alerts.push(a); } }, now: () => new Date("2026-10-22T09:00:00Z") });
    return { s, alerts, chain };
  }
  it("alerts once at 80%, hard-stops at 100%", async () => {
    const { s, alerts } = svc({ id: "t", features: [], quotas: [{ meter: "sms", limit: 10, period: "month" }] });
    for (let k = 0; k < 8; k++) { expect((await s.authorize(ORG_A, "sms")).allowed).toBe(true); await s.commit(ORG_A, "sms"); }
    expect(alerts.map((a) => a.level)).toEqual([80]);
    await s.commit(ORG_A, "sms"); await s.commit(ORG_A, "sms", 1);
    expect(alerts.map((a) => a.level)).toEqual([80, 100]);
    expect(await s.authorize(ORG_A, "sms")).toEqual({ allowed: false, reason: "quota_exceeded" });
  });
  it("limits AI per member per day and denies features not in plan", async () => {
    const { s } = svc(PLANS.starter);
    for (let k = 0; k < 5; k++) await s.commit(ORG_A, "ai_requests_per_member_day", 1, "m1");
    expect((await s.authorize(ORG_A, "ai_requests_per_member_day", 1, "m1")).allowed).toBe(false);
    expect((await s.authorize(ORG_A, "ai_requests_per_member_day", 1, "m2")).allowed).toBe(true);
    expect(await s.authorize(ORG_A, "whatsapp")).toEqual({ allowed: false, reason: "feature_not_in_plan" });
  });
  it("admin override raises the limit temporarily and is audited", async () => {
    const { s } = svc({ id: "t", features: [], quotas: [{ meter: "sms", limit: 1, period: "month" }] });
    const audit = new InMemoryChainStore();
    const s2 = new EntitlementService({ store: new InMemoryUsageStore(), planOf: async () => ({ id: "t", features: [], quotas: [{ meter: "sms", limit: 1, period: "month" }] }), audit: new AuditChain(audit), alerter: { notify: async () => {} }, now: () => new Date("2026-10-22T09:00:00Z") });
    await s2.commit(ORG_A, "sms");
    expect((await s2.authorize(ORG_A, "sms")).allowed).toBe(false);
    await expect(s2.grantOverride(ORG_A, { meter: "sms", extra: 100, reason: "x", approvedBy: "admin", approverRole: "super_admin", expiresAt: new Date("2026-10-30") })).rejects.toThrow();
    await s2.grantOverride(ORG_A, { meter: "sms", extra: 100, reason: "Exam-week reminders", approvedBy: "admin-1", approverRole: "super_admin", expiresAt: new Date("2026-10-30") }, { ip: "1.2.3.4" });
    await expect(s2.grantOverride(ORG_A, { meter: "sms", extra: 5, reason: "School admin attempt", approvedBy: "sa-1", approverRole: "school_admin" as never, expiresAt: new Date("2026-10-30") })).rejects.toThrow(/super_admin/);
    expect((await s2.authorize(ORG_A, "sms")).allowed).toBe(true);
    const log = await audit.list(ORG_A);
    expect(log[0]).toMatchObject({ action: "entitlement.override", actorId: "admin-1", ip: "1.2.3.4" });
    expect(AuditChain.verify(log).ok).toBe(true);
    expect(s).toBeDefined();
  });
});
