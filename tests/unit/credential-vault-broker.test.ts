import { describe, expect, it } from "vitest";
import {
  CredentialBroker, CredentialVault, InMemoryAccessLog, InMemoryCredentialStore, LocalKms,
  MAX_GRANT_TTL_SECONDS, type Grant, type PolicyRule,
} from "@/lib/credential-vault";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const FAKE = "test-value-not-a-real-key-0001";

function setup(now = { t: new Date("2026-10-22T08:00:00Z") }) {
  const kms = new LocalKms();
  const store = new InMemoryCredentialStore();
  const vault = new CredentialVault(kms, store, () => now.t);
  const log = new InMemoryAccessLog();
  const notified: Grant[] = [];
  const policy: PolicyRule[] = [
    { agentId: "n8n:fee-reminders", provider: "whatsapp", actions: ["send_message"] },
    { agentId: "jarvis", provider: "paystack", actions: ["refund"], critical: true },
  ];
  const broker = new CredentialBroker({ vault, policy, log, now: () => now.t, approver: { notify: async (g) => { notified.push(g); } } });
  return { kms, store, vault, log, broker, now, notified };
}
const purpose = "Send fee reminder for task 881";

describe("credential vault (envelope encryption)", () => {
  it("stores only ciphertext and a wrapped per-org data key", async () => {
    const { vault, store } = setup();
    await vault.put({ orgId: ORG_A, provider: "whatsapp", name: "access_token", secret: FAKE, actor: "admin" });
    const rec = await store.get(ORG_A, "whatsapp", "access_token");
    expect(rec).not.toBeNull();
    expect(JSON.stringify(rec)).not.toContain(FAKE);
    expect(rec!.keyVersion).toBe("local-v1");
    expect(await vault.withCredential(ORG_A, "whatsapp", "access_token", async (s) => s.length)).toBe(FAKE.length);
  });

  it("refuses ciphertext moved to another organization (context binding)", async () => {
    const { vault, store } = setup();
    await vault.put({ orgId: ORG_A, provider: "whatsapp", name: "access_token", secret: FAKE, actor: "admin" });
    const rec = (await store.get(ORG_A, "whatsapp", "access_token"))!;
    await store.put({ ...rec, orgId: ORG_B });
    await expect(vault.withCredential(ORG_B, "whatsapp", "access_token", async () => 1)).rejects.toThrow();
  });

  it("rotation re-encrypts with a fresh data key and records rotated_at", async () => {
    const { vault, store } = setup();
    await vault.put({ orgId: ORG_A, provider: "paystack", name: "secret_key", secret: FAKE, actor: "admin" });
    const first = (await store.get(ORG_A, "paystack", "secret_key"))!;
    await vault.put({ orgId: ORG_A, provider: "paystack", name: "secret_key", secret: FAKE + "x", actor: "admin" });
    const second = (await store.get(ORG_A, "paystack", "secret_key"))!;
    expect(second.wrappedDek).not.toBe(first.wrappedDek);
    expect(second.rotatedAt).not.toBeNull();
    expect(second.id).toBe(first.id);
  });
});

