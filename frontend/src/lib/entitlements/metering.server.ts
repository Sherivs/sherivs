/**
 * Sherivs — per-organization entitlements, quotas and usage metering.
 *
 * A plan grants features and quotas per meter (AI requests per member/day,
 * code generations, SMS, WhatsApp, voice minutes, storage MB). Every use is
 * checked BEFORE the provider call (`authorize`), then committed (`commit`).
 * At 80% an alert fires once per period; at 100% the hard cut-off denies.
 * An admin override raises a limit temporarily and must carry a reason and
 * expiry; every override is written to the audit chain.
 */
import type { AuditChain } from "../trust-ledger/hash-chain.server";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

const timeAuthority = new TimeAuthority(new SystemClock());

export type Meter = "ai_requests_per_member_day" | "code_generations" | "sms" | "whatsapp" | "voice_minutes" | "storage_mb";
export type Period = "day" | "month" | "none";
export interface Quota { meter: Meter; limit: number; period: Period }
export interface Plan { id: string; features: string[]; quotas: Quota[] }
/** Decision 2026-10-22: limit overrides are super-admin only (no school-admin overrides). */
export type OverrideApproverRole = "super_admin";
export interface Override { meter: Meter; extra: number; reason: string; approvedBy: string; approverRole: OverrideApproverRole; expiresAt: Date }

export interface UsageStore {
  used(orgId: string, meter: Meter, periodKey: string, subjectId?: string): Promise<number>;
  add(orgId: string, meter: Meter, periodKey: string, qty: number, subjectId?: string): Promise<void>;
  alertSent(orgId: string, meter: Meter, periodKey: string, level: number): Promise<boolean>;
  markAlert(orgId: string, meter: Meter, periodKey: string, level: number): Promise<void>;
}
export interface Alerter { notify(a: { orgId: string; meter: Meter; level: 80 | 100; used: number; limit: number }): Promise<void> }

export const PLANS: Record<string, Plan> = {
  starter: { id: "starter", features: ["sms", "email"], quotas: [
    { meter: "ai_requests_per_member_day", limit: 5, period: "day" }, { meter: "code_generations", limit: 0, period: "month" },
    { meter: "sms", limit: 500, period: "month" }, { meter: "whatsapp", limit: 0, period: "month" },
    { meter: "voice_minutes", limit: 0, period: "month" }, { meter: "storage_mb", limit: 2048, period: "none" } ] },
  growth: { id: "growth", features: ["sms", "email", "whatsapp", "ai_assistant"], quotas: [
    { meter: "ai_requests_per_member_day", limit: 20, period: "day" }, { meter: "code_generations", limit: 50, period: "month" },
    { meter: "sms", limit: 3000, period: "month" }, { meter: "whatsapp", limit: 2000, period: "month" },
    { meter: "voice_minutes", limit: 60, period: "month" }, { meter: "storage_mb", limit: 20480, period: "none" } ] },
};

export function periodKey(p: Period, at: Date): string {
  const iso = at.toISOString();
  return p === "day" ? iso.slice(0, 10) : p === "month" ? iso.slice(0, 7) : "all";
}

export type Decision = { allowed: true; remaining: number } | { allowed: false; reason: "feature_not_in_plan" | "quota_exceeded" | "invalid_quantity" };

export class EntitlementService {
  private overrides = new Map<string, Override[]>();
  constructor(private readonly deps: { store: UsageStore; planOf: (orgId: string) => Promise<Plan>; audit: AuditChain; alerter: Alerter; now?: () => Date }) {}
  private now() { return this.deps.now ? this.deps.now() : new Date(timeAuthority.now().atMs); }

  hasFeature = async (orgId: string, feature: string) => (await this.deps.planOf(orgId)).features.includes(feature);

  private async limitFor(orgId: string, meter: Meter): Promise<Quota | null> {
    const q = (await this.deps.planOf(orgId)).quotas.find((x) => x.meter === meter);
    if (!q) return null;
    const extra = (this.overrides.get(orgId) ?? []).filter((o) => o.meter === meter && o.expiresAt > this.now()).reduce((s, o) => s + o.extra, 0);
    return { ...q, limit: q.limit + extra };
  }

