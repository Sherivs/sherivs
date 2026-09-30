/**
 * CoreGrid — Phase 10 Communication Platform: the Communication Steward report.
 *
 * This is the phase's L4 evidence. Nothing here is asserted in prose: the module
 * provisions real organizations, writes real mandates, and runs the decision engine over
 * them, then reports what it observed — the refusals as well as the allowances, and every
 * gap that remains. A surface built on this report cannot claim a capability the platform
 * does not have, because the numbers come from calls rather than from memory.
 *
 * Domain-neutral: the kernel owns the steward contract. A runtime subscribes to it and
 * names itself in its own layer; nothing here names a runtime.
 */
import {
  ACTION_MINIMUM_AUTONOMY,
  COMMUNICATION_CLASSIFICATIONS,
  COMMUNICATION_PURPOSES,
  EMPTY_STEWARD_USAGE,
  PERSON_FACING_ACTION_KINDS,
  STEWARD_ACTION_KINDS,
  STEWARD_AUDIENCES,
  STEWARD_AUTONOMY_LEVELS,
  STEWARD_TOPICS,
  createConsentRecord,
  evaluateStewardAction,
  knowledgeCoverage,
  mandateIsActive,
  mandateSummary,
  provisionOrganizationSubscription,
  type CommunicationPlanTier,
  type StewardActionRequest,
  type StewardAutonomyLevel,
  type StewardDecision,
  type StewardKnowledgePack,
  type StewardMandate,
} from "@/lib/communication-steward";
import {
  PROVIDER_CATALOGUE,
  auditProviderCatalogue,
  failoverChain,
  providerCapabilityMatrix,
  selectProvider,
} from "@/lib/communication-providers";

/** The rules the steward enforces today, each tied to its implementation and suite. */
export interface StewardRule {
  id: string;
  rule: string;
  enforcedBy: string;
  provedBy: string;
}

export function communicationStewardRules(): readonly StewardRule[] {
  return [
    {
      id: "mandate-binds-every-action",
      rule: "A steward action is permitted only by a live mandate that opened the channel, the audience, the jurisdiction and the language.",
      enforcedBy: "frontend/src/lib/communication-steward.ts",
      provedBy: "tests/unit/communication-steward.test.ts",
    },
    {
      id: "autonomy-ladder",
      rule: "OBSERVE watches, DRAFT drafts, APPROVAL_REQUIRED acts only with a human approving each person-facing action, AUTONOMOUS acts alone.",
      enforcedBy: "frontend/src/lib/communication-steward.ts",
      provedBy: "tests/unit/communication-steward.test.ts",
    },
    {
      id: "mass-and-sensitive-are-witnessed",
      rule: "Mass communication and confidential or restricted classifications always require human approval, at every autonomy level.",
      enforcedBy: "frontend/src/lib/communication-steward.ts",
      provedBy: "tests/unit/communication-steward.test.ts",
    },
    {
      id: "consent-and-do-not-contact",
      rule: "Marketing needs a recorded opt-in with a source, and a do-not-contact instruction is absolute.",
      enforcedBy: "frontend/src/lib/communication-steward.ts",
      provedBy: "tests/unit/communication-steward.test.ts",
    },
    {
      id: "quiet-hours-and-disclosure",
      rule: "External channels observe the mandate's quiet hours in its own timezone, and a machine speaks only where it says that it is a machine.",
      enforcedBy: "frontend/src/lib/communication-steward.ts",
      provedBy: "tests/unit/communication-steward.test.ts",
    },
    {
      id: "knowledge-is-bounded",
      rule: "Outside its knowledge pack the steward escalates instead of answering; prohibited topics are refused outright.",
      enforcedBy: "frontend/src/lib/communication-steward.ts",
      provedBy: "tests/unit/communication-steward.test.ts",
    },
    {
      id: "provider-credentials-are-references",
      rule: "A provider adapter names its credential by reference; anything that looks like real key material is refused.",
      enforcedBy: "frontend/src/lib/communication-providers.ts",
      provedBy: "tests/unit/communication-providers.test.ts",
    },
    {
      id: "routing-refuses-rather-than-guesses",
      rule: "Delivery resolves to an ACTIVE adapter for the channel and region, or is refused with the reasons; no provider is chosen by accident.",
      enforcedBy: "frontend/src/lib/communication-providers.ts",
      provedBy: "tests/unit/communication-providers.test.ts",
    },
  ];
}