describe("credential broker", () => {
  it("issues a short-lived single-use grant; agent never sees the secret", async () => {
    const { vault, broker, log } = setup();
    await vault.put({ orgId: ORG_A, provider: "whatsapp", name: "access_token", secret: FAKE, actor: "admin" });
    const scope = { orgId: ORG_A, provider: "whatsapp", name: "access_token", action: "send_message" };
    const g = await broker.request({ agentId: "n8n:fee-reminders", scope, purpose, ttlSeconds: 3600 });
    expect(g.status).toBe("approved");
    expect(broker.getGrant(g.grantId)!.ttlSeconds).toBe(MAX_GRANT_TTL_SECONDS);
    const result = await broker.redeem({ grantId: g.grantId, agentId: "n8n:fee-reminders", token: g.token!, action: "send_message" },
      async (secret) => (secret === FAKE ? "sent" : "wrong"));
    expect(result).toBe("sent");
    await expect(broker.redeem({ grantId: g.grantId, agentId: "n8n:fee-reminders", token: g.token!, action: "send_message" }, async () => 1)).rejects.toThrow(/not redeemable/);
    const events = (await log.forOrg(ORG_A)).map((e) => e.event);
    expect(events).toEqual(["requested", "issued", "redeemed", "redeem_rejected"]);
    expect(JSON.stringify(await log.forOrg(ORG_A))).not.toContain(FAKE);
  });

  it("denies requests with no policy, and scopes outside the grant", async () => {
    const { vault, broker } = setup();
    await vault.put({ orgId: ORG_A, provider: "whatsapp", name: "access_token", secret: FAKE, actor: "admin" });
    await expect(broker.request({ agentId: "unknown", scope: { orgId: ORG_A, provider: "whatsapp", name: "access_token", action: "send_message" }, purpose })).rejects.toThrow(/denied/);
    const g = await broker.request({ agentId: "n8n:fee-reminders", scope: { orgId: ORG_A, provider: "whatsapp", name: "access_token", action: "send_message" }, purpose });
    await expect(broker.redeem({ grantId: g.grantId, agentId: "n8n:fee-reminders", token: g.token!, action: "delete_template" }, async () => 1)).rejects.toThrow(/outside scope/);
    await expect(broker.redeem({ grantId: g.grantId, agentId: "jarvis", token: g.token!, action: "send_message" }, async () => 1)).rejects.toThrow(/wrong agent/);
  });

  it("expires after the TTL", async () => {
    const { vault, broker, now } = setup();
    await vault.put({ orgId: ORG_A, provider: "whatsapp", name: "access_token", secret: FAKE, actor: "admin" });
    const g = await broker.request({ agentId: "n8n:fee-reminders", scope: { orgId: ORG_A, provider: "whatsapp", name: "access_token", action: "send_message" }, purpose, ttlSeconds: 60 });
    now.t = new Date(now.t.getTime() + 61_000);
    await expect(broker.redeem({ grantId: g.grantId, agentId: "n8n:fee-reminders", token: g.token!, action: "send_message" }, async () => 1)).rejects.toThrow(/expired/);
  });

  it("critical scopes wait for human approval and cannot be self-approved", async () => {
    const { vault, broker, notified, log } = setup();
    await vault.put({ orgId: ORG_A, provider: "paystack", name: "secret_key", secret: FAKE, actor: "admin" });
    const scope = { orgId: ORG_A, provider: "paystack", name: "secret_key", action: "refund" };
    const g = await broker.request({ agentId: "jarvis", scope, purpose: "Refund duplicate fee payment #4410" });
    expect(g.status).toBe("pending_approval");
    expect(g.token).toBeUndefined();
    expect(notified).toHaveLength(1);
    await expect(broker.decide(g.grantId, "jarvis", true)).rejects.toThrow(/own grants/);
    const d = await broker.decide(g.grantId, "muhammad", true);
    expect(d.status).toBe("approved");
    expect(await broker.redeem({ grantId: g.grantId, agentId: "jarvis", token: d.token!, action: "refund" }, async () => "ok")).toBe("ok");
    const approved = (await log.forOrg(ORG_A)).find((e) => e.event === "approved");
    expect(approved?.actor).toBe("muhammad");
  });

  it("sweeps unused grants to expired", async () => {
    const { vault, broker, now } = setup();
    await vault.put({ orgId: ORG_A, provider: "whatsapp", name: "access_token", secret: FAKE, actor: "admin" });
    await broker.request({ agentId: "n8n:fee-reminders", scope: { orgId: ORG_A, provider: "whatsapp", name: "access_token", action: "send_message" }, purpose });
    now.t = new Date(now.t.getTime() + 301_000);
    expect(await broker.expireStale()).toBe(1);
  });
});
