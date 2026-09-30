/**
 * CoreGrid — Communication provider adapter registry (Phase 10).
 *
 * The platform is provider-independent BY CONSTRUCTION: every external
 * communication provider sits behind an adapter, and those adapters are described
 * here as DATA. A provider can therefore be added, degraded, suspended or replaced
 * without a single business domain changing a line of code (invariants EJ.12,
 * EJ.13, EJ.30).
 *
 * Real providers the platform is designed to route through — names are facts about
 * the market, not endorsements, and nothing in this module calls anything:
 *
 *   voice / telephony : Twilio, Africa's Talking, Vonage, Telnyx, Plivo, MessageBird, Exotel
 *   SMS               : the same carriers, plus regional providers behind the same adapter shape
 *   WhatsApp          : Meta WhatsApp Business (Cloud API), Twilio WhatsApp, Africa's Talking
 *   email             : SMTP relay, SendGrid, Postmark, Amazon SES
 *   push              : Firebase Cloud Messaging, Apple Push Notification service, Web Push
 *   meetings          : Google Meet (Calendar API), Zoom
 *   social / status   : Meta (Facebook + Instagram), X, LinkedIn, WhatsApp Status
 *   presence          : the platform's own realtime presence (no provider required)
 *
 * Secrets never live here: an adapter carries a CREDENTIAL REFERENCE that the secret
 * manager resolves at call time (BG, EJ.12). A registry entry that looks like a raw
 * key is rejected — see `assertCredentialReference`.
 *
 * Domain-neutral: no runtime is named here. An organization (a tenant) subscribes to
 * capability packs and gets a mandate; a runtime is a consumer of those contracts and
 * supplies its own name in its own layer, never in the kernel.
 */

/** Every way this platform can reach a person or a system. */
export type CommunicationChannelKind =
  | "voice"
  | "sms"
  | "whatsapp"
  | "email"
  | "push"
  | "in_app"
  | "meeting"
  | "social"
  | "status"
  | "presence";

export const COMMUNICATION_CHANNEL_KINDS: readonly CommunicationChannelKind[] = [
  "voice",
  "sms",
  "whatsapp",
  "email",
  "push",
  "in_app",
  "meeting",
  "social",
  "status",
  "presence",
] as const;

/** Where a provider can legally and technically operate. */
export type ProviderRegion =
  | "global"
  | "africa"
  | "europe"
  | "north_america"
  | "south_america"
  | "asia"
  | "middle_east"
  | "oceania";

/** Provider lifecycle (Section EB). */
export type ProviderLifecycleState =
  "DISCOVERED" | "CONFIGURED" | "VALIDATED" | "ACTIVE" | "DEGRADED" | "SUSPENDED" | "RETIRED";

export const PROVIDER_LIFECYCLE_STATES: readonly ProviderLifecycleState[] = [
  "DISCOVERED",
  "CONFIGURED",
  "VALIDATED",
  "ACTIVE",
  "DEGRADED",
  "SUSPENDED",
  "RETIRED",
] as const;

const PROVIDER_LIFECYCLE_TRANSITIONS: Readonly<
  Record<ProviderLifecycleState, readonly ProviderLifecycleState[]>
> = {
  DISCOVERED: ["CONFIGURED", "RETIRED"],
  CONFIGURED: ["VALIDATED", "SUSPENDED", "RETIRED"],
  VALIDATED: ["ACTIVE", "SUSPENDED", "RETIRED"],
  ACTIVE: ["DEGRADED", "SUSPENDED", "RETIRED"],
  DEGRADED: ["ACTIVE", "SUSPENDED", "RETIRED"],
  SUSPENDED: ["ACTIVE", "RETIRED"],
  RETIRED: [],
};

