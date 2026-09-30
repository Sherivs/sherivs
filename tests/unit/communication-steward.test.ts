/**
 * CoreGrid — Phase 10 Communication Platform: the Communication Steward.
 *
 * Every organization on the platform is given an autonomous communication steward, so
 * the tests that matter are the refusals: each way the platform says no, and the rule
 * that says it. An allowed action is only allowed if its duties come with it, and a
 * refusal is only trustworthy if it names the limit rather than leaving the caller to
 * guess.
 */
import { describe, expect, it } from "vitest";

import {
  ACTION_MINIMUM_AUTONOMY,
  CALL_SESSION_STATES,
  DEFAULT_STEWARD_LIMITS,
  EMPTY_STEWARD_USAGE,
  PERSON_FACING_ACTION_KINDS,
  STEWARD_ACTION_KINDS,
  STEWARD_AUTONOMY_LEVELS,
  STEWARD_FORBIDDEN_CLASSIFICATIONS,
  autonomyRank,
  createCallSession,
  createConsentRecord,
  disclosureObligation,
  evaluateEscalation,
  evaluateStewardAction,
  hasActiveConsent,
  isAutonomyAtLeast,
  isCallResolved,
  isCallTransitionAllowed,
  isDoNotContact,
  isWithinQuietHours,
  knowledgeCoverage,
  limitStatus,
  mandateIsActive,
  mandateSummary,
  observesQuietHours,
  provisionOrganizationSubscription,
  type ConsentRecord,
  type DoNotContactEntry,
  type StewardActionRequest,
  type StewardKnowledgePack,
  type StewardMandate,
  type StewardUsage,
} from "@/lib/communication-steward";

const NOW = "2026-03-02T12:00:00.000Z";