export interface StewardCheck {
  id: string;
  proves: string;
  ok: boolean;
  detail: string;
}

const NOW = "2026-03-02T12:00:00.000Z";
const NIGHT = "23:30";
const EARLY = "03:00";

/** An organization with the authority a real one would open on its first working day. */
function openOrganization(input: {
  tenantId: string;
  organizationName: string;
  plan: CommunicationPlanTier;
  jurisdiction: string;
  language: string;
}): { mandate: StewardMandate; seats: number } | undefined {
  const provisioned = provisionOrganizationSubscription({
    id: `sub-${input.tenantId}`,
    tenantId: input.tenantId,
    organizationName: input.organizationName,
    plan: input.plan,
    channels: ["voice", "sms", "whatsapp", "email", "in_app", "presence"],
    now: NOW,
  });
  if (!provisioned.ok) return undefined;

  const mandate: StewardMandate = {
    ...provisioned.mandate,
    autonomy: "AUTONOMOUS",
    channels: ["voice", "sms", "whatsapp", "email", "in_app", "presence"],
    audiences: ["guardians", "staff", "teachers", "students"],
    jurisdictions: [input.jurisdiction],
    languages: [input.language],
    knowledgeTopics: ["attendance", "fees_and_payments", "facilities"],
    prohibitedTopics: ["media_and_press"],
    requiresDisclosure: true,
    recordingAllowed: false,
    emergencyAllowed: true,
    externalRecipientsAllowed: true,
  };

  return { mandate, seats: provisioned.subscription.stewardSeats };
}

/** One question put to the steward, using the mandate's own contact facts. */
function ask(
  mandate: StewardMandate,
  overrides: Partial<StewardActionRequest> = {},
): StewardDecision {
  return evaluateStewardAction(mandate, {
    action: "send_message",
    channel: "sms",
    audience: "guardians",
    purpose: "transactional",
    classification: "INTERNAL",
    jurisdictions: mandate.jurisdictions,
    language: mandate.languages[0] ?? "en",
    topics: ["attendance"],
    localTime: "12:00",
    now: NOW,
    usage: EMPTY_STEWARD_USAGE,
    ...overrides,
  });
}