export function isProviderTransitionAllowed(
  from: ProviderLifecycleState,
  to: ProviderLifecycleState,
): boolean {
  return PROVIDER_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/** Routing tier: a mandate may prefer one, and failover walks down the ladder. */
export type ProviderTier = "primary" | "secondary" | "regional" | "emergency";

export type ProviderCostClass = "standard" | "premium" | "economy";

export interface ProviderAdapter {
  id: string;
  displayName: string;
  /** Channels this adapter can carry; the capability matrix is derived from it. */
  channels: readonly CommunicationChannelKind[];
  regions: readonly ProviderRegion[];
  /** A reference the secret manager resolves — never the secret itself. */
  credentialReference: string;
  tier: ProviderTier;
  costClass: ProviderCostClass;
  health: ProviderLifecycleState;
  supportsInbound: boolean;
  supportsOutbound: boolean;
  supportsDeliveryReceipts: boolean;
  /** Some providers require a signed data-processing agreement before use. */
  requiresDataProcessingAgreement: boolean;
  /** Providers that can be used for emergency broadcast (Section Z). */
  emergencyCapable: boolean;
  notes: string;
}

/* ─────────────────────────────────────────────────────────────
 * Credential hygiene (BG, EJ.12)
 * ────────────────────────────────────────────────────────────*/

const SECRET_SCHEME = /^(secret|vault|kms|env|internal):\/\//;
const SECRET_SHAPE = /(sk_live_|sk_test_|SG\.[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|AC[0-9a-f]{32})/;

/**
 * An adapter may only name a credential by reference. A raw-looking key is
 * refused, so a provider secret cannot enter the registry by accident.
 */
export function assertCredentialReference(
  adapter: ProviderAdapter,
): { ok: true } | { ok: false; reason: string } {
  const reference = adapter.credentialReference;
  if (reference.trim() === "") {
    return { ok: false, reason: `${adapter.id}: credential reference is empty` };
  }
  if (!SECRET_SCHEME.test(reference)) {
    return {
      ok: false,
      reason: `${adapter.id}: credential reference must use a scheme (secret://, vault://, kms://, env://, internal://)`,
    };
  }
  if (SECRET_SHAPE.test(reference)) {
    return {
      ok: false,
      reason: `${adapter.id}: credential reference looks like raw provider material`,
    };
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * The approved adapter catalogue
 *
 * Every external provider is DISCOVERED: the adapter is designed and named, and
 * no credential is provisioned, so no live path exists until an organization
 * configures one. Routing refuses on that state — see the report for the gap.
 * ────────────────────────────────────────────────────────────*/

export const PROVIDER_CATALOGUE: readonly ProviderAdapter[] = [
  {
    id: "twilio",
    displayName: "Twilio",
    channels: ["voice", "sms", "whatsapp"],
    regions: ["global", "north_america", "europe", "asia", "africa", "south_america", "oceania"],
    credentialReference: "secret://coregrid/communication/twilio",
    tier: "primary",
    costClass: "premium",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: true,
    notes:
      "Programmable voice, SMS and WhatsApp in one place; the default primary where an organization states no regional preference.",
  },
  {
    id: "africas-talking",
    displayName: "Africa's Talking",
    channels: ["voice", "sms", "whatsapp"],
    regions: ["africa"],
    credentialReference: "secret://coregrid/communication/africas-talking",
    tier: "regional",
    costClass: "economy",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: false,
    emergencyCapable: true,
    notes:
      "Regional voice, SMS and WhatsApp strength across African networks; the preferred carrier for tenants operating there.",
  },
  {
    id: "vonage",
    displayName: "Vonage (Nexmo)",
    channels: ["voice", "sms"],
    regions: ["europe", "north_america", "asia", "global"],
    credentialReference: "secret://coregrid/communication/vonage",
    tier: "secondary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "Secondary voice and SMS path for European and North American traffic.",
  },
  {
    id: "telnyx",
    displayName: "Telnyx",
    channels: ["voice", "sms"],
    regions: ["north_america", "europe", "global"],
    credentialReference: "secret://coregrid/communication/telnyx",
    tier: "secondary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "Secondary carrier with competitive termination for high-volume institutional traffic.",
  },
  {
    id: "plivo",
    displayName: "Plivo",
    channels: ["voice", "sms"],
    regions: ["asia", "north_america", "global"],
    credentialReference: "secret://coregrid/communication/plivo",
    tier: "secondary",
    costClass: "economy",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "Cost-sensitive secondary path, useful for South Asian routes.",
  },
  {
    id: "messagebird",
    displayName: "MessageBird (Bird)",
    channels: ["sms", "whatsapp", "voice"],
    regions: ["europe", "global"],
    credentialReference: "secret://coregrid/communication/messagebird",
    tier: "secondary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "European secondary for SMS and WhatsApp Business messaging.",
  },
  {
    id: "exotel",
    displayName: "Exotel",
    channels: ["voice", "sms"],
    regions: ["asia"],
    credentialReference: "secret://coregrid/communication/exotel",
    tier: "regional",
    costClass: "economy",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: false,
    requiresDataProcessingAgreement: false,
    emergencyCapable: false,
    notes: "Regional voice path for Indian operations, including cloud telephony and IVR.",
  },
  {
    id: "meta-whatsapp",
    displayName: "Meta WhatsApp Business (Cloud API)",
    channels: ["whatsapp", "status"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/meta-whatsapp",
    tier: "primary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes:
      "Conversational WhatsApp Business: template messages, session replies, status updates and institutional presence.",
  },
  {
    id: "smtp-relay",
    displayName: "Institutional SMTP relay",
    channels: ["email"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/smtp-relay",
    tier: "secondary",
    costClass: "economy",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: false,
    requiresDataProcessingAgreement: false,
    emergencyCapable: false,
    notes:
      "A tenant's own relay, keeping institutional mail on infrastructure the tenant controls.",
  },
  {
    id: "sendgrid",
    displayName: "SendGrid",
    channels: ["email"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/sendgrid",
    tier: "primary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: false,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "Primary transactional email with bounce and complaint feedback.",
  },
  {
    id: "postmark",
    displayName: "Postmark",
    channels: ["email"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/postmark",
    tier: "secondary",
    costClass: "premium",
    health: "DISCOVERED",
    supportsInbound: false,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "Fast transactional delivery where latency matters more than cost.",
  },
  {
    id: "amazon-ses",
    displayName: "Amazon SES",
    channels: ["email"],
    regions: [
      "global",
      "north_america",
      "europe",
      "asia",
      "africa",
      "south_america",
      "oceania",
      "middle_east",
    ],
    credentialReference: "secret://coregrid/communication/amazon-ses",
    tier: "secondary",
    costClass: "economy",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "High-volume economy email, region-local for data-residency requirements.",
  },
  {
    id: "fcm",
    displayName: "Firebase Cloud Messaging",
    channels: ["push"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/fcm",
    tier: "primary",
    costClass: "economy",
    health: "DISCOVERED",
    supportsInbound: false,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "Android and web push, with device-token feedback for stale installs.",
  },
  {
    id: "apns",
    displayName: "Apple Push Notification service",
    channels: ["push"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/apns",
    tier: "primary",
    costClass: "economy",
    health: "DISCOVERED",
    supportsInbound: false,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "iOS and macOS push to native apps, with per-device delivery feedback.",
  },
  {
    id: "web-push",
    displayName: "Web Push (VAPID)",
    channels: ["push"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/web-push",
    tier: "secondary",
    costClass: "economy",
    health: "DISCOVERED",
    supportsInbound: false,
    supportsOutbound: true,
    supportsDeliveryReceipts: false,
    requiresDataProcessingAgreement: false,
    emergencyCapable: false,
    notes: "Browser push for web clients that do not run a native app.",
  },
  {
    id: "google-meet",
    displayName: "Google Meet (Calendar API)",
    channels: ["meeting"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/google-workspace",
    tier: "primary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: false,
    supportsOutbound: true,
    supportsDeliveryReceipts: false,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes:
      "Meetings the steward can schedule and invite to; attendance belongs to the runtime's data, never to this platform.",
  },
  {
    id: "zoom",
    displayName: "Zoom",
    channels: ["meeting"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/zoom",
    tier: "secondary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: false,
    supportsOutbound: true,
    supportsDeliveryReceipts: false,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "Secondary meeting provider where an organization prefers it.",
  },
  {
    id: "meta-social",
    displayName: "Meta social publishing (Facebook + Instagram)",
    channels: ["social", "status"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/meta-social",
    tier: "primary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: false,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes:
      "Institutional page and status publishing, with comment intake feeding the steward's inbound queue.",
  },
  {
    id: "x-social",
    displayName: "X (Twitter) publishing",
    channels: ["social", "status"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/x-social",
    tier: "secondary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: false,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "Secondary public channel; mention intake feeds the steward's inbound queue.",
  },
  {
    id: "linkedin-social",
    displayName: "LinkedIn organization publishing",
    channels: ["social"],
    regions: ["global"],
    credentialReference: "secret://coregrid/communication/linkedin-social",
    tier: "secondary",
    costClass: "standard",
    health: "DISCOVERED",
    supportsInbound: false,
    supportsOutbound: true,
    supportsDeliveryReceipts: false,
    requiresDataProcessingAgreement: true,
    emergencyCapable: false,
    notes: "Institutional presence and announcements for professional audiences.",
  },
  {
    id: "platform-presence",
    displayName: "CoreGrid platform presence",
    channels: ["presence", "in_app"],
    regions: ["global"],
    credentialReference: "internal://coregrid/presence",
    tier: "primary",
    costClass: "economy",
    health: "ACTIVE",
    supportsInbound: true,
    supportsOutbound: true,
    supportsDeliveryReceipts: true,
    requiresDataProcessingAgreement: false,
    emergencyCapable: true,
    notes:
      "The platform's own presence and in-app channel: online, offline, recently active, and the notification centre, with no third party involved.",
  },
];

/* ─────────────────────────────────────────────────────────────
 * Capability matrix, routing and failover (M, S, T, CQ)
 * ────────────────────────────────────────────────────────────*/

const TIER_ORDER: readonly ProviderTier[] = ["primary", "regional", "secondary", "emergency"];

function healthOf(
  adapter: ProviderAdapter,
  overrides?: Readonly<Record<string, ProviderLifecycleState>>,
): ProviderLifecycleState {
  return overrides?.[adapter.id] ?? adapter.health;
}

function matchesRegion(adapter: ProviderAdapter, region: ProviderRegion): boolean {
  return adapter.regions.includes(region) || adapter.regions.includes("global");
}

/**
 * Only ACTIVE is usable without being asked for explicitly. A DEGRADED provider is
 * named but never chosen silently, a DISCOVERED one has no credential behind it, and a
 * SUSPENDED or RETIRED one is out of service.
 */
export function isUsableProviderHealth(state: ProviderLifecycleState): boolean {
  return state === "ACTIVE";
}

/** Which adapters can carry each channel, so no module hard-codes a provider. */
export function providerCapabilityMatrix(): readonly {
  channel: CommunicationChannelKind;
  providers: readonly string[];
}[] {
  return COMMUNICATION_CHANNEL_KINDS.map((channel) => ({
    channel,
    providers: PROVIDER_CATALOGUE.filter((adapter) => adapter.channels.includes(channel)).map(
      (adapter) => adapter.id,
    ),
  }));
}

export function providersForChannel(channel: CommunicationChannelKind): readonly ProviderAdapter[] {
  return PROVIDER_CATALOGUE.filter((adapter) => adapter.channels.includes(channel));
}

export interface ProviderSelectionInput {
  channel: CommunicationChannelKind;
  region: ProviderRegion;
  /** Emergency broadcast only uses emergency-capable adapters (Section Z). */
  emergency?: boolean;
  requireInbound?: boolean;
  requireDeliveryReceipts?: boolean;
  /** Observed health; the catalogue's own state is design-time only. */
  healthOverrides?: Readonly<Record<string, ProviderLifecycleState>>;
  /** Permit a DEGRADED adapter when nothing is healthy. */
  allowDegraded?: boolean;
}

export type ProviderSelectionResult =
  | { ok: true; adapter: ProviderAdapter; reason: string; usedDegraded: boolean }
  | { ok: false; reason: string; candidates: readonly string[] };

/**
 * Resolve the adapter for one delivery deterministically. An empty candidate set is
 * a refusal that names what it rejected — unknown delivery state is never treated as
 * success (EJ.20), and no provider is chosen by accident.
 */
export function selectProvider(input: ProviderSelectionInput): ProviderSelectionResult {
  const candidates = providersForChannel(input.channel).filter(
    (adapter) =>
      matchesRegion(adapter, input.region) &&
      (!input.emergency || adapter.emergencyCapable) &&
      (!input.requireInbound || adapter.supportsInbound) &&
      (!input.requireDeliveryReceipts || adapter.supportsDeliveryReceipts),
  );

  if (candidates.length === 0) {
    const declared = providersForChannel(input.channel);
    if (declared.length === 0) {
      return {
        ok: false,
        reason: `No adapter declares the ${input.channel} channel`,
        candidates: [],
      };
    }
    return {
      ok: false,
      reason: `${declared.length} adapter(s) carry ${input.channel}, but none satisfies the required capabilities in ${input.region}`,
      candidates: declared.map((adapter) => `${adapter.id}:${adapter.tier}`),
    };
  }

  const ordered = [...candidates].sort(
    (a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier),
  );

  const healthy = ordered.find((adapter) =>
    isUsableProviderHealth(healthOf(adapter, input.healthOverrides)),
  );
  if (healthy) {
    return {
      ok: true,
      adapter: healthy,
      reason: `${healthy.id} is ACTIVE for ${input.channel} in ${input.region}`,
      usedDegraded: false,
    };
  }

  if (input.allowDegraded) {
    const degraded = ordered.find(
      (adapter) => healthOf(adapter, input.healthOverrides) === "DEGRADED",
    );
    if (degraded) {
      return {
        ok: true,
        adapter: degraded,
        reason: `${degraded.id} is DEGRADED — accepted only because the caller allowed it`,
        usedDegraded: true,
      };
    }
  }

  return {
    ok: false,
    reason: `No ACTIVE adapter for ${input.channel} in ${input.region}`,
    candidates: ordered.map(
      (adapter) => `${adapter.id}:${healthOf(adapter, input.healthOverrides)}`,
    ),
  };
}

/** The failover ladder for a channel and region: primary first, then the rest (T). */
export function failoverChain(
  channel: CommunicationChannelKind,
  region: ProviderRegion,
  healthOverrides?: Readonly<Record<string, ProviderLifecycleState>>,
): readonly { id: string; tier: ProviderTier; health: ProviderLifecycleState }[] {
  return providersForChannel(channel)
    .filter((adapter) => matchesRegion(adapter, region))
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
    .map((adapter) => ({
      id: adapter.id,
      tier: adapter.tier,
      health: healthOf(adapter, healthOverrides),
    }));
}

/** Registry self-check: unique ids, credential hygiene, declared capability. */
export function auditProviderCatalogue(): readonly string[] {
  const findings: string[] = [];
  const seen = new Set<string>();
  for (const adapter of PROVIDER_CATALOGUE) {
    if (seen.has(adapter.id)) findings.push(`${adapter.id}: duplicate adapter id`);
    seen.add(adapter.id);
    if (adapter.channels.length === 0) findings.push(`${adapter.id}: declares no channel`);
    if (adapter.regions.length === 0) findings.push(`${adapter.id}: declares no region`);
    if (!adapter.supportsInbound && !adapter.supportsOutbound) {
      findings.push(`${adapter.id}: claims neither inbound nor outbound`);
    }
    const credential = assertCredentialReference(adapter);
    if (!credential.ok) findings.push(credential.reason);
  }
  return findings;
}
