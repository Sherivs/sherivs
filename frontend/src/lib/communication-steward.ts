/**
 * CoreGrid — Communication Steward (Phase 10).
 *
 * Every organization that joins the platform can subscribe to CoreGrid
 * communication, and what it receives is not an inbox: it receives a **Steward** —
 * an autonomous communication operator that answers calls, places calls, replies on
 * WhatsApp, writes email, updates presence and status, publishes to social channels,
 * schedules meetings and escalates to a human when its mandate runs out.
 *
 * It replaces the work of a support-and-communications employee without replacing
 * the organization's authority over its own voice. That is the whole design:
 *
 *   A steward is NEVER trusted because it is intelligent.
 *   A steward acts ONLY inside a mandate, and the mandate is data.
 *
 * The mandate fixes: autonomy level, channels, audiences, jurisdictions, languages,
 * quiet hours, volume and spend limits, prohibited topics, disclosure duties,
 * recording rules, knowledge scope and escalation policy. `evaluateStewardAction`
 * returns ALLOW, DENY, REQUIRE_APPROVAL or ESCALATE — never a silent yes: a refusal
 * is a value with a reason, and every allowance carries its obligations.
 *
 * Boundaries: Phase 08 still authorizes the actor (this module never grants access),
 * Phase 09 still supplies trust, Phase 07 still owns agent execution, and the
 * organization — not the platform — owns its policy. This module decides whether the
 * steward may speak, to whom, on which channel, in which jurisdiction, and with what
 * duty attached. Delivery itself is provider-independent (see communication-providers).
 *
 * Domain-neutral: no runtime is named here. An organization is a tenant, and a runtime
 * is a consumer of this contract that names itself in its own layer.
 */

/** How much authority a steward has been given. Higher rank = more autonomy. */
export type StewardAutonomyLevel = "OBSERVE" | "DRAFT" | "APPROVAL_REQUIRED" | "AUTONOMOUS";

export const STEWARD_AUTONOMY_LEVELS: readonly StewardAutonomyLevel[] = [
  "OBSERVE",
  "DRAFT",
  "APPROVAL_REQUIRED",
  "AUTONOMOUS",
] as const;

const AUTONOMY_RANK: Readonly<Record<StewardAutonomyLevel, number>> = {
  OBSERVE: 0,
  DRAFT: 1,
  APPROVAL_REQUIRED: 2,
  AUTONOMOUS: 3,
};

export function autonomyRank(level: StewardAutonomyLevel): number {
  return AUTONOMY_RANK[level];
}

export function isAutonomyAtLeast(
  level: StewardAutonomyLevel,
  required: StewardAutonomyLevel,
): boolean {
  return AUTONOMY_RANK[level] >= AUTONOMY_RANK[required];
}

/** Everything a steward can attempt. */
export type StewardActionKind =
  | "answer_inbound_call"
  | "place_outbound_call"
  | "send_message"
  | "send_whatsapp"
  | "send_email"
  | "send_status_update"
  | "publish_social"
  | "schedule_meeting"
  | "upload_document"
  | "update_presence"
  | "escalate_to_human";

export const STEWARD_ACTION_KINDS: readonly StewardActionKind[] = [
  "answer_inbound_call",
  "place_outbound_call",
  "send_message",
  "send_whatsapp",
  "send_email",
  "send_status_update",
  "publish_social",
  "schedule_meeting",
  "upload_document",
  "update_presence",
  "escalate_to_human",
] as const;

/**
 * The minimum authority each action kind requires before it may happen AT ALL.
 *
 * A DRAFT steward drafts and reports its own presence; nothing it does reaches a
 * person. Any action that reaches someone needs at least APPROVAL_REQUIRED, and at
 * exactly that level a human still approves each one — see
 * `PERSON_FACING_ACTION_KINDS` and rule 12b of `evaluateStewardAction`.
 */
export const ACTION_MINIMUM_AUTONOMY: Readonly<Record<StewardActionKind, StewardAutonomyLevel>> = {
  update_presence: "DRAFT",
  answer_inbound_call: "AUTONOMOUS",
  place_outbound_call: "AUTONOMOUS",
  send_message: "APPROVAL_REQUIRED",
  send_whatsapp: "APPROVAL_REQUIRED",
  send_email: "APPROVAL_REQUIRED",
  send_status_update: "APPROVAL_REQUIRED",
  publish_social: "APPROVAL_REQUIRED",
  schedule_meeting: "APPROVAL_REQUIRED",
  upload_document: "APPROVAL_REQUIRED",
  escalate_to_human: "OBSERVE",
};

/**
 * Actions that leave the steward and arrive at a person or a public audience. At
 * autonomy APPROVAL_REQUIRED these happen only after a human approves them; at
 * AUTONOMOUS they run on their own, still bounded by the limits, quiet hours, consent,
 * knowledge and classification rules.
 */