export function runCommunicationStewardCheck(): readonly StewardCheck[] {
  const checks: StewardCheck[] = [];
  const school = openOrganization({
    tenantId: "tenant-school-1",
    organizationName: "Riverside Institute",
    plan: "institution",
    jurisdiction: "NG",
    language: "en",
  });
  const clinic = openOrganization({
    tenantId: "tenant-clinic-1",
    organizationName: "Northgate Clinic",
    plan: "professional",
    jurisdiction: "GB",
    language: "en",
  });
  const mandate = school?.mandate;

  checks.push({
    id: "organization-gets-a-steward",
    proves: "a subscribing organization is provisioned with a steward mandate and seats",
    ok: school !== undefined && clinic !== undefined && (school?.seats ?? 0) > 0,
    detail: school
      ? `${mandateSummary(school.mandate)} · seats=${school.seats}`
      : "provisioning refused",
  });

  // A freshly provisioned mandate is inert: it observes until the organization opens
  // authority, and that state is exercised rather than described.
  const freshly = provisionOrganizationSubscription({
    id: "sub-new",
    tenantId: "tenant-new",
    organizationName: "New Institute",
    plan: "essential",
    channels: ["sms"],
    now: NOW,
  });
  const inertRefusal = freshly.ok
    ? evaluateStewardAction(freshly.mandate, {
        action: "send_message",
        channel: "sms",
        audience: "guardians",
        purpose: "transactional",
        classification: "INTERNAL",
        jurisdictions: ["NG"],
        language: "en",
        topics: [],
        localTime: "12:00",
        now: NOW,
      })
    : undefined;
  // Authority opened but autonomy still OBSERVE: this isolates the autonomy refusal from
  // the channel refusal, because a brand-new mandate refuses on its empty channel list
  // first — which is itself the correct order of questions.
  const observingRefusal = freshly.ok
    ? evaluateStewardAction(
        {
          ...freshly.mandate,
          channels: ["sms"],
          audiences: ["guardians"],
          jurisdictions: ["NG"],
          languages: ["en"],
        },
        {
          action: "send_message",
          channel: "sms",
          audience: "guardians",
          purpose: "transactional",
          classification: "INTERNAL",
          jurisdictions: ["NG"],
          language: "en",
          topics: [],
          localTime: "12:00",
          now: NOW,
        },
      )
    : undefined;
  checks.push({
    id: "new-mandate-is-inert",
    proves:
      "a new organization's steward starts in OBSERVE with nothing opened and is refused, and refuses again on autonomy alone once authority is opened",
    ok:
      freshly.ok &&
      freshly.mandate.autonomy === "OBSERVE" &&
      freshly.mandate.channels.length === 0 &&
      inertRefusal?.decision === "DENY" &&
      inertRefusal.failedRules.includes("rule_channel_not_authorised") &&
      observingRefusal?.decision === "DENY" &&
      observingRefusal.failedRules.includes("rule_autonomy_observe"),
    detail: inertRefusal
      ? `new=${inertRefusal.decision}(${inertRefusal.failedRules.join(",")}) opened=${observingRefusal?.decision}(${observingRefusal?.failedRules.join(",")})`
      : "no mandate",
  });

  if (!mandate) {
    return checks;
  }

  const autonomous = ask(mandate);
  const draft = ask({ ...mandate, autonomy: "DRAFT" });
  const approval = ask({ ...mandate, autonomy: "APPROVAL_REQUIRED" });
  checks.push({
    id: "autonomy-ladder-is-monotone",
    proves: "AUTONOMOUS sends, APPROVAL_REQUIRED asks, DRAFT only drafts",
    ok:
      autonomous.decision === "ALLOW" &&
      approval.decision === "REQUIRE_APPROVAL" &&
      draft.decision === "REQUIRE_APPROVAL" &&
      approval.failedRules.includes("rule_pre_approval_required") &&
      draft.failedRules.includes("rule_autonomy_draft"),
    detail: `AUTONOMOUS=${autonomous.decision} APPROVAL_REQUIRED=${approval.decision} DRAFT=${draft.decision}`,
  });

  const mass = ask(mandate, { mass: true, purpose: "service" });
  const sensitive = ask(mandate, { classification: "CONFIDENTIAL" });
  checks.push({
    id: "mass-and-sensitive-are-witnessed",
    proves: "mass and confidential communication require a human even at AUTONOMOUS",
    ok:
      mass.decision === "REQUIRE_APPROVAL" &&
      sensitive.decision === "REQUIRE_APPROVAL" &&
      mass.failedRules.includes("rule_mass_approval"),
    detail: `mass=${mass.decision} confidential=${sensitive.decision}`,
  });

  const nightSms = ask(mandate, { localTime: NIGHT });
  const nightInApp = ask(mandate, { channel: "in_app", localTime: NIGHT });
  const emergency = ask(mandate, { purpose: "emergency", localTime: EARLY });
  checks.push({
    id: "quiet-hours-bind-external-channels-only",
    proves:
      "quiet hours stop an external message, leave an in-app one alone, and yield to an authorised emergency",
    ok:
      nightSms.decision === "DENY" &&
      nightSms.failedRules.includes("rule_quiet_hours") &&
      nightInApp.decision === "ALLOW" &&
      emergency.decision === "ALLOW",
    detail: `sms@23:30=${nightSms.decision} in_app@23:30=${nightInApp.decision} emergency@03:00=${emergency.decision}`,
  });

  const consent = createConsentRecord({
    id: "consent-1",
    tenantId: mandate.tenantId,
    subjectRef: "contact-1",
    channel: "sms",
    purpose: "marketing",
    grantedAt: NOW,
    source: "web-form:newsletter",
  });
  const marketingWithoutConsent = ask(mandate, { purpose: "marketing", contactRef: "contact-1" });
  const marketingWithConsent = ask(mandate, {
    purpose: "marketing",
    contactRef: "contact-1",
    consentRecords: consent.ok ? [consent.record] : [],
  });
  const optedOut = ask(mandate, {
    contactRef: "contact-2",
    doNotContact: [
      { contactRef: "contact-2", scope: "all", recordedAt: NOW, source: "phone-call" },
    ],
  });
  checks.push({
    id: "consent-and-do-not-contact",
    proves:
      "marketing is refused without a recorded opt-in and allowed with one; an opt-out is absolute",
    ok:
      consent.ok &&
      marketingWithoutConsent.decision === "DENY" &&
      marketingWithoutConsent.failedRules.includes("rule_consent_required") &&
      marketingWithConsent.decision === "ALLOW" &&
      optedOut.decision === "DENY" &&
      optedOut.failedRules.includes("rule_do_not_contact"),
    detail: `no-opt-in=${marketingWithoutConsent.decision} opted-in=${marketingWithConsent.decision} opt-out=${optedOut.decision}`,
  });

  const foreignContact = ask(mandate, { jurisdictions: ["US"] });
  const unknownPlace = ask(mandate, { jurisdictions: [] });
  checks.push({
    id: "jurisdiction-is-never-inferred",
    proves: "a contact outside the mandate's jurisdictions is refused, and so is an unknown one",
    ok:
      foreignContact.decision === "DENY" &&
      foreignContact.failedRules.includes("rule_jurisdiction_outside") &&
      unknownPlace.decision === "DENY" &&
      unknownPlace.failedRules.includes("rule_jurisdiction_unknown"),
    detail: `outside=${foreignContact.decision} unknown=${unknownPlace.decision}`,
  });

  const pack: StewardKnowledgePack = {
    stewardId: mandate.stewardId,
    tenantId: mandate.tenantId,
    topics: ["attendance"],
    sourceRef: "document:tenant-school-1:handbook-v4",
    version: "4",
    refreshedAt: NOW,
    refusedTopics: [],
  };
  const outsidePack = ask(mandate, {
    knowledge: knowledgeCoverage(pack, ["attendance", "transport"], mandate),
  });
  const prohibitedTopic = ask(mandate, {
    knowledge: { covered: [], missing: [], refused: ["media_and_press"] },
  });
  checks.push({
    id: "knowledge-bounds-the-answer",
    proves: "a topic outside the pack escalates, and a prohibited topic is refused",
    ok:
      outsidePack.decision === "ESCALATE" &&
      outsidePack.failedRules.includes("rule_knowledge_scope") &&
      prohibitedTopic.decision === "DENY" &&
      prohibitedTopic.failedRules.includes("rule_topic_prohibited"),
    detail: `outside-pack=${outsidePack.decision} prohibited=${prohibitedTopic.decision}`,
  });

  const overLimit = ask(mandate, {
    usage: { ...EMPTY_STEWARD_USAGE, messagesToday: mandate.limits.maxMessagesPerDay },
  });
  const recordingRefused = ask(mandate, {
    action: "answer_inbound_call",
    channel: "voice",
    requiresRecording: true,
  });
  checks.push({
    id: "limits-and-recording-are-hard",
    proves: "a reached limit stops the steward, and recording needs the mandate's permission",
    ok:
      overLimit.decision === "DENY" &&
      overLimit.failedRules.includes("rule_limits_exceeded") &&
      recordingRefused.decision === "DENY" &&
      recordingRefused.failedRules.includes("rule_recording_not_permitted"),
    detail: `limit=${overLimit.decision} recording=${recordingRefused.decision}`,
  });

  const revoked = ask({ ...mandate, revokedAt: NOW });
  const escalated = ask(
    { ...mandate, revokedAt: NOW },
    { action: "escalate_to_human", channel: "in_app" },
  );
  const inactive = !mandateIsActive({ ...mandate, revokedAt: NOW }, NOW);
  checks.push({
    id: "revocation-freezes-but-never-traps",
    proves: "a revoked mandate refuses everything except escalation to a human",
    ok:
      inactive &&
      revoked.decision === "DENY" &&
      revoked.failedRules.includes("rule_mandate_inactive") &&
      escalated.decision === "ALLOW",
    detail: `action=${revoked.decision} escalation=${escalated.decision}`,
  });

  const catalogueFindings = auditProviderCatalogue();
  const liveAdapters = PROVIDER_CATALOGUE.filter((entry) => entry.health === "ACTIVE").map(
    (entry) => entry.id,
  );
  const refusedRouting = selectProvider({ channel: "sms", region: "europe" });
  const resolvedRouting = selectProvider({
    channel: "sms",
    region: "europe",
    healthOverrides: { twilio: "ACTIVE" },
  });
  const resolvedAdapterId = resolvedRouting.ok ? resolvedRouting.adapter.id : "";
  checks.push({
    id: "no-external-provider-is-live-yet",
    proves:
      "routing is refused today because no external adapter holds a credential, and resolves to the declared primary once one does",
    ok:
      catalogueFindings.length === 0 &&
      refusedRouting.ok === false &&
      liveAdapters.length === 1 &&
      liveAdapters[0] === "platform-presence" &&
      resolvedAdapterId === "twilio",
    detail: `live=${liveAdapters.join(",")} routing=${refusedRouting.ok ? "resolved" : "refused"} findings=${catalogueFindings.length}`,
  });

  const ladder = failoverChain("voice", "africa");
  checks.push({
    id: "failover-ladder-is-declared",
    proves:
      "a channel and a region resolve to an ordered ladder of carriers, regional before global secondary",
    ok:
      ladder.length > 1 &&
      ladder[0].id === "twilio" &&
      ladder.some((entry) => entry.id === "africas-talking"),
    detail: ladder.map((entry) => `${entry.id}:${entry.tier}`).join(" > "),
  });

  return checks;
}

