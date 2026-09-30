/**
 * CoreGrid — Phase 13 payment routing unit tests (financial-routing).
 *
 * The laws under test (Phase 13 Z, AA, DQ):
 * - routing is a decision over DECLARED provider capabilities, never a hard-coded
 *   provider, and an unroutable requirement is reported rather than forced;
 * - capability dominates preference: policy can order eligible candidates but can
 *   never make an ineligible provider eligible;
 * - failover is refused after a success, after an unresolved timeout and without
 *   proof that no capture occurred — that refusal is what stops double-charging;
 * - every decision is explainable: candidates, disqualifiers and policy.
 */

import { describe, expect, it } from "vitest";
import {
  canFailover,
  explainRoutingDecision,
  providerSupportsSplit,
  selectPaymentRoute,
  type ProviderProfile,
} from "@/lib/financial-routing";

function provider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    providerId: "provider-a",
    displayName: "Provider A",
    active: true,
    feeBasisPoints: 150,
    capabilities: {
      paymentMethods: ["card", "bank_transfer"],
      currencies: ["GBP", "EUR"],
      jurisdictions: ["GB"],
      supportsPartialRefund: true,
      supportsSplit: true,
      captureModel: "immediate",
      webhookSignatureScheme: "hmac-sha256",
    },
    ...overrides,
  };
}

const REQUIREMENT = { currency: "GBP", paymentMethod: "card" as const, jurisdiction: "GB" };

describe("routing is a decision over declared capabilities", () => {
  it("selects a provider that declares the required capability", () => {
    const decision = selectPaymentRoute({ providers: [provider()], requirement: REQUIREMENT });
    expect(decision.providerId).toBe("provider-a");
    expect(decision.candidates[0].eligible).toBe(true);
  });

  it("reports an unroutable requirement instead of forcing a provider", () => {
    const decision = selectPaymentRoute({
      providers: [provider({ capabilities: { ...provider().capabilities, currencies: ["USD"] } })],
      requirement: REQUIREMENT,
    });
    expect(decision.providerId).toBeNull();
    expect(decision.reason).toContain("no declared provider capability");
  });

  it("lets capability dominate preference: a preferred provider that cannot serve is refused", () => {
    const decision = selectPaymentRoute({
      providers: [
        provider({
          providerId: "provider-preferred",
          capabilities: { ...provider().capabilities, jurisdictions: ["US"] },
        }),
        provider({ providerId: "provider-capable", feeBasisPoints: 300 }),
      ],
      requirement: REQUIREMENT,
      policy: { preferredProviderIds: ["provider-preferred"] },
    });
    expect(decision.providerId).toBe("provider-capable");
    const refused = decision.candidates.find(
      (candidate) => candidate.providerId === "provider-preferred",
    );
    expect(refused?.disqualifiedBy).toContain("jurisdiction");
  });

  it("ranks eligible providers by preference first and declared cost second", () => {
    const cheap = provider({ providerId: "provider-cheap", feeBasisPoints: 50 });
    const pricey = provider({ providerId: "provider-pricey", feeBasisPoints: 400 });
    expect(
      selectPaymentRoute({ providers: [pricey, cheap], requirement: REQUIREMENT }).providerId,
    ).toBe("provider-cheap");
    expect(
      selectPaymentRoute({
        providers: [pricey, cheap],
        requirement: REQUIREMENT,
        policy: { preferredProviderIds: ["provider-pricey"] },
      }).providerId,
    ).toBe("provider-pricey");
  });

  it("disqualifies on split support, partial refunds, inactivity and a cost ceiling", () => {
    const noSplit = selectPaymentRoute({
      providers: [provider({ capabilities: { ...provider().capabilities, supportsSplit: false } })],
      requirement: { ...REQUIREMENT, requiresSplit: true },
    });
    expect(noSplit.providerId).toBeNull();

    const noPartial = selectPaymentRoute({
      providers: [
        provider({ capabilities: { ...provider().capabilities, supportsPartialRefund: false } }),
      ],
      requirement: { ...REQUIREMENT, requiresPartialRefund: true },
    });
    expect(noPartial.providerId).toBeNull();

    const inactive = selectPaymentRoute({
      providers: [provider({ active: false })],
      requirement: REQUIREMENT,
    });
    expect(inactive.providerId).toBeNull();

    const tooExpensive = selectPaymentRoute({
      providers: [provider({ feeBasisPoints: 900 })],
      requirement: REQUIREMENT,
      policy: { maxFeeBasisPoints: 200 },
    });
    expect(tooExpensive.providerId).toBeNull();
  });

  it("explains every candidate and the policy that applied", () => {
    const providers = [
      provider(),
      provider({
        providerId: "provider-b",
        capabilities: { ...provider().capabilities, currencies: ["USD"] },
      }),
    ];
    const decision = selectPaymentRoute({
      providers,
      requirement: REQUIREMENT,
      policy: { maxFeeBasisPoints: 200 },
    });
    const explanation = explainRoutingDecision(decision, providers);
    expect(explanation).toContain("provider-a");
    expect(explanation).toContain("provider-b");
    expect(explanation).toContain("cost ceiling 200 basis points");
  });

  it("knows which providers can carry a split at all", () => {
    expect(providerSupportsSplit(provider())).toBe(true);
    expect(
      providerSupportsSplit(
        provider({ capabilities: { ...provider().capabilities, supportsSplit: false } }),
      ),
    ).toBe(false);
    expect(providerSupportsSplit(provider({ active: false }))).toBe(false);
  });
});

describe("failover can never double-charge", () => {
  it("refuses failover after a successful attempt", () => {
    const decision = canFailover({
      attempt: { providerId: "provider-a", outcome: "succeeded", providerProvedNoCapture: true },
      toProviderId: "provider-b",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("same money twice");
  });

  it("refuses failover while a timeout is unresolved, because a timeout is not a failure", () => {
    const decision = canFailover({
      attempt: {
        providerId: "provider-a",
        outcome: "unresolved_timeout",
        providerProvedNoCapture: true,
      },
      toProviderId: "provider-b",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("timeout is not a failure");
  });

  it("refuses failover without proof that no capture occurred", () => {
    const decision = canFailover({
      attempt: { providerId: "provider-a", outcome: "failed", providerProvedNoCapture: false },
      toProviderId: "provider-b",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("has not proved");
  });

  it("allows failover only after a decline or failure with proof of no capture", () => {
    const decision = canFailover({
      attempt: { providerId: "provider-a", outcome: "declined", providerProvedNoCapture: true },
      toProviderId: "provider-b",
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.toProviderId).toBe("provider-b");
  });

  it("refuses a failover to the same provider", () => {
    const decision = canFailover({
      attempt: { providerId: "provider-a", outcome: "declined", providerProvedNoCapture: true },
      toProviderId: "provider-a",
    });
    expect(decision.allowed).toBe(false);
  });
});