export const PERSON_FACING_ACTION_KINDS: readonly StewardActionKind[] = [
  "send_message",
  "send_whatsapp",
  "send_email",
  "send_status_update",
  "publish_social",
  "schedule_meeting",
  "upload_document",
  "answer_inbound_call",
  "place_outbound_call",
] as const;

/** Action kinds that speak to a human in real time and cannot be approved later. */
export const REALTIME_ACTION_KINDS: readonly StewardActionKind[] = [
  "answer_inbound_call",
  "place_outbound_call",
] as const;

/** Why the steward is communicating — the purpose decides what consent is needed. */
export type CommunicationPurpose = "transactional" | "service" | "marketing" | "emergency";

export const COMMUNICATION_PURPOSES: readonly CommunicationPurpose[] = [
  "transactional",
  "service",
  "marketing",
  "emergency",
] as const;

/** Classification affects access, retention, encryption, search and export (DM). */
export type CommunicationClassification =
  "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED" | "HIGHLY_RESTRICTED";

export const COMMUNICATION_CLASSIFICATIONS: readonly CommunicationClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
  "HIGHLY_RESTRICTED",
] as const;

/** Classifications a steward may never handle autonomously at all. */
export const STEWARD_FORBIDDEN_CLASSIFICATIONS: readonly CommunicationClassification[] = [
  "HIGHLY_RESTRICTED",
] as const;

/** Audiences a mandate can open; membership itself always comes from the owner (AB). */
export type StewardAudience =
  | "staff"
  | "teachers"
  | "students"
  | "guardians"
  | "administrators"
  | "vendors"
  | "alumni"
  | "public"
  | "prospects";

export const STEWARD_AUDIENCES: readonly StewardAudience[] = [
  "staff",
  "teachers",
  "students",
  "guardians",
  "administrators",
  "vendors",
  "alumni",
  "public",
  "prospects",
] as const;

/** A mandate may forbid topics outright; the steward never improvises past its pack. */
export type StewardTopic =
  | "admissions"
  | "fees_and_payments"
  | "academics"
  | "attendance"
  | "health_and_safety"
  | "facilities"
  | "transport"
  | "complaints"
  | "policy_and_compliance"
  | "media_and_press"
  | "emergency";

export const STEWARD_TOPICS: readonly StewardTopic[] = [
  "admissions",
  "fees_and_payments",
  "academics",
  "attendance",
  "health_and_safety",
  "facilities",
  "transport",
  "complaints",
  "policy_and_compliance",
  "media_and_press",
  "emergency",
] as const;

/* ─────────────────────────────────────────────────────────────
 * The mandate — the steward's authority, expressed as data
 * ────────────────────────────────────────────────────────────*/

/** Volume and spend ceilings, in the organization's own terms. */
export interface StewardMandateLimits {
  maxOutboundCallsPerHour: number;
  maxOutboundCallsPerDay: number;
  maxMessagesPerDay: number;
  maxMassRecipients: number;
  maxCallMinutesPerDay: number;
  /** Minor units (cents/kobo), so money never travels as a float. */
  maxMonthlySpendMinorUnits: number;
  currency: string;
}

export const DEFAULT_STEWARD_LIMITS: StewardMandateLimits = {
  maxOutboundCallsPerHour: 20,
  maxOutboundCallsPerDay: 120,
  maxMessagesPerDay: 500,
  maxMassRecipients: 250,
  maxCallMinutesPerDay: 240,
  maxMonthlySpendMinorUnits: 50_000,
  currency: "USD",
};

export interface StewardQuietHours {
  enabled: boolean;
  /** Local clock in the mandate's timezone, "HH:MM". */
  from: string;
  to: string;
  timezone: string;
}