/** What the platform does NOT yet do. Reported here so no surface can imply otherwise. */
export interface StewardGap {
  id: string;
  gap: string;
  consequence: string;
  owner: string;
}

export function communicationStewardGaps(): readonly StewardGap[] {
  return [
    {
      id: "no-live-external-provider",
      gap: "Every external provider adapter is DISCOVERED: no credential is provisioned, so routing refuses every real channel.",
      consequence:
        "No SMS, voice call, WhatsApp message, email or push can leave the platform today. Only platform presence and in-app are live.",
      owner:
        "Control Plane operations (per-tenant credential provisioning) — a deployment action, not a code change",
    },
    {
      id: "no-persistence",
      gap: "Mandates, consent records, do-not-contact entries, call sessions and subscriptions are pure values: no table, migration or RLS policy creates them.",
      consequence:
        "A mandate lives only as long as the process that built it, so no decision can be proved after the fact.",
      owner: "Phase 10 schema work (database/migrations) with Phase 03 row-level security",
    },
    {
      id: "no-telephony-binding",
      gap: "No adapter performs a provider call and no webhook receiver is mounted, so the registry describes routing without exercising it.",
      consequence:
        "Failover, retry and delivery receipts are declared behaviour rather than observed behaviour.",
      owner: "Phase 10 integration work (provider client and inbound webhook surface)",
    },
    {
      id: "no-steward-model",
      gap: "The steward's decisions are deterministic policy with no model behind them: no generation path and no knowledge-pack store exists.",
      consequence:
        "The steward can decide what may be sent; it cannot yet compose an answer from the organization's own material.",
      owner:
        "Phase 07 agent system for generation, with Phase 10 providing the knowledge pack store",
    },
    {
      id: "no-recording-or-transcript-store",
      gap: "recordingAllowed is a mandate flag with no storage, retention window, access policy or deletion path behind it.",
      consequence:
        "Recording stays switched off lawfully until retention, access and deletion are real.",
      owner: "Phase 10 storage with Phase 09 retention rules",
    },
    {
      id: "no-subscription-billing",
      gap: "A subscription carries a billingRef string; nothing meters steward usage or charges by plan.",
      consequence:
        "Seat counts and plan tiers are descriptive: no plan is enforced and nothing is invoiced.",
      owner: "Control Plane billing (commercial phases)",
    },
    {
      id: "human-role-replacement-is-an-organizational-decision",
      gap: "A mandate can hold the authority that replaces a support-and-communications role, but no organization has been migrated onto it and no handover procedure is recorded.",
      consequence:
        "The platform states the capability; the handover stays a decision each organization must take with its own staff, and it is not automated here.",
      owner: "Tenant governance (per-organization adoption decision)",
    },
  ];
}

