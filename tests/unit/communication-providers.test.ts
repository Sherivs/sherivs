/**
 * CoreGrid — Phase 10 Communication Platform: provider adapter registry tests.
 *
 * The registry is where a live telephone path would enter the platform, so these tests
 * hold the boundary: a secret can never be written into an adapter, a provider is never
 * chosen by accident, and "no provider" is a refusal the caller can act on rather than
 * a silent success.
 */
import { describe, expect, it } from "vitest";

import {
  COMMUNICATION_CHANNEL_KINDS,
  PROVIDER_CATALOGUE,
  PROVIDER_LIFECYCLE_STATES,
  assertCredentialReference,
  auditProviderCatalogue,
  failoverChain,
  isProviderTransitionAllowed,
  isUsableProviderHealth,
  providerCapabilityMatrix,
  providersForChannel,
  selectProvider,
  type ProviderAdapter,
  type ProviderLifecycleState,
  type ProviderRegion,
} from "@/lib/communication-providers";

/** A catalogue entry with one field changed, so each test isolates one claim. */
function adapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return { ...PROVIDER_CATALOGUE[0], ...overrides };
}

describe("Phase 10 — provider credentials are references, never secrets", () => {
  it("accepts a reference that names a scheme", () => {
    for (const reference of [
      "secret://coregrid/communication/twilio",
      "vault://coregrid/communication/sendgrid",
      "kms://projects/coregrid/keys/telephony",
      "env://COREGRID_TWILIO_TOKEN",
      "internal://coregrid/presence",
    ]) {
      expect(assertCredentialReference(adapter({ credentialReference: reference })).ok).toBe(true);
    }
  });

  it("refuses an empty reference", () => {
    const result = assertCredentialReference(adapter({ credentialReference: "   " }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("empty");
  });

  it("refuses a reference with no scheme, because it is then just a string", () => {
    const result = assertCredentialReference(
      adapter({ credentialReference: "coregrid-communication-twilio" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("scheme");
  });

  it("refuses material that looks like a real provider key", () => {
    for (const reference of [
      "env://sk_live_51H8xQ2eZvKYlo2C",
      "secret://SG.abcdefghijklmnopqrst",
      "env://AKIAIOSFODNN7EXAMPLE",
      "vault://AC0123456789abcdef0123456789abcdef",
    ]) {
      const result = assertCredentialReference(adapter({ credentialReference: reference }));
      expect(result.ok, `${reference} must be refused`).toBe(false);
    }
  });

  it("holds every adapter in the catalogue to the same rule", () => {
    for (const entry of PROVIDER_CATALOGUE) {
      expect(
        assertCredentialReference(entry).ok,
        `${entry.id} must name a credential by reference`,
      ).toBe(true);
    }
  });
});

describe("Phase 10 — the catalogue describes the real provider market", () => {
  it("catalogues the providers the platform is designed to route through", () => {
    const ids = PROVIDER_CATALOGUE.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "twilio",
        "africas-talking",
        "vonage",
        "telnyx",
        "plivo",
        "messagebird",
        "exotel",
        "meta-whatsapp",
        "smtp-relay",
        "sendgrid",
        "postmark",
        "amazon-ses",
        "fcm",
        "apns",
        "web-push",
        "google-meet",
        "zoom",
        "meta-social",
        "x-social",
        "linkedin-social",
        "platform-presence",
      ]),
    );
    expect(ids.length).toBeGreaterThanOrEqual(20);
  });

  it("has no adapter without an id, a name, an owner-facing explanation or a channel", () => {
    for (const entry of PROVIDER_CATALOGUE) {
      expect(entry.id.length, "an adapter needs an id").toBeGreaterThan(2);
      expect(entry.displayName.length, `${entry.id} needs a display name`).toBeGreaterThan(2);
      expect(entry.notes.length, `${entry.id} must explain itself`).toBeGreaterThan(20);
      expect(entry.channels.length, `${entry.id} must carry a channel`).toBeGreaterThan(0);
      expect(entry.regions.length, `${entry.id} must declare where it operates`).toBeGreaterThan(0);
      for (const channel of entry.channels) {
        expect(COMMUNICATION_CHANNEL_KINDS, `${entry.id} claims an unknown channel`).toContain(
          channel,
        );
      }
    }
  });

  it("reports no findings about its own catalogue", () => {
    expect(auditProviderCatalogue()).toEqual([]);
  });

  it("keeps every external provider DISCOVERED: named and designed, not switched on", () => {
    for (const entry of PROVIDER_CATALOGUE) {
      if (entry.id === "platform-presence") continue;
      expect(entry.health, `${entry.id} must not claim a live path`).toBe("DISCOVERED");
    }
    const presence = PROVIDER_CATALOGUE.find((entry) => entry.id === "platform-presence");
    expect(presence?.health).toBe("ACTIVE");
    expect(presence?.credentialReference.startsWith("internal://")).toBe(true);
  });

  it("catalogues each entry exactly once", () => {
    const ids = PROVIDER_CATALOGUE.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Phase 10 — the provider lifecycle is a machine, not a label", () => {
  it("walks the designed path from discovery to retirement", () => {
    expect(isProviderTransitionAllowed("DISCOVERED", "CONFIGURED")).toBe(true);
    expect(isProviderTransitionAllowed("CONFIGURED", "VALIDATED")).toBe(true);
    expect(isProviderTransitionAllowed("VALIDATED", "ACTIVE")).toBe(true);
    expect(isProviderTransitionAllowed("ACTIVE", "DEGRADED")).toBe(true);
    expect(isProviderTransitionAllowed("DEGRADED", "ACTIVE")).toBe(true);
    expect(isProviderTransitionAllowed("SUSPENDED", "ACTIVE")).toBe(true);
    expect(isProviderTransitionAllowed("ACTIVE", "RETIRED")).toBe(true);
  });

  it("refuses to skip validation or resurrect a retired provider", () => {
    expect(isProviderTransitionAllowed("DISCOVERED", "ACTIVE")).toBe(false);
    expect(isProviderTransitionAllowed("CONFIGURED", "ACTIVE")).toBe(false);
    expect(isProviderTransitionAllowed("RETIRED", "ACTIVE")).toBe(false);
    expect(isProviderTransitionAllowed("RETIRED", "CONFIGURED")).toBe(false);
  });

  it("treats RETIRED as terminal", () => {
    expect(PROVIDER_LIFECYCLE_STATES.some((to) => isProviderTransitionAllowed("RETIRED", to))).toBe(
      false,
    );
  });

  it("lets a working provider be suspended, and a suspended one be restored", () => {
    for (const state of ["CONFIGURED", "VALIDATED", "ACTIVE", "DEGRADED"] as const) {
      expect(isProviderTransitionAllowed(state, "SUSPENDED"), `${state} must be suspendable`).toBe(
        true,
      );
    }
    expect(isProviderTransitionAllowed("SUSPENDED", "ACTIVE")).toBe(true);
  });

  it("treats only ACTIVE as usable without an explicit request", () => {
    expect(isUsableProviderHealth("ACTIVE")).toBe(true);
    for (const state of PROVIDER_LIFECYCLE_STATES) {
      if (state === "ACTIVE") continue;
      expect(isUsableProviderHealth(state), `${state} must not be usable by default`).toBe(false);
    }
  });
});

describe("Phase 10 — the capability matrix replaces a hard-coded provider", () => {
  it("lists every channel exactly once, in the declared order", () => {
    expect(providerCapabilityMatrix().map((row) => row.channel)).toEqual(
      COMMUNICATION_CHANNEL_KINDS,
    );
  });

  it("derives each channel's providers from the catalogue itself", () => {
    for (const row of providerCapabilityMatrix()) {
      expect(row.providers).toEqual(
        PROVIDER_CATALOGUE.filter((entry) => entry.channels.includes(row.channel)).map(
          (entry) => entry.id,
        ),
      );
      expect(row.providers.length, `${row.channel} must have a provider`).toBeGreaterThan(0);
    }
  });

  it("carries voice and WhatsApp on real carriers, and presence on the platform itself", () => {
    const voice = providersForChannel("voice").map((entry) => entry.id);
    expect(voice).toEqual(expect.arrayContaining(["twilio", "africas-talking", "vonage"]));

    expect(providersForChannel("whatsapp").map((entry) => entry.id)).toContain("meta-whatsapp");
    expect(providersForChannel("presence").map((entry) => entry.id)).toEqual(["platform-presence"]);
    expect(providersForChannel("email").map((entry) => entry.id)).toEqual(
      expect.arrayContaining(["smtp-relay", "sendgrid", "postmark", "amazon-ses"]),
    );
  });
});

describe("Phase 10 — routing refuses rather than guessing", () => {
  it("refuses when no adapter is live, and says what it rejected", () => {
    const result = selectProvider({ channel: "sms", region: "europe" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("No ACTIVE adapter for sms in europe");
    expect(result.candidates).toContain("twilio:DISCOVERED");
    expect(result.candidates.length).toBeGreaterThan(1);
  });

  it("chooses the declared primary once it is active", () => {
    const result = selectProvider({
      channel: "sms",
      region: "europe",
      healthOverrides: { twilio: "ACTIVE" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adapter.id).toBe("twilio");
    expect(result.usedDegraded).toBe(false);
    expect(result.reason).toContain("ACTIVE");
  });

  it("prefers the primary over an active secondary", () => {
    const result = selectProvider({
      channel: "sms",
      region: "europe",
      healthOverrides: { twilio: "ACTIVE", vonage: "ACTIVE" },
    });
    expect(result.ok && result.adapter.id).toBe("twilio");
  });

  it("prefers a regional carrier over a secondary one where the region is served", () => {
    const result = selectProvider({
      channel: "sms",
      region: "africa",
      healthOverrides: { "africas-talking": "ACTIVE", vonage: "ACTIVE" },
    });
    expect(result.ok && result.adapter.id).toBe("africas-talking");
  });

  it("never routes to a provider that does not serve the region", () => {
    const result = selectProvider({
      channel: "sms",
      region: "europe",
      healthOverrides: { "africas-talking": "ACTIVE", exotel: "ACTIVE" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.candidates.join(" ")).not.toContain("africas-talking");
    expect(result.candidates.join(" ")).not.toContain("exotel");
  });

  it("refuses an emergency broadcast on a provider that cannot carry one", () => {
    const result = selectProvider({
      channel: "sms",
      region: "europe",
      emergency: true,
      healthOverrides: { vonage: "ACTIVE" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.candidates.join(" ")).not.toContain("vonage");
  });

  it("honours a requirement for inbound capability", () => {
    const blocked = selectProvider({
      channel: "email",
      region: "global",
      requireInbound: true,
      healthOverrides: { sendgrid: "ACTIVE" },
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.candidates.join(" ")).not.toContain("sendgrid");

    const allowed = selectProvider({
      channel: "email",
      region: "global",
      requireInbound: true,
      healthOverrides: { "smtp-relay": "ACTIVE" },
    });
    expect(allowed.ok && allowed.adapter.id).toBe("smtp-relay");
  });

  it("honours a requirement for delivery receipts", () => {
    const blocked = selectProvider({
      channel: "email",
      region: "global",
      requireDeliveryReceipts: true,
      healthOverrides: { "smtp-relay": "ACTIVE" },
    });
    expect(blocked.ok).toBe(false);

    const allowed = selectProvider({
      channel: "email",
      region: "global",
      requireDeliveryReceipts: true,
      healthOverrides: { postmark: "ACTIVE" },
    });
    expect(allowed.ok && allowed.adapter.id).toBe("postmark");
  });

  it("uses a degraded provider only when the caller allowed it", () => {
    const degraded: Record<string, ProviderLifecycleState> = {
      twilio: "DEGRADED",
      vonage: "DEGRADED",
      telnyx: "DEGRADED",
      plivo: "DEGRADED",
      messagebird: "DEGRADED",
    };

    expect(selectProvider({ channel: "sms", region: "europe", healthOverrides: degraded }).ok).toBe(
      false,
    );

    const accepted = selectProvider({
      channel: "sms",
      region: "europe",
      healthOverrides: degraded,
      allowDegraded: true,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.usedDegraded).toBe(true);
    expect(accepted.adapter.id).toBe("twilio");
    expect(accepted.reason).toContain("DEGRADED");
  });

  it("tells the truth when adapters exist but none satisfies the requirement", () => {
    const result = selectProvider({ channel: "push", region: "global", requireInbound: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("none satisfies");
    expect(result.candidates.join(" ")).toContain("fcm");
  });
});

describe("Phase 10 — the failover ladder walks down tiers, not sideways", () => {
  const TIER_RANK: Record<string, number> = { primary: 0, regional: 1, secondary: 2, emergency: 3 };

  it("puts the primary first and never steps back up a tier", () => {
    const chain = failoverChain("sms", "europe");

    expect(chain[0].id).toBe("twilio");
    expect(chain[0].tier).toBe("primary");

    const ranks = chain.map((entry) => TIER_RANK[entry.tier]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("prefers the regional carrier where a region is served", () => {
    const chain = failoverChain("sms", "africa");

    expect(chain[0].id).toBe("twilio");
    expect(chain[1].id).toBe("africas-talking");
    expect(chain[1].tier).toBe("regional");
    expect(chain[2].tier).toBe("secondary");
  });

  it("carries only adapters that actually handle the channel", () => {
    const chain = failoverChain("voice", "global");
    const ids = chain.map((entry) => entry.id);
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const entry = PROVIDER_CATALOGUE.find((candidate) => candidate.id === id);
      expect(entry?.channels, `${id} must carry voice to be in the voice ladder`).toContain(
        "voice",
      );
    }
  });

  it("excludes a provider that does not serve the region", () => {
    const europe = failoverChain("sms", "europe").map((entry) => entry.id);
    expect(europe).not.toContain("africas-talking");
    expect(europe).not.toContain("exotel");

    const africa = failoverChain("sms", "africa").map((entry) => entry.id);
    expect(africa).toContain("africas-talking");
    expect(africa).not.toContain("exotel");
  });

  it("reports the health it was given, and the declared health without an override", () => {
    const declared = failoverChain("sms", "europe");
    expect(declared[0].health).toBe("DISCOVERED");

    const observed = failoverChain("sms", "europe", { twilio: "DEGRADED" });
    expect(observed[0].health).toBe("DEGRADED");
    expect(observed[1].health).toBe("DISCOVERED");
  });

  it("accepts every declared region as a routing input", () => {
    const regions: readonly ProviderRegion[] = [
      "global",
      "africa",
      "europe",
      "north_america",
      "south_america",
      "asia",
      "middle_east",
      "oceania",
    ];
    for (const region of regions) {
      expect(
        failoverChain("email", region).length,
        `email must have at least one path in ${region}`,
      ).toBeGreaterThan(0);
    }
  });
});
