import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_TIERS, getTier, SUBSCRIPTION_TIERS } from "../../frontend/src/lib/subscription-tiers";

/**
 * ENT-01 — the application tier catalog and the database entitlement catalog must agree on who gets paid SMS.
 *
 * PostgreSQL is authoritative (public.tier_sms_entitled). This test reads the migrations that define the database catalog and derives,
 * for every tier, whether its plan carries the sms feature with a positive quota, then compares that with
 * SUBSCRIPTION_TIERS[tier].features.sms_notifications. It is a drift tripwire for the two definitions; the database behavior itself is
 * proven by tests/integration/ent-01-subscription-authorization.local.sql against a real PostgreSQL.
 */
const migrations = path.resolve(__dirname, "../../database/supabase/migrations");
const read = (file: string) => readFileSync(path.join(migrations, file), "utf8");
const BASE = read("20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql");
const ENT01 = read("20261104051000_sherivs_ent01_subscription_authorization.sql");

function section(sql: string, from: string, to: string): string {
  const a = sql.indexOf(from);
  const b = sql.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`marker not found: ${from} .. ${to}`);
  return sql.slice(a, b);
}

function parsePlans(sql: string): Map<string, string[]> {
  const plans = new Map<string, string[]>();
  for (const m of sql.matchAll(/\('(\w+)',\s*ARRAY\[([^\]]*)\]\)/g)) {
    plans.set(
      m[1],
      [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]),
    );
  }
  return plans;
}

function effectiveSmsEntitlement(): Record<string, boolean> {
  // Base catalog (migration 016).
  const plans = parsePlans(
    section(BASE, "INSERT INTO public.entitlement_plans", "-- PLACEHOLDER quotas"),
  );
  const smsQuota = new Map<string, number>();
  for (const m of BASE.matchAll(/\('(\w+)',\s*'sms',\s*(\d+),\s*'month'\)/g))
    smsQuota.set(m[1], Number(m[2]));
  const tierPlan = new Map<string, string>();
  const tierRows = section(
    BASE,
    "INSERT INTO public.subscription_tier_plans",
    "ON CONFLICT (tier) DO NOTHING",
  );
  for (const m of tierRows.matchAll(/\('(\w+)',\s*'(\w+)'\)/g)) tierPlan.set(m[1], m[2]);

  // ENT-01 changes, each asserted to be present in the migration text before it is applied here.
  for (const [id, features] of parsePlans(
    section(ENT01, "INSERT INTO public.entitlement_plans", "ON CONFLICT"),
  ))
    plans.set(id, features);
  expect(ENT01).toMatch(/array_remove\(features, 'sms'\) WHERE id = 'starter'/);
  plans.set(
    "starter",
    (plans.get("starter") ?? []).filter((f) => f !== "sms"),
  );
  expect(ENT01).toMatch(/plan_id IN \('trial', 'starter'\) AND meter = 'sms'/);
  smsQuota.set("trial", 0);
  smsQuota.set("starter", 0);
  expect(ENT01).toMatch(/VALUES \('trial', 'trial'\)/);
  tierPlan.set("trial", "trial");

  const out: Record<string, boolean> = {};
  for (const tier of ALL_TIERS) {
    const plan = tierPlan.get(tier);
    out[tier] =
      plan !== undefined &&
      (plans.get(plan) ?? []).includes("sms") &&
      (smsQuota.get(plan) ?? 0) > 0;
  }
  return out;
}

describe("ENT-01 application and database entitlement catalogs agree", () => {
  const db = effectiveSmsEntitlement();

  it("every tier the application knows has an explicit database plan mapping", () => {
    for (const tier of ALL_TIERS) expect(db[tier], tier).not.toBeUndefined();
  });

  it.each(ALL_TIERS)("paid SMS entitlement for %s is the same in both catalogs", (tier) => {
    expect(db[tier]).toBe(SUBSCRIPTION_TIERS[tier].features.sms_notifications);
  });

  it("trial and starter have no paid SMS; growth, professional and enterprise do", () => {
    expect(db).toEqual({
      trial: false,
      starter: false,
      growth: true,
      professional: true,
      enterprise: true,
    });
  });

  it("an unknown or missing tier resolves to trial in the application and is not entitled", () => {
    expect(getTier(undefined)).toBe("trial");
    expect(getTier("platinum")).toBe("trial");
    expect(SUBSCRIPTION_TIERS[getTier("platinum")].features.sms_notifications).toBe(false);
  });

  it("new organizations default to trial in the database", () => {
    expect(ENT01).toMatch(/ALTER COLUMN subscription_tier SET DEFAULT 'trial'/);
  });
});