/** One organization's provisioned steward, as the control plane would see it. */
export interface OrganizationStewardProfile {
  organizationName: string;
  tenantId: string;
  autonomy: StewardAutonomyLevel;
  jurisdictions: readonly string[];
  languages: readonly string[];
  seats: number;
  mandate: string;
}

export interface CommunicationStewardReport {
  vocabulary: {
    autonomyLevels: number;
    actionKinds: number;
    personFacingActions: number;
    actionsNeedingAutonomousAuthority: number;
    audiences: number;
    topics: number;
    purposes: number;
    classifications: number;
  };
  organizations: readonly OrganizationStewardProfile[];
  providers: {
    adapters: number;
    live: readonly string[];
    discovered: number;
    channels: number;
    capabilityRows: number;
    catalogueFindings: readonly string[];
  };
  rules: readonly StewardRule[];
  checks: readonly StewardCheck[];
  passed: number;
  failed: number;
  healthy: boolean;
  failingChecks: readonly string[];
  gaps: readonly StewardGap[];
}

function profileOf(input: {
  tenantId: string;
  organizationName: string;
  plan: CommunicationPlanTier;
  jurisdiction: string;
  language: string;
}): OrganizationStewardProfile | undefined {
  const opened = openOrganization(input);
  if (!opened) return undefined;
  return {
    organizationName: opened.mandate.organizationName,
    tenantId: opened.mandate.tenantId,
    autonomy: opened.mandate.autonomy,
    jurisdictions: opened.mandate.jurisdictions,
    languages: opened.mandate.languages,
    seats: opened.seats,
    mandate: mandateSummary(opened.mandate),
  };
}

