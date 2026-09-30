/**
 * CoreGrid Scholar — Phase 10 Communication Platform unit tests
 * (communication-templates).
 *
 * Validates:
 * - Template creation, approval, activation (AG, AH).
 * - Template rendering security: escaping, undeclared variables,
 *   unauthorized system variables (AI).
 * - Notification preferences and mandatory suppression controls (AD).
 * - Tenant-aware subscriptions (AE).
 * - Digest priority preservation (AF).
 * - Communication scheduling constraints (BP, BQ).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createCommunicationTemplate,
  approveCommunicationTemplate,
  activateTemplate,
  renderTemplate,
  upsertNotificationPreference,
  canSuppressPreference,
  subscribe,
  isSubscribed,
  buildDigest,
  createCommunicationSchedule,
  cancelCommunicationSchedule,
  isScheduleExpired,
  type CommunicationTemplate,
} from "@/lib/communication-templates";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";
const FUTURE = "2026-01-02T00:00:00Z";

function makeTemplate(overrides: Partial<CommunicationTemplate> = {}): CommunicationTemplate {
  const created = createCommunicationTemplate({
    id: "tpl-1",
    tenantId: TENANT_A,
    name: "Assignment feedback",
    subjectTemplate: "Feedback for {{course}}",
    bodyTemplate: "Dear {{student}}, feedback is ready for {{course}}.",
    variables: ["course", "student"],
    locale: "en",
    creatorId: "teacher-1",
    now: NOW,
  });
  if (!created.ok) throw new Error("fixture failed");
  return { ...created.template, ...overrides };
}

describe("Template lifecycle (AG, AH)", () => {
  it("creates a draft template", () => {
    const template = makeTemplate();
    expect(template.status).toBe("draft");
    expect(template.version).toBe(1);
  });

  it("rejects an empty template name", () => {
    const result = createCommunicationTemplate({
      id: "tpl-2",
      tenantId: TENANT_A,
      name: "",
      subjectTemplate: "x",
      bodyTemplate: "",
      variables: [],
      locale: "en",
      creatorId: "teacher-1",
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("approves a draft template with an attributable reviewer", () => {
    const approved = approveCommunicationTemplate(makeTemplate(), "reviewer-1", NOW);
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      expect(approved.template.status).toBe("approved");
      expect(approved.template.reviewerId).toBe("reviewer-1");
    }
  });

  it("rejects approval without a reviewer (AH)", () => {
    const result = approveCommunicationTemplate(makeTemplate(), "", NOW);
    expect(result.ok).toBe(false);
  });

  it("activates only approved templates", () => {
    expect(activateTemplate(makeTemplate({ status: "approved" }), NOW).ok).toBe(true);
    expect(activateTemplate(makeTemplate({ status: "draft" }), NOW).ok).toBe(false);
  });
});

describe("renderTemplate security (AI)", () => {
  it("renders declared variables with HTML escaping", () => {
    const result = renderTemplate(makeTemplate(), {
      course: "Math <script>alert(1)</script>",
      student: "Ada",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toContain("&lt;script&gt;");
      expect(result.body).not.toContain("<script>");
    }
  });

  it("leaves undeclared variables untouched and never evaluates them", () => {
    const result = renderTemplate(makeTemplate(), { course: "Math" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).toContain("{{student}}");
    }
  });

  it("rejects unauthorized system variables", () => {
    const template = makeTemplate({ variables: ["process.env"] });
    const result = renderTemplate(template, { "process.env": "x" });
    expect(result.ok).toBe(false);
  });
});

describe("Notification preferences (AD)", () => {
  it("creates a preference with quiet hours and language", () => {
    const result = upsertNotificationPreference({
      recipientId: "user-1",
      tenantId: TENANT_A,
      category: "academic",
      channel: "push",
      frequency: "digest_daily",
      quietHoursStart: "21:00",
      quietHoursEnd: "07:00",
      language: "fr",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preference.language).toBe("fr");
      expect(result.preference.mandatory).toBe(false);
    }
  });

  it("rejects a partial quiet-hours range", () => {
    const result = upsertNotificationPreference({
      recipientId: "user-1",
      tenantId: TENANT_A,
      category: "academic",
      channel: "push",
      frequency: "immediate",
      quietHoursStart: "21:00",
    });
    expect(result.ok).toBe(false);
  });

  it("never allows suppression of mandatory communications (AD)", () => {
    const optional = upsertNotificationPreference({
      recipientId: "user-1",
      tenantId: TENANT_A,
      category: "academic",
      channel: "push",
      frequency: "suppressed",
    });
    if (!optional.ok) throw new Error("fixture failed");
    expect(canSuppressPreference(optional.preference)).toBe(true);

    const mandatory = upsertNotificationPreference({
      recipientId: "user-1",
      tenantId: TENANT_A,
      category: "emergency",
      channel: "push",
      frequency: "immediate",
      mandatory: true,
    });
    if (!mandatory.ok) throw new Error("fixture failed");
    expect(canSuppressPreference(mandatory.preference)).toBe(false);
  });
});

describe("Subscriptions (AE)", () => {
  it("subscribes and checks tenant-aware membership", () => {
    const subscription = subscribe("user-1", TENANT_A, "announcement", "ann-1", NOW);
    expect(isSubscribed([subscription], "user-1", TENANT_A, "announcement", "ann-1")).toBe(true);
    expect(
      isSubscribed([subscription], "user-1", tenantId("tenant-b"), "announcement", "ann-1"),
    ).toBe(false);
  });
});

describe("buildDigest (AF)", () => {
  it("surfaces critical entries first and never hides them", () => {
    const digest = buildDigest(
      "user-1",
      TENANT_A,
      "daily",
      [
        { id: "m1", priority: 1, subject: "normal", content: "c" },
        { id: "m2", priority: 4, subject: "critical", content: "c" },
      ],
      NOW,
      false,
    );
    expect(digest.entries[0].id).toBe("m2");
    expect(digest.criticalExcluded).toEqual([]);
  });

  it("separately reports excluded critical entries when requested", () => {
    const digest = buildDigest(
      "user-1",
      TENANT_A,
      "daily",
      [{ id: "m2", priority: 4, subject: "critical", content: "c" }],
      NOW,
      true,
    );
    expect(digest.criticalExcluded).toEqual(["m2"]);
  });
});

describe("Communication scheduling (BP, BQ)", () => {
  it("creates a future-dated schedule with timezone and auth context", () => {
    const result = createCommunicationSchedule({
      id: "sched-1",
      tenantId: TENANT_A,
      executionTime: FUTURE,
      timezone: "Africa/Lagos",
      creatorId: "admin-1",
      authorizationContext: "announcement:publish",
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects past execution times, missing timezone, missing auth context (BP, BQ)", () => {
    expect(
      createCommunicationSchedule({
        id: "s1",
        tenantId: TENANT_A,
        executionTime: "2025-12-01T00:00:00Z",
        timezone: "UTC",
        creatorId: "a",
        authorizationContext: "x",
        now: NOW,
      }).ok,
    ).toBe(false);
    expect(
      createCommunicationSchedule({
        id: "s2",
        tenantId: TENANT_A,
        executionTime: FUTURE,
        timezone: "",
        creatorId: "a",
        authorizationContext: "x",
        now: NOW,
      }).ok,
    ).toBe(false);
    expect(
      createCommunicationSchedule({
        id: "s3",
        tenantId: TENANT_A,
        executionTime: FUTURE,
        timezone: "UTC",
        creatorId: "a",
        authorizationContext: "",
        now: NOW,
      }).ok,
    ).toBe(false);
  });

  it("cancels a scheduled communication but not an executed one", () => {
    const created = createCommunicationSchedule({
      id: "sched-1",
      tenantId: TENANT_A,
      executionTime: FUTURE,
      timezone: "UTC",
      creatorId: "admin-1",
      authorizationContext: "x",
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    expect(cancelCommunicationSchedule(created.schedule).ok).toBe(true);
    const executed = { ...created.schedule, state: "executed" as const };
    expect(cancelCommunicationSchedule(executed).ok).toBe(false);
  });

  it("detects schedule expiration", () => {
    const created = createCommunicationSchedule({
      id: "sched-1",
      tenantId: TENANT_A,
      executionTime: FUTURE,
      timezone: "UTC",
      expiresAt: "2026-01-02T00:00:00Z",
      creatorId: "admin-1",
      authorizationContext: "x",
      now: NOW,
    });
    if (!created.ok) throw new Error("fixture failed");
    expect(isScheduleExpired(created.schedule, "2026-01-03T00:00:00Z")).toBe(true);
  });
});