export interface StewardMandate {
  id: string;
  tenantId: string;
  organizationName: string;
  stewardId: string;
  autonomy: StewardAutonomyLevel;
  channels: readonly string[];
  audiences: readonly StewardAudience[];
  jurisdictions: readonly string[];
  languages: readonly string[];
  knowledgeTopics: readonly StewardTopic[];
  prohibitedTopics: readonly StewardTopic[];
  quietHours: StewardQuietHours;
  limits: StewardMandateLimits;
  requiresDisclosure: boolean;
  recordingAllowed: boolean;
  emergencyAllowed: boolean;
  externalRecipientsAllowed: boolean;
  escalationTarget: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** What the steward has already done, as counted by the platform. */
export interface StewardUsage {
  outboundCallsLastHour: number;
  outboundCallsToday: number;
  messagesToday: number;
  callMinutesToday: number;
  spendMinorUnitsThisMonth: number;
  recipientsInLastMassSend: number;
}

export const EMPTY_STEWARD_USAGE: StewardUsage = {
  outboundCallsLastHour: 0,
  outboundCallsToday: 0,
  messagesToday: 0,
  callMinutesToday: 0,
  spendMinorUnitsThisMonth: 0,
  recipientsInLastMassSend: 0,
};

const APPROACHING_RATIO = 0.8;

/**
 * Hard limits are hard: a steward that has spent its budget stops, and the stop is
 * reported with the limit named rather than discovered by a customer.
 */
export function limitStatus(
  mandate: StewardMandate,
  usage: StewardUsage,
): { exceeded: readonly string[]; approaching: readonly string[] } {
  const pairs: readonly [string, number, number][] = [
    [
      "outbound_calls_per_hour",
      usage.outboundCallsLastHour,
      mandate.limits.maxOutboundCallsPerHour,
    ],
    ["outbound_calls_per_day", usage.outboundCallsToday, mandate.limits.maxOutboundCallsPerDay],
    ["messages_per_day", usage.messagesToday, mandate.limits.maxMessagesPerDay],
    ["call_minutes_per_day", usage.callMinutesToday, mandate.limits.maxCallMinutesPerDay],
    ["monthly_spend", usage.spendMinorUnitsThisMonth, mandate.limits.maxMonthlySpendMinorUnits],
    ["mass_recipients", usage.recipientsInLastMassSend, mandate.limits.maxMassRecipients],
  ];

  const exceeded: string[] = [];
  const approaching: string[] = [];
  for (const [name, used, ceiling] of pairs) {
    if (used >= ceiling) exceeded.push(name);
    else if (used >= ceiling * APPROACHING_RATIO) approaching.push(name);
  }
  return { exceeded, approaching };
}

/** A mandate is live only between its creation and its expiry or revocation. */
export function mandateIsActive(mandate: StewardMandate, now: string): boolean {
  if (mandate.revokedAt !== null) return false;
  if (mandate.expiresAt !== null && Date.parse(now) >= Date.parse(mandate.expiresAt)) return false;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * Consent and do-not-contact — the lawful half of autonomy
 * ────────────────────────────────────────────────────────────*/

export interface ConsentRecord {
  id: string;
  tenantId: string;
  /** Who consented, as an opaque reference owned by Phase 02. */
  subjectRef: string;
  channel: string;
  purpose: CommunicationPurpose;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  source: string;
}

export interface CreateConsentInput {
  id: string;
  tenantId: string;
  subjectRef: string;
  channel: string;
  purpose: CommunicationPurpose;
  grantedAt: string;
  expiresAt?: string | null;
  source: string;
}

export type CreateConsentResult =
  { ok: true; record: ConsentRecord } | { ok: false; error: string };

/**
 * Consent is recorded, never assumed: an opt-in without a source is refused, because
 * an unattributable opt-in is not an opt-in.
 */
export function createConsentRecord(input: CreateConsentInput): CreateConsentResult {
  if (input.subjectRef.trim() === "") return { ok: false, error: "Consent requires a subject" };
  if (input.source.trim() === "") {
    return { ok: false, error: "Consent requires a source (how the opt-in was collected)" };
  }
  if (input.purpose === "emergency") {
    return { ok: false, error: "Emergency communication does not use marketing consent records" };
  }
  return {
    ok: true,
    record: {
      id: input.id,
      tenantId: input.tenantId,
      subjectRef: input.subjectRef,
      channel: input.channel,
      purpose: input.purpose,
      grantedAt: input.grantedAt,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      source: input.source,
    },
  };
}

export function hasActiveConsent(
  records: readonly ConsentRecord[],
  query: { subjectRef: string; channel: string; purpose: CommunicationPurpose },
  now: string,
): boolean {
  return records.some(
    (record) =>
      record.subjectRef === query.subjectRef &&
      record.channel === query.channel &&
      record.purpose === query.purpose &&
      record.revokedAt === null &&
      (record.expiresAt === null || Date.parse(now) < Date.parse(record.expiresAt)),
  );
}

export interface DoNotContactEntry {
  contactRef: string;
  scope: "all" | "marketing" | "voice";
  recordedAt: string;
  source: string;
}

/** Do-not-contact is absolute: it is a person's instruction, not a preference. */
export function isDoNotContact(
  entries: readonly DoNotContactEntry[],
  contactRef: string,
  purpose: CommunicationPurpose,
): boolean {
  return entries.some((entry) => {
    if (entry.contactRef !== contactRef) return false;
    if (entry.scope === "all") return true;
    if (entry.scope === "marketing") return purpose === "marketing";
    return purpose !== "emergency";
  });
}

/* ─────────────────────────────────────────────────────────────
 * Organization subscription to platform communication
 * ────────────────────────────────────────────────────────────*/

export type CommunicationPlanTier = "essential" | "professional" | "institution" | "enterprise";

export const COMMUNICATION_PLAN_TIERS: readonly CommunicationPlanTier[] = [
  "essential",
  "professional",
  "institution",
  "enterprise",
] as const;

export interface OrganizationCommunicationSubscription {
  id: string;
  tenantId: string;
  organizationName: string;
  plan: CommunicationPlanTier;
  status: "pending" | "active" | "suspended";
  channels: readonly string[];
  stewardEnabled: boolean;
  stewardSeats: number;
  policyPackRef: string;
  billingRef: string;
  provisionedAt: string;
}

export interface ProvisionSubscriptionInput {
  id: string;
  tenantId: string;
  organizationName: string;
  plan: CommunicationPlanTier;
  /** Channels the organization asked for; the mandate decides what is permitted. */
  channels: readonly string[];
  now: string;
  policyPackRef?: string;
  billingRef?: string;
}

export type ProvisionSubscriptionResult =
  | { ok: true; subscription: OrganizationCommunicationSubscription; mandate: StewardMandate }
  | { ok: false; error: string };

/**
 * Provisioning gives an organization a subscription AND a mandate. The mandate starts
 * in OBSERVE with no channels and no audiences: a new organization is trusted with
 * nothing until it writes down what its steward may do (invariants EJ.15, EJ.17).
 */
export function provisionOrganizationSubscription(
  input: ProvisionSubscriptionInput,
): ProvisionSubscriptionResult {
  if (input.tenantId.trim() === "") {
    return { ok: false, error: "A subscription requires a tenant" };
  }
  if (input.organizationName.trim() === "") {
    return { ok: false, error: "A subscription requires an organization name" };
  }

  const subscription: OrganizationCommunicationSubscription = {
    id: input.id,
    tenantId: input.tenantId,
    organizationName: input.organizationName,
    plan: input.plan,
    status: "pending",
    channels: [...input.channels],
    stewardEnabled: true,
    stewardSeats: input.plan === "enterprise" ? 10 : input.plan === "institution" ? 5 : 1,
    policyPackRef: input.policyPackRef ?? `policy-pack:${input.tenantId}:default`,
    billingRef: input.billingRef ?? `billing:${input.tenantId}`,
    provisionedAt: input.now,
  };

  const mandate: StewardMandate = {
    id: `mandate-${input.tenantId}-initial`,
    tenantId: input.tenantId,
    organizationName: input.organizationName,
    stewardId: `steward-${input.tenantId}`,
    autonomy: "OBSERVE",
    channels: [],
    audiences: [],
    jurisdictions: [],
    languages: [],
    knowledgeTopics: [],
    prohibitedTopics: [],
    quietHours: { enabled: true, from: "21:00", to: "07:00", timezone: "UTC" },
    limits: { ...DEFAULT_STEWARD_LIMITS },
    requiresDisclosure: true,
    recordingAllowed: false,
    emergencyAllowed: false,
    externalRecipientsAllowed: false,
    escalationTarget: `queue:${input.tenantId}:human-support`,
    createdAt: input.now,
    expiresAt: null,
    revokedAt: null,
  };

  return { ok: true, subscription, mandate };
}

/** Presence is privacy-controlled and optional (BV). */
export type PresenceState = "online" | "offline" | "recently_active";

export const PRESENCE_STATES: readonly PresenceState[] = [
  "online",
  "offline",
  "recently_active",
] as const;

export interface PresenceSignal {
  subjectRef: string;
  state: PresenceState;
  observedAt: string;
  /** Whether the subject allows presence to be shown at all. */
  shareable: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * The knowledge pack — what the steward is allowed to know and say
 * ────────────────────────────────────────────────────────────*/

/**
 * The steward holds no general knowledge about the organization: it holds a pack,
 * supplied and owned by the organization, with a freshness expectation. Asked about a
 * topic outside the pack, it escalates — it does not improvise, because a
 * confident-sounding stranger is the failure this design exists to prevent.
 */
export interface StewardKnowledgePack {
  stewardId: string;
  tenantId: string;
  topics: readonly StewardTopic[];
  /** Where the pack came from, for provenance (Phase 09 consumes this). */
  sourceRef: string;
  version: string;
  refreshedAt: string;
  /** Topics the steward must never answer at all, even if asked. */
  refusedTopics: readonly StewardTopic[];
}

export interface KnowledgeCoverage {
  covered: readonly StewardTopic[];
  missing: readonly StewardTopic[];
  refused: readonly StewardTopic[];
}

/** Coverage of a request against the pack: what it may speak to, and what it may not. */
export function knowledgeCoverage(
  pack: StewardKnowledgePack,
  requested: readonly StewardTopic[],
  mandate: StewardMandate,
): KnowledgeCoverage {
  const covered: StewardTopic[] = [];
  const missing: StewardTopic[] = [];
  const refused: StewardTopic[] = [];
  for (const topic of requested) {
    if (pack.refusedTopics.includes(topic) || mandate.prohibitedTopics.includes(topic)) {
      refused.push(topic);
    } else if (pack.topics.includes(topic) && mandate.knowledgeTopics.includes(topic)) {
      covered.push(topic);
    } else {
      missing.push(topic);
    }
  }
  return { covered, missing, refused };
}

/* ─────────────────────────────────────────────────────────────
 * Call control — inbound and outbound voice, governed
 * ────────────────────────────────────────────────────────────*/

export type CallDirection = "inbound" | "outbound";
export type CallChannel = "voice" | "whatsapp_voice";

export type CallSessionState =
  | "REQUESTED"
  | "RINGING"
  | "ANSWERED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "MISSED"
  | "FAILED"
  | "ESCALATED"
  | "ABANDONED";

export const CALL_SESSION_STATES: readonly CallSessionState[] = [
  "REQUESTED",
  "RINGING",
  "ANSWERED",
  "IN_PROGRESS",
  "COMPLETED",
  "MISSED",
  "FAILED",
  "ESCALATED",
  "ABANDONED",
] as const;

const CALL_TRANSITIONS: Readonly<Record<CallSessionState, readonly CallSessionState[]>> = {
  REQUESTED: ["RINGING", "FAILED", "ABANDONED"],
  RINGING: ["ANSWERED", "MISSED", "FAILED", "ESCALATED"],
  ANSWERED: ["IN_PROGRESS", "COMPLETED", "ESCALATED", "FAILED"],
  IN_PROGRESS: ["COMPLETED", "ESCALATED", "FAILED"],
  COMPLETED: [],
  MISSED: ["ESCALATED"],
  FAILED: ["ESCALATED"],
  ESCALATED: ["COMPLETED", "FAILED"],
  ABANDONED: [],
};

/** A finished call is finished: no state may be resumed after it ends. */
export function isCallTransitionAllowed(from: CallSessionState, to: CallSessionState): boolean {
  return CALL_TRANSITIONS[from].includes(to);
}

export interface CallSession {
  id: string;
  tenantId: string;
  stewardId: string;
  direction: CallDirection;
  channel: CallChannel;
  /** Opaque reference to the other party; identity stays Phase 02's. */
  contactRef: string;
  state: CallSessionState;
  startedAt: string;
  endedAt: string | null;
  disposition: string | null;
  escalatedTo: string | null;
}

export interface CreateCallSessionInput {
  id: string;
  tenantId: string;
  stewardId: string;
  direction: CallDirection;
  channel: CallChannel;
  contactRef: string;
  now: string;
}

export function createCallSession(input: CreateCallSessionInput): CallSession {
  return {
    id: input.id,
    tenantId: input.tenantId,
    stewardId: input.stewardId,
    direction: input.direction,
    channel: input.channel,
    contactRef: input.contactRef,
    state: "REQUESTED",
    startedAt: input.now,
    endedAt: null,
    disposition: null,
    escalatedTo: null,
  };
}

/**
 * Terminal states never count as success: a MISSED or FAILED call is reported as
 * such, so a human can pick it up (EJ.20 — unknown is not delivered).
 */
export function isCallResolved(state: CallSessionState): boolean {
  return state === "COMPLETED";
}

/* ─────────────────────────────────────────────────────────────
 * Escalation — the steward's safety valve
 * ────────────────────────────────────────────────────────────*/

export interface EscalationInput {
  attempts: number;
  acknowledged: boolean;
  minutesSinceLastAttempt: number;
  /** "routine" | "urgent" | "emergency" */
  severity: "routine" | "urgent" | "emergency";
  unreadHours?: number;
}

export interface EscalationDecision {
  escalate: boolean;
  reason: string;
}

/**
 * Escalation is never a failure of the steward: it is the designed exit when the
 * mandate, the knowledge pack or the person runs out.
 */
export function evaluateEscalation(input: EscalationInput): EscalationDecision {
  if (
    input.severity === "emergency" &&
    !input.acknowledged &&
    input.minutesSinceLastAttempt >= 10
  ) {
    return { escalate: true, reason: "Emergency communication unacknowledged after 10 minutes" };
  }
  if (input.severity === "urgent" && !input.acknowledged && input.minutesSinceLastAttempt >= 60) {
    return { escalate: true, reason: "Urgent communication unacknowledged after an hour" };
  }
  if (input.attempts >= 3 && !input.acknowledged) {
    return { escalate: true, reason: "Three delivery attempts without acknowledgement" };
  }
  if ((input.unreadHours ?? 0) >= 24) {
    return { escalate: true, reason: "Unread for 24 hours" };
  }
  return { escalate: false, reason: "Within policy: no escalation required" };
}

/* ─────────────────────────────────────────────────────────────
 * The decision — may this steward do this, to this person, now?
 * ────────────────────────────────────────────────────────────*/

export interface StewardActionRequest {
  action: StewardActionKind;
  channel: string;
  audience: StewardAudience;
  purpose: CommunicationPurpose;
  classification: CommunicationClassification;
  /** Where the contact is, per the owning system's data — never inferred here. */
  jurisdictions: readonly string[];
  language: string;
  topics: readonly StewardTopic[];
  /** Local clock in the mandate's timezone, "HH:MM"; the caller resolves DST. */
  localTime: string;
  now: string;
  mass?: boolean;
  externalRecipient?: boolean;
  requiresRecording?: boolean;
  aiGenerated?: boolean;
  contactRef?: string;
  usage?: StewardUsage;
  consentRecords?: readonly ConsentRecord[];
  doNotContact?: readonly DoNotContactEntry[];
  knowledge?: KnowledgeCoverage;
}

export interface StewardDecision {
  decision: "ALLOW" | "DENY" | "REQUIRE_APPROVAL" | "ESCALATE";
  reason: string;
  /** Duties that must accompany an allowed action (disclosure, opt-out, audit). */
  obligations: readonly string[];
  /** Named rules that refused or gated the action, for the audit trail. */
  failedRules: readonly string[];
  limits: { exceeded: readonly string[]; approaching: readonly string[] };
}

/** Channels that reach a person outside the platform, and so observe quiet hours. */
const OUTBOUND_EXTERNAL_CHANNELS: readonly string[] = [
  "voice",
  "sms",
  "whatsapp",
  "email",
  "push",
  "social",
  "status",
];

const MAX_TIME_MINUTES = 24 * 60;

function toMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours > 24 || minutes > 59) return null;
  return Math.min(hours * 60 + minutes, MAX_TIME_MINUTES);
}

/**
 * Quiet hours, wrap-around aware. An unparseable clock is treated as QUIET: a
 * malformed timestamp is not a licence to call a guardian at three in the morning.
 */
export function isWithinQuietHours(localTime: string, quiet: StewardQuietHours): boolean {
  if (!quiet.enabled) return false;
  const now = toMinutes(localTime);
  const from = toMinutes(quiet.from);
  const to = toMinutes(quiet.to);
  if (now === null || from === null || to === null) return true;
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

export function observesQuietHours(channel: string): boolean {
  return OUTBOUND_EXTERNAL_CHANNELS.includes(channel);
}

/** The disclosure duty an AI communicator carries, expressed as an obligation. */
export function disclosureObligation(
  mandate: StewardMandate,
  request: Pick<StewardActionRequest, "action" | "aiGenerated" | "jurisdictions">,
): { required: boolean; reason: string } {
  const speaksToHuman =
    request.action === "answer_inbound_call" ||
    request.action === "place_outbound_call" ||
    request.action === "send_whatsapp" ||
    request.action === "send_message";
  if (!speaksToHuman) return { required: false, reason: "Not a direct human conversation" };
  if (!mandate.requiresDisclosure && request.aiGenerated !== true) {
    return {
      required: false,
      reason: "Mandate does not require disclosure and content is human-authored",
    };
  }
  return {
    required: true,
    reason: `Jurisdictions ${request.jurisdictions.join(", ") || "unspecified"} require the recipient to be told they are speaking with an assistant`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * evaluateStewardAction — the one gate every steward action passes
 * ────────────────────────────────────────────────────────────*/

/**
 * Decide whether a steward may take this action, for this contact, now, inside this
 * mandate. Nothing here sends anything: this is the gate the sender must pass, and
 * every refusal names the rule that refused it, so a dispute is settled from the
 * record rather than from memory.
 */
export function evaluateStewardAction(
  mandate: StewardMandate,
  request: StewardActionRequest,
): StewardDecision {
  const limits = limitStatus(mandate, request.usage ?? EMPTY_STEWARD_USAGE);

  const decide = (
    decision: StewardDecision["decision"],
    reason: string,
    obligations: readonly string[],
    failedRules: readonly string[],
  ): StewardDecision => ({
    decision,
    reason,
    obligations: [...obligations, "audit_record"],
    failedRules,
    limits,
  });

  // 0. Escalation is always available: it is the safety valve, not a privilege.
  if (request.action === "escalate_to_human") {
    return decide(
      "ALLOW",
      "Escalation is always available to a steward",
      ["record_escalation", "notify_queue"],
      ["rule_escalation_always_available"],
    );
  }

  // 1. A mandate that is not live permits nothing.
  if (!mandateIsActive(mandate, request.now)) {
    return decide(
      "DENY",
      "The steward's mandate is revoked or expired",
      ["freeze_actions"],
      ["rule_mandate_inactive"],
    );
  }

  // 2. A classification the platform forbids a steward from handling at all.
  if (STEWARD_FORBIDDEN_CLASSIFICATIONS.includes(request.classification)) {
    return decide(
      "DENY",
      `Classification ${request.classification} may not be handled by a steward`,
      ["notify_owner"],
      ["rule_classification_forbidden"],
    );
  }

  // 3. An organization's prohibition is absolute.
  const refusedTopics = request.knowledge?.refused ?? [];
  if (refusedTopics.length > 0) {
    return decide(
      "DENY",
      `Topic(s) ${refusedTopics.join(", ")} are prohibited for this steward`,
      ["log_refusal"],
      ["rule_topic_prohibited"],
    );
  }

  // 4. Channel, audience and external reach must each be opened in the mandate.
  if (!mandate.channels.includes(request.channel)) {
    return decide(
      "DENY",
      `Channel ${request.channel} is not authorised by the mandate`,
      ["notify_owner"],
      ["rule_channel_not_authorised"],
    );
  }
  if (!mandate.audiences.includes(request.audience)) {
    return decide(
      "DENY",
      `Audience ${request.audience} is not in the mandate`,
      ["notify_owner"],
      ["rule_audience_not_authorised"],
    );
  }
  if (request.externalRecipient === true && !mandate.externalRecipientsAllowed) {
    return decide(
      "DENY",
      "The mandate does not permit communication with external recipients",
      ["notify_owner"],
      ["rule_external_not_authorised"],
    );
  }

  // 5. Jurisdiction: the steward speaks only where it is mandated to, and an unknown
  //    jurisdiction is not a licence.
  if (request.jurisdictions.length === 0) {
    return decide(
      "DENY",
      "The contact's jurisdiction is unknown, and unknown is not authorised",
      ["notify_owner"],
      ["rule_jurisdiction_unknown"],
    );
  }
  const outsideJurisdiction = request.jurisdictions.filter(
    (jurisdiction) => !mandate.jurisdictions.includes(jurisdiction),
  );
  if (outsideJurisdiction.length > 0) {
    return decide(
      "DENY",
      `Jurisdiction(s) ${outsideJurisdiction.join(", ")} are outside the mandate`,
      ["notify_owner"],
      ["rule_jurisdiction_outside"],
    );
  }

  // 6. Language: a steward that cannot speak it hands the conversation to a human.
  if (!mandate.languages.includes(request.language)) {
    return decide(
      "ESCALATE",
      `Language ${request.language} is not in the mandate: a human must take this`,
      ["notify_queue"],
      ["rule_language_not_mandated"],
    );
  }

  // 7. A person's instruction outranks the organization's eagerness.
  if (
    request.contactRef !== undefined &&
    isDoNotContact(request.doNotContact ?? [], request.contactRef, request.purpose)
  ) {
    return decide(
      "DENY",
      "The contact is on the do-not-contact list",
      ["honour_opt_out"],
      ["rule_do_not_contact"],
    );
  }

  // 8. Purpose: marketing needs recorded consent; emergency needs explicit authority.
  if (request.purpose === "marketing") {
    const consented =
      request.contactRef !== undefined &&
      hasActiveConsent(
        request.consentRecords ?? [],
        { subjectRef: request.contactRef, channel: request.channel, purpose: "marketing" },
        request.now,
      );
    if (!consented) {
      return decide(
        "DENY",
        "Marketing requires a recorded opt-in for this channel",
        ["notify_owner"],
        ["rule_consent_required"],
      );
    }
  }
  if (request.purpose === "emergency" && !mandate.emergencyAllowed) {
    return decide(
      "DENY",
      "Emergency communication is not authorised by the mandate",
      ["notify_owner"],
      ["rule_emergency_not_authorised"],
    );
  }

  // 9. Knowledge: outside the pack the steward escalates rather than improvises.
  if (request.knowledge && request.knowledge.missing.length > 0) {
    return decide(
      "ESCALATE",
      `Topic(s) ${request.knowledge.missing.join(", ")} are outside the steward's knowledge pack`,
      ["notify_queue"],
      ["rule_knowledge_scope"],
    );
  }

  // 10. Limits are hard, and an approaching limit is reported before it bites.
  if (limits.exceeded.length > 0) {
    return decide(
      "DENY",
      `Mandate limit reached: ${limits.exceeded.join(", ")}`,
      ["notify_owner"],
      ["rule_limits_exceeded"],
    );
  }

  // 11. Quiet hours, for anything that reaches a person outside the platform.
  if (
    observesQuietHours(request.channel) &&
    request.purpose !== "emergency" &&
    isWithinQuietHours(request.localTime, mandate.quietHours)
  ) {
    return decide(
      "DENY",
      `Quiet hours (${mandate.quietHours.from}-${mandate.quietHours.to} ${mandate.quietHours.timezone})`,
      ["schedule_for_allowed_window"],
      ["rule_quiet_hours"],
    );
  }

  // 12. Autonomy: the ladder decides whether the steward acts, asks, or steps aside.
  const required = ACTION_MINIMUM_AUTONOMY[request.action];
  if (!isAutonomyAtLeast(mandate.autonomy, required)) {
    if (mandate.autonomy === "OBSERVE") {
      return decide(
        "DENY",
        "Autonomy is OBSERVE: the steward may watch and report, never act",
        ["notify_owner"],
        ["rule_autonomy_observe"],
      );
    }
    if (request.action === "answer_inbound_call") {
      return decide(
        "ESCALATE",
        "Autonomy below AUTONOMOUS: a human answers the call",
        ["route_to_queue"],
        ["rule_autonomy_inbound"],
      );
    }
    if (request.action === "place_outbound_call") {
      return decide(
        "REQUIRE_APPROVAL",
        "Outbound calling requires an autonomy level this mandate has not granted",
        ["queue_for_approval"],
        ["rule_autonomy_outbound"],
      );
    }
    return decide(
      "REQUIRE_APPROVAL",
      "Autonomy is DRAFT: a human approves before this is sent",
      ["queue_for_approval"],
      ["rule_autonomy_draft"],
    );
  }

  // 12b. A level of APPROVAL_REQUIRED means exactly that. The steward has enough
  //      authority for the action to be possible, and still not enough to take it past
  //      a human: anything that arrives at a person is approved first.
  if (
    mandate.autonomy === "APPROVAL_REQUIRED" &&
    PERSON_FACING_ACTION_KINDS.includes(request.action)
  ) {
    return decide(
      "REQUIRE_APPROVAL",
      "Autonomy is APPROVAL_REQUIRED: a human approves this before it reaches anyone",
      ["queue_for_approval"],
      ["rule_pre_approval_required"],
    );
  }

  // 13. Mass communication is witnessed by a human at every autonomy level.
  if (request.mass === true) {
    return decide(
      "REQUIRE_APPROVAL",
      "Mass communication requires human approval at every autonomy level",
      ["queue_for_approval", "estimate_recipients", "preview_required"],
      ["rule_mass_approval"],
    );
  }

  // 14. Sensitive classifications: a human is accountable for these.
  if (request.classification === "CONFIDENTIAL" || request.classification === "RESTRICTED") {
    return decide(
      "REQUIRE_APPROVAL",
      `Classification ${request.classification} requires human approval`,
      ["queue_for_approval", "restrict_search"],
      ["rule_sensitive_classification"],
    );
  }

  // 15. Recording: permission is a mandate fact, and notice is a duty.
  if (request.requiresRecording === true && !mandate.recordingAllowed) {
    return decide(
      "DENY",
      "Call recording is not permitted by the mandate",
      ["notify_owner"],
      ["rule_recording_not_permitted"],
    );
  }

  // 16. A permitted action still carries its duties: disclosure, opt-out, audit.
  const obligations: string[] = ["honour_opt_out"];
  const disclosure = disclosureObligation(mandate, request);
  if (disclosure.required) {
    obligations.push(
      request.action === "answer_inbound_call" || request.action === "place_outbound_call"
        ? "disclose_ai_on_call"
        : "disclose_ai_in_message",
    );
  }
  if (request.requiresRecording === true) obligations.push("announce_recording");
  if (limits.approaching.length > 0) obligations.push("warn_owner_budget");
  if (request.action === "publish_social") obligations.push("public_statement_log");

  return decide(
    "ALLOW",
    `Within mandate: ${request.action} on ${request.channel} to ${request.audience}`,
    obligations,
    [],
  );
}

/** A one-line statement of a steward's authority, for the control-plane page. */
export function mandateSummary(mandate: StewardMandate): string {
  return [
    `${mandate.organizationName} (${mandate.tenantId})`,
    `autonomy ${mandate.autonomy}`,
    `channels ${mandate.channels.join(", ") || "none"}`,
    `audiences ${mandate.audiences.join(", ") || "none"}`,
    `jurisdictions ${mandate.jurisdictions.join(", ") || "none"}`,
    `languages ${mandate.languages.join(", ") || "none"}`,
  ].join(" · ");
}