export function communicationStewardReport(): CommunicationStewardReport {
  const checks = runCommunicationStewardCheck();
  const failingChecks = checks.filter((check) => !check.ok).map((check) => check.id);

  const organizations = [
    profileOf({
      tenantId: "tenant-school-1",
      organizationName: "Riverside Institute",
      plan: "institution",
      jurisdiction: "NG",
      language: "en",
    }),
    profileOf({
      tenantId: "tenant-clinic-1",
      organizationName: "Northgate Clinic",
      plan: "professional",
      jurisdiction: "GB",
      language: "en",
    }),
    profileOf({
      tenantId: "tenant-transport-1",
      organizationName: "Delta Transport Services",
      plan: "enterprise",
      jurisdiction: "KE",
      language: "sw",
    }),
  ].filter((profile): profile is OrganizationStewardProfile => profile !== undefined);

  const live = PROVIDER_CATALOGUE.filter((entry) => entry.health === "ACTIVE").map(
    (entry) => entry.id,
  );
  const capabilityRows = providerCapabilityMatrix();

  return {
    vocabulary: {
      autonomyLevels: STEWARD_AUTONOMY_LEVELS.length,
      actionKinds: STEWARD_ACTION_KINDS.length,
      personFacingActions: PERSON_FACING_ACTION_KINDS.length,
      actionsNeedingAutonomousAuthority: STEWARD_ACTION_KINDS.filter(
        (action) => ACTION_MINIMUM_AUTONOMY[action] === "AUTONOMOUS",
      ).length,
      audiences: STEWARD_AUDIENCES.length,
      topics: STEWARD_TOPICS.length,
      purposes: COMMUNICATION_PURPOSES.length,
      classifications: COMMUNICATION_CLASSIFICATIONS.length,
    },
    organizations,
    providers: {
      adapters: PROVIDER_CATALOGUE.length,
      live,
      discovered: PROVIDER_CATALOGUE.length - live.length,
      channels: capabilityRows.length,
      capabilityRows: capabilityRows.filter((row) => row.providers.length > 0).length,
      catalogueFindings: auditProviderCatalogue(),
    },
    rules: communicationStewardRules(),
    checks,
    passed: checks.length - failingChecks.length,
    failed: failingChecks.length,
    healthy: failingChecks.length === 0,
    failingChecks,
    gaps: communicationStewardGaps(),
  };
}

/** One line an operator can read: what is real, and what is not yet. */
export function stewardReportSummary(report: CommunicationStewardReport): string {
  return [
    `${report.organizations.length} organizations provisioned`,
    `${report.vocabulary.actionKinds} action kinds (${report.vocabulary.personFacingActions} person-facing)`,
    `${report.providers.adapters} provider adapters (${report.providers.live.length} live)`,
    `checks ${report.passed}/${report.checks.length}`,
    `${report.gaps.length} declared gaps`,
  ].join(" · ");
}