  async authorize(orgId: string, meter: Meter, qty = 1, subjectId?: string): Promise<Decision> {
    if (!Number.isFinite(qty) || qty <= 0) return { allowed: false, reason: "invalid_quantity" };
    const q = await this.limitFor(orgId, meter);
    if (!q || q.limit <= 0) return { allowed: false, reason: "feature_not_in_plan" };
    const pk = periodKey(q.period, this.now());
    const perSubject = meter === "ai_requests_per_member_day" ? subjectId : undefined;
    const used = await this.deps.store.used(orgId, meter, pk, perSubject);
    if (used + qty > q.limit) return { allowed: false, reason: "quota_exceeded" };
    return { allowed: true, remaining: q.limit - used - qty };
  }

  /** Record usage after the provider call succeeded; fires 80% / 100% alerts once per period. */
  async commit(orgId: string, meter: Meter, qty = 1, subjectId?: string): Promise<void> {
    const q = await this.limitFor(orgId, meter); if (!q) return;
    const pk = periodKey(q.period, this.now());
    const perSubject = meter === "ai_requests_per_member_day" ? subjectId : undefined;
    await this.deps.store.add(orgId, meter, pk, qty, perSubject);
    if (perSubject) return; // per-member meters are not org-level alerts
    const used = await this.deps.store.used(orgId, meter, pk);
    for (const level of [100, 80] as const) {
      if (used >= (q.limit * level) / 100) {
        if (!(await this.deps.store.alertSent(orgId, meter, pk, level))) {
          await this.deps.store.markAlert(orgId, meter, pk, level);
          await this.deps.alerter.notify({ orgId, meter, level, used, limit: q.limit });
        }
        break;
      }
    }
  }

  /** Admin override: temporary extra quota, reason + expiry required, always audited. */
  async grantOverride(orgId: string, o: Override, ctx: { ip?: string; device?: string } = {}): Promise<void> {
    if ((o as { approverRole?: string }).approverRole !== "super_admin") throw new Error("entitlements: overrides require super_admin");
    if (o.reason.trim().length < 10) throw new Error("entitlements: override needs a reason");
    if (!(o.extra > 0) || o.expiresAt <= this.now()) throw new Error("entitlements: invalid override");
    if (o.expiresAt.getTime() - this.now().getTime() > 31 * 86_400_000) throw new Error("entitlements: override longer than 31 days");
    const before = (await this.limitFor(orgId, o.meter))?.limit ?? 0;
    this.overrides.set(orgId, [...(this.overrides.get(orgId) ?? []), o]);
    await this.deps.audit.record({ orgId, actorKind: "user", actorId: o.approvedBy, action: "entitlement.override",
      targetType: "meter", targetId: o.meter, ip: ctx.ip, device: ctx.device,
      before: { limit: before }, after: { limit: before + o.extra, reason: o.reason, approverRole: o.approverRole, expiresAt: o.expiresAt.toISOString() } });
  }
}

export class InMemoryUsageStore implements UsageStore {
  private u = new Map<string, number>(); private a = new Set<string>();
  private k(...p: (string | number | undefined)[]) { return p.map((x) => x ?? "").join("|"); }
  async used(o: string, m: Meter, p: string, s?: string) { return this.u.get(this.k(o, m, p, s)) ?? 0; }
  async add(o: string, m: Meter, p: string, q: number, s?: string) {
    this.u.set(this.k(o, m, p, s), (this.u.get(this.k(o, m, p, s)) ?? 0) + q);
    if (s) return; // org totals tracked separately from per-member
  }
  async alertSent(o: string, m: Meter, p: string, l: number) { return this.a.has(this.k(o, m, p, l)); }
  async markAlert(o: string, m: Meter, p: string, l: number) { this.a.add(this.k(o, m, p, l)); }
}