/** A fully-permissive mandate: each test removes exactly the authority it tests. */
function activeMandate(overrides: Partial<StewardMandate> = {}): StewardMandate {
  return {
    id: "mandate-1",
    tenantId: "tenant-1",
    organizationName: "Riverside Institute",
    stewardId: "steward-1",
    autonomy: "AUTONOMOUS",
    channels: [
      "voice",
      "sms",
      "whatsapp",
      "email",
      "in_app",
      "presence",
      "social",
      "status",
      "meeting",
      "push",
    ],
    audiences: ["guardians", "staff", "teachers", "students"],
    jurisdictions: ["NG", "GB"],
    languages: ["en", "fr"],
    knowledgeTopics: ["attendance", "fees_and_payments", "facilities"],
    prohibitedTopics: ["media_and_press"],
    quietHours: { enabled: true, from: "21:00", to: "07:00", timezone: "Africa/Lagos" },
    limits: { ...DEFAULT_STEWARD_LIMITS },
    requiresDisclosure: true,
    recordingAllowed: true,
    emergencyAllowed: true,
    externalRecipientsAllowed: true,
    escalationTarget: "queue:tenant-1:human-support",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

/** A request that succeeds against `activeMandate()`, so failures are the deltas. */
function actionRequest(overrides: Partial<StewardActionRequest> = {}): StewardActionRequest {
  return {
    action: "send_message",
    channel: "sms",
    audience: "guardians",
    purpose: "transactional",
    classification: "INTERNAL",
    jurisdictions: ["NG"],
    language: "en",
    topics: ["attendance"],
    localTime: "12:00",
    now: NOW,
    ...overrides,
  };
}

function consentRecord(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id: "consent-1",
    tenantId: "tenant-1",
    subjectRef: "contact-1",
    channel: "sms",
    purpose: "marketing",
    grantedAt: "2026-02-01T00:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    source: "web-form:newsletter",
    ...overrides,
  };
}

function usage(overrides: Partial<StewardUsage> = {}): StewardUsage {
  return { ...EMPTY_STEWARD_USAGE, ...overrides };
}

function knowledgePack(overrides: Partial<StewardKnowledgePack> = {}): StewardKnowledgePack {
  return {
    stewardId: "steward-1",
    tenantId: "tenant-1",
    topics: ["attendance", "fees_and_payments"],
    sourceRef: "document:tenant-1:handbook-v4",
    version: "4",
    refreshedAt: "2026-02-20T00:00:00.000Z",
    refusedTopics: ["media_and_press"],
    ...overrides,
  };
}

describe("Phase 10 — organization subscription and the mandate it creates", () => {
  it("refuses to provision without a tenant or an organization", () => {
    const noTenant = provisionOrganizationSubscription({
      id: "sub-1",
      tenantId: "  ",
      organizationName: "Riverside Institute",
      plan: "essential",
      channels: ["sms"],
      now: NOW,
    });
    expect(noTenant.ok).toBe(false);

    const noOrganization = provisionOrganizationSubscription({
      id: "sub-1",
      tenantId: "tenant-1",
      organizationName: "",
      plan: "essential",
      channels: ["sms"],
      now: NOW,
    });
    expect(noOrganization.ok).toBe(false);
  });

  it("starts a new organization's steward in OBSERVE with nothing opened", () => {
    const result = provisionOrganizationSubscription({
      id: "sub-1",
      tenantId: "tenant-1",
      organizationName: "Riverside Institute",
      plan: "institution",
      channels: ["sms", "voice"],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { mandate, subscription } = result;
    expect(mandate.autonomy).toBe("OBSERVE");
    expect(mandate.channels).toEqual([]);
    expect(mandate.audiences).toEqual([]);
    expect(mandate.jurisdictions).toEqual([]);
    expect(mandate.languages).toEqual([]);
    expect(mandate.knowledgeTopics).toEqual([]);
    expect(mandate.recordingAllowed).toBe(false);
    expect(mandate.externalRecipientsAllowed).toBe(false);
    expect(mandate.emergencyAllowed).toBe(false);
    expect(mandate.escalationTarget).toBe("queue:tenant-1:human-support");
    expect(subscription.status).toBe("pending");
    expect(subscription.stewardEnabled).toBe(true);
    expect(mandateIsActive(mandate, NOW)).toBe(true);
  });

  it("scales steward seats with the plan and keeps requested channels on the subscription", () => {
    const essential = provisionOrganizationSubscription({
      id: "sub-1",
      tenantId: "t1",
      organizationName: "A",
      plan: "essential",
      channels: ["sms"],
      now: NOW,
    });
    const enterprise = provisionOrganizationSubscription({
      id: "sub-2",
      tenantId: "t2",
      organizationName: "B",
      plan: "enterprise",
      channels: ["sms", "voice", "whatsapp"],
      now: NOW,
    });
    expect(essential.ok && essential.subscription.stewardSeats).toBe(1);
    expect(enterprise.ok && enterprise.subscription.stewardSeats).toBe(10);
    expect(enterprise.ok && enterprise.subscription.channels).toEqual(["sms", "voice", "whatsapp"]);
  });

  it("treats a revoked or expired mandate as not live, whatever it authorises", () => {
    expect(mandateIsActive(activeMandate({ revokedAt: NOW }), NOW)).toBe(false);
    expect(mandateIsActive(activeMandate({ expiresAt: "2026-02-01T00:00:00.000Z" }), NOW)).toBe(
      false,
    );
    expect(mandateIsActive(activeMandate({ expiresAt: "2026-04-01T00:00:00.000Z" }), NOW)).toBe(
      true,
    );
  });
});

describe("Phase 10 — autonomy is a ladder, not a switch", () => {
  it("ranks the levels in order", () => {
    expect(autonomyRank("OBSERVE")).toBeLessThan(autonomyRank("DRAFT"));
    expect(autonomyRank("DRAFT")).toBeLessThan(autonomyRank("APPROVAL_REQUIRED"));
    expect(autonomyRank("APPROVAL_REQUIRED")).toBeLessThan(autonomyRank("AUTONOMOUS"));
    expect(isAutonomyAtLeast("AUTONOMOUS", "DRAFT")).toBe(true);
    expect(isAutonomyAtLeast("DRAFT", "AUTONOMOUS")).toBe(false);
  });

  it("requires the highest authority for the realtime and public actions", () => {
    expect(ACTION_MINIMUM_AUTONOMY.answer_inbound_call).toBe("AUTONOMOUS");
    expect(ACTION_MINIMUM_AUTONOMY.place_outbound_call).toBe("AUTONOMOUS");
    expect(ACTION_MINIMUM_AUTONOMY.publish_social).toBe("APPROVAL_REQUIRED");
    expect(ACTION_MINIMUM_AUTONOMY.send_message).toBe("APPROVAL_REQUIRED");
  });

  it("keeps every person-facing action above the drafting level", () => {
    for (const action of PERSON_FACING_ACTION_KINDS) {
      expect(
        isAutonomyAtLeast(ACTION_MINIMUM_AUTONOMY[action], "APPROVAL_REQUIRED"),
        `${action} reaches a person, so it needs at least APPROVAL_REQUIRED`,
      ).toBe(true);
    }
  });

  it("keeps the two views of the same rule consistent", () => {
    for (const action of STEWARD_ACTION_KINDS) {
      if (ACTION_MINIMUM_AUTONOMY[action] !== "APPROVAL_REQUIRED") continue;
      expect(
        PERSON_FACING_ACTION_KINDS.includes(action),
        `${action}: an action needing approval is one that reaches a person`,
      ).toBe(true);
    }
  });

  it("gives every action kind a minimum autonomy, and escalation the lowest", () => {
    for (const action of STEWARD_ACTION_KINDS) {
      expect(STEWARD_AUTONOMY_LEVELS, `${action} must declare a minimum autonomy`).toContain(
        ACTION_MINIMUM_AUTONOMY[action],
      );
    }
    expect(ACTION_MINIMUM_AUTONOMY.escalate_to_human).toBe("OBSERVE");
  });
});

describe("Phase 10 — hard limits are reported, not discovered", () => {
  it("reports nothing when nothing has been used", () => {
    const status = limitStatus(activeMandate(), EMPTY_STEWARD_USAGE);
    expect(status.exceeded).toEqual([]);
    expect(status.approaching).toEqual([]);
  });

  it("names each limit that has been reached", () => {
    const status = limitStatus(
      activeMandate(),
      usage({
        outboundCallsLastHour: DEFAULT_STEWARD_LIMITS.maxOutboundCallsPerHour,
        messagesToday: DEFAULT_STEWARD_LIMITS.maxMessagesPerDay,
      }),
    );
    expect(status.exceeded).toContain("outbound_calls_per_hour");
    expect(status.exceeded).toContain("messages_per_day");
  });

  it("warns before a limit is reached", () => {
    const status = limitStatus(
      activeMandate(),
      usage({
        spendMinorUnitsThisMonth: Math.floor(
          DEFAULT_STEWARD_LIMITS.maxMonthlySpendMinorUnits * 0.85,
        ),
      }),
    );
    expect(status.exceeded).toEqual([]);
    expect(status.approaching).toContain("monthly_spend");
  });
});

describe("Phase 10 — consent and do-not-contact are recorded, never assumed", () => {
  it("refuses an opt-in with no subject, no source, or an emergency purpose", () => {
    expect(
      createConsentRecord({
        id: "c1",
        tenantId: "tenant-1",
        subjectRef: " ",
        channel: "sms",
        purpose: "marketing",
        grantedAt: NOW,
        source: "web-form:newsletter",
      }).ok,
    ).toBe(false);

    expect(
      createConsentRecord({
        id: "c1",
        tenantId: "tenant-1",
        subjectRef: "contact-1",
        channel: "sms",
        purpose: "marketing",
        grantedAt: NOW,
        source: "",
      }).ok,
    ).toBe(false);

    expect(
      createConsentRecord({
        id: "c1",
        tenantId: "tenant-1",
        subjectRef: "contact-1",
        channel: "sms",
        purpose: "emergency",
        grantedAt: NOW,
        source: "web-form:newsletter",
      }).ok,
    ).toBe(false);
  });

  it("records an attributable opt-in and reports it active", () => {
    const created = createConsentRecord({
      id: "c1",
      tenantId: "tenant-1",
      subjectRef: "contact-1",
      channel: "sms",
      purpose: "marketing",
      grantedAt: NOW,
      source: "web-form:newsletter",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.record.revokedAt).toBeNull();

    expect(
      hasActiveConsent(
        [created.record],
        { subjectRef: "contact-1", channel: "sms", purpose: "marketing" },
        NOW,
      ),
    ).toBe(true);
  });

  it("never treats another channel, purpose, revocation or expiry as consent", () => {
    const base = { subjectRef: "contact-1", channel: "sms", purpose: "marketing" } as const;
    expect(hasActiveConsent([consentRecord({ channel: "email" })], base, NOW)).toBe(false);
    expect(hasActiveConsent([consentRecord({ purpose: "transactional" })], base, NOW)).toBe(false);
    expect(hasActiveConsent([consentRecord({ revokedAt: NOW })], base, NOW)).toBe(false);
    expect(
      hasActiveConsent([consentRecord({ expiresAt: "2026-02-15T00:00:00.000Z" })], base, NOW),
    ).toBe(false);
  });

  it("honours do-not-contact absolutely, and the narrower scopes precisely", () => {
    const all: DoNotContactEntry[] = [
      { contactRef: "contact-1", scope: "all", recordedAt: NOW, source: "phone-call" },
    ];
    const marketing: DoNotContactEntry[] = [
      { contactRef: "contact-1", scope: "marketing", recordedAt: NOW, source: "web-form" },
    ];
    const voice: DoNotContactEntry[] = [
      { contactRef: "contact-1", scope: "voice", recordedAt: NOW, source: "web-form" },
    ];

    expect(isDoNotContact(all, "contact-1", "transactional")).toBe(true);
    expect(isDoNotContact(all, "contact-2", "transactional")).toBe(false);
    expect(isDoNotContact(marketing, "contact-1", "marketing")).toBe(true);
    expect(isDoNotContact(marketing, "contact-1", "service")).toBe(false);
    expect(isDoNotContact(voice, "contact-1", "service")).toBe(true);
    expect(isDoNotContact(voice, "contact-1", "emergency")).toBe(false);
  });
});

describe("Phase 10 — the knowledge pack bounds what the steward may say", () => {
  it("separates what it knows, what it must learn, and what it must refuse", () => {
    const coverage = knowledgeCoverage(
      knowledgePack(),
      ["attendance", "transport", "media_and_press"],
      activeMandate(),
    );

    expect(coverage.covered).toEqual(["attendance"]);
    expect(coverage.missing).toEqual(["transport"]);
    expect(coverage.refused).toEqual(["media_and_press"]);
  });

  it("refuses a topic the mandate prohibits even if the pack holds it", () => {
    const coverage = knowledgeCoverage(
      knowledgePack({ topics: ["attendance", "media_and_press"] }),
      ["media_and_press"],
      activeMandate(),
    );
    expect(coverage.refused).toEqual(["media_and_press"]);
    expect(coverage.covered).toEqual([]);
  });

  it("treats a topic the mandate has not opened as missing, not as known", () => {
    const coverage = knowledgeCoverage(
      knowledgePack({ topics: ["attendance"] }),
      ["attendance"],
      activeMandate({ knowledgeTopics: [] }),
    );
    expect(coverage.covered).toEqual([]);
    expect(coverage.missing).toEqual(["attendance"]);
  });
});

describe("Phase 10 — call control accepts only legal transitions", () => {
  it("starts a call in REQUESTED and never in an outcome", () => {
    const session = createCallSession({
      id: "call-1",
      tenantId: "tenant-1",
      stewardId: "steward-1",
      direction: "inbound",
      channel: "voice",
      contactRef: "contact-1",
      now: NOW,
    });
    expect(session.state).toBe("REQUESTED");
    expect(session.endedAt).toBeNull();
    expect(session.disposition).toBeNull();
    expect(session.escalatedTo).toBeNull();
  });

  it("allows the real path and refuses shortcuts to an outcome", () => {
    expect(isCallTransitionAllowed("REQUESTED", "RINGING")).toBe(true);
    expect(isCallTransitionAllowed("RINGING", "ANSWERED")).toBe(true);
    expect(isCallTransitionAllowed("ANSWERED", "IN_PROGRESS")).toBe(true);
    expect(isCallTransitionAllowed("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(isCallTransitionAllowed("MISSED", "ESCALATED")).toBe(true);

    expect(isCallTransitionAllowed("REQUESTED", "COMPLETED")).toBe(false);
    expect(isCallTransitionAllowed("MISSED", "ANSWERED")).toBe(false);
    expect(isCallTransitionAllowed("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(isCallTransitionAllowed("ABANDONED", "RINGING")).toBe(false);
  });

  it("treats a finished or abandoned call as terminal", () => {
    for (const state of CALL_SESSION_STATES) {
      if (state !== "COMPLETED" && state !== "ABANDONED") continue;
      expect(
        CALL_SESSION_STATES.some((candidate) => isCallTransitionAllowed(state, candidate)),
        `${state} must be terminal`,
      ).toBe(false);
    }
  });

  it("counts only a completed call as resolved", () => {
    expect(isCallResolved("COMPLETED")).toBe(true);
    for (const state of CALL_SESSION_STATES.filter((candidate) => candidate !== "COMPLETED")) {
      expect(isCallResolved(state), `${state} is not a resolved call`).toBe(false);
    }
  });
});

describe("Phase 10 — escalation is the designed exit, not a failure", () => {
  it("escalates an unacknowledged emergency within ten minutes", () => {
    expect(
      evaluateEscalation({
        attempts: 1,
        acknowledged: false,
        minutesSinceLastAttempt: 10,
        severity: "emergency",
      }).escalate,
    ).toBe(true);
  });

  it("escalates an unacknowledged urgent message within the hour", () => {
    expect(
      evaluateEscalation({
        attempts: 1,
        acknowledged: false,
        minutesSinceLastAttempt: 60,
        severity: "urgent",
      }).escalate,
    ).toBe(true);
  });

  it("escalates after three attempts or a day of silence", () => {
    expect(
      evaluateEscalation({
        attempts: 3,
        acknowledged: false,
        minutesSinceLastAttempt: 1,
        severity: "routine",
      }).escalate,
    ).toBe(true);
    expect(
      evaluateEscalation({
        attempts: 1,
        acknowledged: false,
        minutesSinceLastAttempt: 1,
        severity: "routine",
        unreadHours: 24,
      }).escalate,
    ).toBe(true);
  });

  it("stays quiet when the message was acknowledged or is still fresh", () => {
    expect(
      evaluateEscalation({
        attempts: 1,
        acknowledged: true,
        minutesSinceLastAttempt: 600,
        severity: "emergency",
      }).escalate,
    ).toBe(false);
    expect(
      evaluateEscalation({
        attempts: 2,
        acknowledged: false,
        minutesSinceLastAttempt: 5,
        severity: "routine",
        unreadHours: 2,
      }).escalate,
    ).toBe(false);
  });
});

describe("Phase 10 — quiet hours and disclosure duties", () => {
  const night = { enabled: true, from: "21:00", to: "07:00", timezone: "Africa/Lagos" };
  const office = { enabled: true, from: "09:00", to: "17:00", timezone: "UTC" };

  it("reads wrap-around quiet hours inclusively at the start and exclusively at the end", () => {
    expect(isWithinQuietHours("21:00", night)).toBe(true);
    expect(isWithinQuietHours("23:30", night)).toBe(true);
    expect(isWithinQuietHours("03:00", night)).toBe(true);
    expect(isWithinQuietHours("06:59", night)).toBe(true);
    expect(isWithinQuietHours("07:00", night)).toBe(false);
    expect(isWithinQuietHours("12:00", night)).toBe(false);
  });

  it("reads ordinary quiet hours the same way", () => {
    expect(isWithinQuietHours("09:00", office)).toBe(true);
    expect(isWithinQuietHours("16:59", office)).toBe(true);
    expect(isWithinQuietHours("17:00", office)).toBe(false);
    expect(isWithinQuietHours("08:59", office)).toBe(false);
  });

  it("treats quiet hours as off when disabled or empty", () => {
    expect(isWithinQuietHours("23:30", { ...night, enabled: false })).toBe(false);
    expect(isWithinQuietHours("23:30", { ...night, from: "21:00", to: "21:00" })).toBe(false);
  });

  it("fails closed on an unreadable clock, because a bad timestamp is not a licence", () => {
    expect(isWithinQuietHours("not-a-time", night)).toBe(true);
    expect(isWithinQuietHours("25:00", night)).toBe(true);
    expect(isWithinQuietHours("12:00", { ...night, from: "" })).toBe(true);
  });

  it("applies quiet hours only to channels that reach a person outside the platform", () => {
    expect(observesQuietHours("voice")).toBe(true);
    expect(observesQuietHours("sms")).toBe(true);
    expect(observesQuietHours("email")).toBe(true);
    expect(observesQuietHours("in_app")).toBe(false);
    expect(observesQuietHours("presence")).toBe(false);
    expect(observesQuietHours("meeting")).toBe(false);
  });

  it("requires disclosure when the mandate demands it or the words are machine-made", () => {
    expect(
      disclosureObligation(activeMandate(), {
        action: "answer_inbound_call",
        aiGenerated: true,
        jurisdictions: ["NG"],
      }).required,
    ).toBe(true);

    expect(
      disclosureObligation(activeMandate({ requiresDisclosure: false }), {
        action: "send_message",
        aiGenerated: undefined,
        jurisdictions: ["NG"],
      }).required,
    ).toBe(false);

    expect(
      disclosureObligation(activeMandate({ requiresDisclosure: false }), {
        action: "send_message",
        aiGenerated: true,
        jurisdictions: ["NG"],
      }).required,
    ).toBe(true);

    expect(
      disclosureObligation(activeMandate(), {
        action: "schedule_meeting",
        aiGenerated: true,
        jurisdictions: ["NG"],
      }).required,
    ).toBe(false);
  });
});

describe("Phase 10 — an allowed action carries its duties with it", () => {
  it("allows a transactional message inside the mandate, with audit and opt-out duties", () => {
    const decision = evaluateStewardAction(activeMandate(), actionRequest());

    expect(decision.decision).toBe("ALLOW");
    expect(decision.failedRules).toEqual([]);
    expect(decision.reason).toContain("Within mandate");
    expect(decision.obligations).toContain("audit_record");
    expect(decision.obligations).toContain("honour_opt_out");
    expect(decision.limits.exceeded).toEqual([]);
    expect(decision.limits.approaching).toEqual([]);
  });

  it("discloses itself on a call, and announces recording when recording happens", () => {
    const decision = evaluateStewardAction(
      activeMandate(),
      actionRequest({
        action: "place_outbound_call",
        channel: "voice",
        requiresRecording: true,
        aiGenerated: true,
      }),
    );

    expect(decision.decision).toBe("ALLOW");
    expect(decision.obligations).toContain("disclose_ai_on_call");
    expect(decision.obligations).toContain("announce_recording");
  });

  it("discloses in writing when the conversation is in writing", () => {
    const decision = evaluateStewardAction(
      activeMandate(),
      actionRequest({ action: "send_whatsapp", channel: "whatsapp", aiGenerated: true }),
    );
    expect(decision.decision).toBe("ALLOW");
    expect(decision.obligations).toContain("disclose_ai_in_message");
  });

  it("keeps a public statement logged, because a public statement cannot be recalled", () => {
    const decision = evaluateStewardAction(
      activeMandate(),
      actionRequest({ action: "publish_social", channel: "social", purpose: "service" }),
    );
    expect(decision.decision).toBe("ALLOW");
    expect(decision.obligations).toContain("public_statement_log");
  });

  it("reaches an in-app channel outside quiet hours, and an external one only inside them", () => {
    const inApp = evaluateStewardAction(
      activeMandate(),
      actionRequest({ action: "send_message", channel: "in_app", localTime: "23:30" }),
    );
    expect(inApp.decision).toBe("ALLOW");

    const sms = evaluateStewardAction(
      activeMandate(),
      actionRequest({ action: "send_message", channel: "sms", localTime: "23:30" }),
    );
    expect(sms.decision).toBe("DENY");
    expect(sms.failedRules).toContain("rule_quiet_hours");
  });

  it("warns the owner when a limit is approaching, before it is hit", () => {
    const decision = evaluateStewardAction(
      activeMandate(),
      actionRequest({
        usage: usage({
          spendMinorUnitsThisMonth: Math.floor(
            DEFAULT_STEWARD_LIMITS.maxMonthlySpendMinorUnits * 0.9,
          ),
        }),
      }),
    );
    expect(decision.decision).toBe("ALLOW");
    expect(decision.limits.approaching).toContain("monthly_spend");
    expect(decision.obligations).toContain("warn_owner_budget");
  });
});

describe("Phase 10 — a mandate bounds what the steward may do at all", () => {
  it("lets a steward escalate even when its mandate is revoked and empty", () => {
    const decision = evaluateStewardAction(
      activeMandate({
        autonomy: "OBSERVE",
        channels: [],
        audiences: [],
        jurisdictions: [],
        languages: [],
        revokedAt: NOW,
      }),
      actionRequest({ action: "escalate_to_human", channel: "in_app" }),
    );

    expect(decision.decision).toBe("ALLOW");
    expect(decision.obligations).toContain("record_escalation");
    expect(decision.obligations).toContain("notify_queue");
  });

  it("refuses everything else when the mandate is revoked or expired", () => {
    const revoked = evaluateStewardAction(activeMandate({ revokedAt: NOW }), actionRequest());
    expect(revoked.decision).toBe("DENY");
    expect(revoked.failedRules).toContain("rule_mandate_inactive");

    const expired = evaluateStewardAction(
      activeMandate({ expiresAt: "2026-02-01T00:00:00.000Z" }),
      actionRequest(),
    );
    expect(expired.decision).toBe("DENY");
    expect(expired.failedRules).toContain("rule_mandate_inactive");
  });

  it("refuses a classification the platform forbids a steward to hold", () => {
    expect(STEWARD_FORBIDDEN_CLASSIFICATIONS).toContain("HIGHLY_RESTRICTED");
    const decision = evaluateStewardAction(
      activeMandate(),
      actionRequest({ classification: "HIGHLY_RESTRICTED" }),
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.failedRules).toContain("rule_classification_forbidden");
  });

  it("refuses a topic the organization prohibited, before anything else is weighed", () => {
    const decision = evaluateStewardAction(
      activeMandate(),
      actionRequest({
        classification: "INTERNAL",
        knowledge: { covered: [], missing: [], refused: ["media_and_press"] },
      }),
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.failedRules).toContain("rule_topic_prohibited");
    expect(decision.reason).toContain("media_and_press");
  });

  it("refuses a channel or an audience the mandate never opened", () => {
    const channel = evaluateStewardAction(
      activeMandate({ channels: ["email"] }),
      actionRequest({ channel: "sms" }),
    );
    expect(channel.decision).toBe("DENY");
    expect(channel.failedRules).toContain("rule_channel_not_authorised");

    const audience = evaluateStewardAction(
      activeMandate({ audiences: ["staff"] }),
      actionRequest({ audience: "guardians" }),
    );
    expect(audience.decision).toBe("DENY");
    expect(audience.failedRules).toContain("rule_audience_not_authorised");
  });

  it("refuses to reach outside the organization when the mandate says inside only", () => {
    const decision = evaluateStewardAction(
      activeMandate({ externalRecipientsAllowed: false }),
      actionRequest({ externalRecipient: true }),
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.failedRules).toContain("rule_external_not_authorised");
  });

  it("refuses an unknown jurisdiction and one outside the mandate", () => {
    const unknown = evaluateStewardAction(activeMandate(), actionRequest({ jurisdictions: [] }));
    expect(unknown.decision).toBe("DENY");
    expect(unknown.failedRules).toContain("rule_jurisdiction_unknown");

    const outside = evaluateStewardAction(
      activeMandate({ jurisdictions: ["NG"] }),
      actionRequest({ jurisdictions: ["NG", "US"] }),
    );
    expect(outside.decision).toBe("DENY");
    expect(outside.failedRules).toContain("rule_jurisdiction_outside");
    expect(outside.reason).toContain("US");
  });

  it("hands a language it cannot speak to a human rather than guessing", () => {
    const decision = evaluateStewardAction(
      activeMandate({ languages: ["en"] }),
      actionRequest({ language: "es" }),
    );
    expect(decision.decision).toBe("ESCALATE");
    expect(decision.failedRules).toContain("rule_language_not_mandated");
  });
});

describe("Phase 10 — the person's instruction outranks the organization's appetite", () => {
  it("refuses a contact who asked not to be contacted", () => {
    const decision = evaluateStewardAction(
      activeMandate(),
      actionRequest({
        contactRef: "contact-1",
        doNotContact: [
          { contactRef: "contact-1", scope: "all", recordedAt: NOW, source: "phone-call" },
        ],
      }),
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.failedRules).toContain("rule_do_not_contact");
    expect(decision.obligations).toContain("honour_opt_out");
  });

  it("refuses marketing without a recorded opt-in, and allows it with one", () => {
    const without = evaluateStewardAction(
      activeMandate(),
      actionRequest({ purpose: "marketing", contactRef: "contact-1" }),
    );
    expect(without.decision).toBe("DENY");
    expect(without.failedRules).toContain("rule_consent_required");

    const withConsent = evaluateStewardAction(
      activeMandate(),
      actionRequest({
        purpose: "marketing",
        contactRef: "contact-1",
        consentRecords: [consentRecord()],
      }),
    );
    expect(withConsent.decision).toBe("ALLOW");
  });

  it("refuses an emergency broadcast the mandate never authorised", () => {
    const decision = evaluateStewardAction(
      activeMandate({ emergencyAllowed: false }),
      actionRequest({ purpose: "emergency", localTime: "23:30" }),
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.failedRules).toContain("rule_emergency_not_authorised");
  });

  it("lets an authorised emergency through even inside quiet hours", () => {
    const decision = evaluateStewardAction(
      activeMandate({ emergencyAllowed: true }),
      actionRequest({ purpose: "emergency", localTime: "03:00" }),
    );
    expect(decision.decision).toBe("ALLOW");
  });
});

describe("Phase 10 — knowledge, limits and recording are refusals, not warnings", () => {
  it("escalates a topic outside the pack instead of improvising", () => {
    const decision = evaluateStewardAction(
      activeMandate(),
      actionRequest({ knowledge: { covered: [], missing: ["transport"], refused: [] } }),
    );
    expect(decision.decision).toBe("ESCALATE");
    expect(decision.failedRules).toContain("rule_knowledge_scope");
    expect(decision.reason).toContain("transport");
  });

  it("stops when a hard limit is reached, and names the limit", () => {
    const decision = evaluateStewardAction(
      activeMandate(),
      actionRequest({
        usage: usage({ messagesToday: DEFAULT_STEWARD_LIMITS.maxMessagesPerDay }),
      }),
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.failedRules).toContain("rule_limits_exceeded");
    expect(decision.limits.exceeded).toContain("messages_per_day");
  });

  it("refuses to record a call the mandate does not allow recording", () => {
    const decision = evaluateStewardAction(
      activeMandate({ recordingAllowed: false }),
      actionRequest({ action: "answer_inbound_call", channel: "voice", requiresRecording: true }),
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.failedRules).toContain("rule_recording_not_permitted");
  });

  it("never returns a decision without the audit duty attached", () => {
    const allow = evaluateStewardAction(activeMandate(), actionRequest());
    const deny = evaluateStewardAction(activeMandate({ channels: [] }), actionRequest());
    for (const decision of [allow, deny]) {
      expect(decision.obligations).toContain("audit_record");
      expect(decision.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("Phase 10 — the autonomy ladder decides act, ask, or step aside", () => {
  it("keeps an OBSERVE steward watching and reporting, never acting", () => {
    const decision = evaluateStewardAction(activeMandate({ autonomy: "OBSERVE" }), actionRequest());
    expect(decision.decision).toBe("DENY");
    expect(decision.failedRules).toContain("rule_autonomy_observe");
  });

  it("holds a DRAFT steward's message for a human to approve", () => {
    const decision = evaluateStewardAction(
      activeMandate({ autonomy: "DRAFT" }),
      actionRequest({ action: "send_message" }),
    );
    expect(decision.decision).toBe("REQUIRE_APPROVAL");
    expect(decision.failedRules).toContain("rule_autonomy_draft");
    expect(decision.obligations).toContain("queue_for_approval");
  });

  it("routes an inbound call to a human when autonomy is below AUTONOMOUS", () => {
    const decision = evaluateStewardAction(
      activeMandate({ autonomy: "DRAFT" }),
      actionRequest({ action: "answer_inbound_call", channel: "voice" }),
    );
    expect(decision.decision).toBe("ESCALATE");
    expect(decision.failedRules).toContain("rule_autonomy_inbound");
    expect(decision.obligations).toContain("route_to_queue");
  });

  it("asks before calling out when autonomy is below AUTONOMOUS", () => {
    const decision = evaluateStewardAction(
      activeMandate({ autonomy: "APPROVAL_REQUIRED" }),
      actionRequest({ action: "place_outbound_call", channel: "voice" }),
    );
    expect(decision.decision).toBe("REQUIRE_APPROVAL");
    expect(decision.failedRules).toContain("rule_autonomy_outbound");
  });

  it("lets AUTONOMOUS act, APPROVAL_REQUIRED ask, and DRAFT only draft", () => {
    const autonomous = evaluateStewardAction(
      activeMandate({ autonomy: "AUTONOMOUS" }),
      actionRequest({ action: "send_message" }),
    );
    expect(autonomous.decision).toBe("ALLOW");

    const approved = evaluateStewardAction(
      activeMandate({ autonomy: "APPROVAL_REQUIRED" }),
      actionRequest({ action: "send_message" }),
    );
    expect(approved.decision).toBe("REQUIRE_APPROVAL");
    expect(approved.failedRules).toContain("rule_pre_approval_required");
    expect(approved.obligations).toContain("queue_for_approval");

    const drafted = evaluateStewardAction(
      activeMandate({ autonomy: "DRAFT" }),
      actionRequest({ action: "send_message" }),
    );
    expect(drafted.decision).toBe("REQUIRE_APPROVAL");
    expect(drafted.failedRules).toContain("rule_autonomy_draft");
  });

  it("lets a DRAFT steward do exactly one thing alone: report its own presence", () => {
    const presence = evaluateStewardAction(
      activeMandate({ autonomy: "DRAFT" }),
      actionRequest({ action: "update_presence", channel: "presence", audience: "staff" }),
    );
    expect(presence.decision).toBe("ALLOW");

    const publishing = evaluateStewardAction(
      activeMandate({ autonomy: "DRAFT" }),
      actionRequest({ action: "publish_social", channel: "social", purpose: "service" }),
    );
    expect(publishing.decision).toBe("REQUIRE_APPROVAL");
    expect(publishing.failedRules).toContain("rule_autonomy_draft");
  });
});

describe("Phase 10 — mass and sensitive communication are always witnessed", () => {
  it("requires human approval for a mass send at every autonomy level", () => {
    for (const autonomy of STEWARD_AUTONOMY_LEVELS) {
      const decision = evaluateStewardAction(
        activeMandate({ autonomy }),
        actionRequest({ mass: true, purpose: "service" }),
      );
      expect(decision.decision, `mass send at ${autonomy} must not be automatic`).not.toBe("ALLOW");
    }
  });

  it("requires approval for a mass send even at AUTONOMOUS, and asks for a preview", () => {
    const decision = evaluateStewardAction(
      activeMandate({ autonomy: "AUTONOMOUS" }),
      actionRequest({ mass: true, purpose: "service" }),
    );
    expect(decision.decision).toBe("REQUIRE_APPROVAL");
    expect(decision.failedRules).toContain("rule_mass_approval");
    expect(decision.obligations).toContain("estimate_recipients");
    expect(decision.obligations).toContain("preview_required");
  });

  it("requires approval for a confidential or restricted message", () => {
    const confidential = evaluateStewardAction(
      activeMandate(),
      actionRequest({ classification: "CONFIDENTIAL" }),
    );
    expect(confidential.decision).toBe("REQUIRE_APPROVAL");
    expect(confidential.failedRules).toContain("rule_sensitive_classification");

    const restricted = evaluateStewardAction(
      activeMandate(),
      actionRequest({ classification: "RESTRICTED" }),
    );
    expect(restricted.decision).toBe("REQUIRE_APPROVAL");
  });

  it("states a steward's authority in one line, including what it was denied", () => {
    const summary = mandateSummary(activeMandate());
    expect(summary).toContain("Riverside Institute");
    expect(summary).toContain("tenant-1");
    expect(summary).toContain("autonomy AUTONOMOUS");
    expect(summary).toContain("channels voice, sms");

    const empty = mandateSummary(
      activeMandate({ channels: [], audiences: [], jurisdictions: [], languages: [] }),
    );
    expect(empty).toContain("channels none");
    expect(empty).toContain("audiences none");
    expect(empty).toContain("jurisdictions none");
    expect(empty).toContain("languages none");
  });
});
