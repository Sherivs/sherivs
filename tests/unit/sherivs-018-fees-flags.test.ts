import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EDUCATION_RATE_DEFAULT, paystackFee } from "../../frontend/src/lib/scholar/billing/paystack-fee";

const sql = readFileSync("database/supabase/migrations/20261024000250_sherivs_018_fee_config_flags_rate_limit.sql", "utf8");
describe("SHERIVS-018 fee model", () => {
  it("education rate defaults", () => {
    expect(paystackFee(152000, "card")).toBe(1064);
    expect(paystackFee(1_000_000, "card")).toBe(1500);
    expect(paystackFee(152000, "bank_transfer")).toBe(300);
  });
  it("standard model is configurable", () => {
    const std = { ...EDUCATION_RATE_DEFAULT, mode: "standard" as const };
    expect(paystackFee(152000, "card", std)).toBe(2000);
    expect(paystackFee(2000, "card", std)).toBe(30);
  });
  it("migration keeps paystack_live locked and writes revoked", () => {
    expect(sql).toMatch(/\('paystack_live', false, true/);
    expect(sql).toMatch(/REVOKE ALL ON public\.payment_fee_config, public\.feature_flags, public\.rate_limit_events FROM anon, authenticated, service_role/);
  });
});
