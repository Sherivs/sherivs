/**
 * Mirror of public.paystack_fee (SHERIVS-018). Defaults are the Paystack education-rate
 * assumption; every number is configurable per platform/school in payment_fee_config.
 */
export type FeeConfig = {
  mode: "education" | "standard";
  edu_card_pct: number; edu_card_cap: number; edu_other_flat: number;
  std_pct: number; std_flat: number; std_flat_waived_below: number; std_cap: number;
};
export const EDUCATION_RATE_DEFAULT: FeeConfig = {
  mode: "education", edu_card_pct: 0.7, edu_card_cap: 1500, edu_other_flat: 300,
  std_pct: 1.5, std_flat: 100, std_flat_waived_below: 2500, std_cap: 2000,
};
const r2 = (n: number) => Math.round(n * 100) / 100;
export function paystackFee(amount: number, channel: "card" | string = "card", c: FeeConfig = EDUCATION_RATE_DEFAULT): number {
  if (!(amount > 0)) return 0;
  if (c.mode === "education") return channel === "card" ? r2(Math.min((amount * c.edu_card_pct) / 100, c.edu_card_cap)) : c.edu_other_flat;
  return r2(Math.min((amount * c.std_pct) / 100 + (amount < c.std_flat_waived_below ? 0 : c.std_flat), c.std_cap));
}
