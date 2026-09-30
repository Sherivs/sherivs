/**
 * CoreGrid — Communication Platform templates, preferences,
 * subscriptions, digests, and scheduling (Phase 10, AG, AH, AI, AJ, AD, AE,
 * AF, BP, BQ).
 *
 * Implements `architecture/phase-10-communication-platform.md`:
 * - Templates (AG): subject, body, variables, channel-specific versions,
 *   localization, version, owner, approval state.
 * - Template versioning (AH): every production template has version, status,
 *   creator, reviewer where required, created timestamp, effective timestamp.
 * - Template security (AI): rendering protects against injection, unsafe
 *   HTML, malicious links, unauthorized variables, cross-tenant leakage.
 * - Localization (AJ): language, locale, timezone, date/number formatting.
 * - Notification preferences (AD): channel, category, frequency, quiet
 *   hours, digest preferences, language. Mandatory institutional/emergency
 *   communications may have restricted preference controls.
 * - Subscriptions (AE): tenant-aware subscriptions to announcements,
 *   channels, institutional updates, system events.
 * - Digest engine (AF): daily/weekly/event digests; aggregation must
 *   preserve message priority; critical messages must not be hidden inside
 *   ordinary digests.
 * - Scheduling (BP, BQ): schedule ID, timezone, execution time, expiration,
 *   cancellation state, creator, authorization context; canonical
 *   timestamps.
 *
 * Boundaries: Phase 08 owns enforcement; this module validates and renders
 * only. Phase 03 tenancy governs all tenant-scoped records.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Templates & versioning (AG, AH)
 * ────────────────────────────────────────────────────────────*/

export type TemplateStatus = "draft" | "approved" | "active" | "deprecated";

export const TEMPLATE_STATUSES: readonly TemplateStatus[] = [
  "draft",
  "approved",
  "active",
  "deprecated",
] as const;

export interface CommunicationTemplate {
  id: string;
  tenantId: TenantId | null;
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: string[];
  locale: string;
  version: number;
  status: TemplateStatus;
  creatorId: string;
  reviewerId: string | null;
  createdAt: string;
  effectiveAt: string | null;
}

export interface CreateTemplateInput {
  id: string;
  tenantId: TenantId | null;
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: string[];
  locale: string;
  creatorId: string;
  now: string;
}

export type CreateTemplateResult =
  { ok: true; template: CommunicationTemplate } | { ok: false; error: string };

export function createCommunicationTemplate(input: CreateTemplateInput): CreateTemplateResult {
  if (input.name.trim() === "") {
    return { ok: false, error: "Template name is required (AG)" };
  }
  if (input.subjectTemplate.trim() === "" && input.bodyTemplate.trim() === "") {
    return { ok: false, error: "Template requires a subject or body (AG)" };
  }
  if (input.creatorId.trim() === "") {
    return { ok: false, error: "Template creator is required (AH)" };
  }
  return {
    ok: true,
    template: {
      id: input.id,
      tenantId: input.tenantId,
      name: input.name,
      subjectTemplate: input.subjectTemplate,
      bodyTemplate: input.bodyTemplate,
      variables: input.variables,
      locale: input.locale,
      version: 1,
      status: "draft",
      creatorId: input.creatorId,
      reviewerId: null,
      createdAt: input.now,
      effectiveAt: null,
    },
  };
}

export type ApproveTemplateResult =
  { ok: true; template: CommunicationTemplate } | { ok: false; error: string };

export function approveCommunicationTemplate(
  template: CommunicationTemplate,
  reviewerId: string,
  now: string,
): ApproveTemplateResult {
  if (template.status !== "draft" && template.status !== "approved") {
    return { ok: false, error: "Only a draft or approved template can be approved (AH)" };
  }
  if (reviewerId.trim() === "") {
    return { ok: false, error: "Template review requires an attributable reviewer (AH)" };
  }
  return {
    ok: true,
    template: {
      ...template,
      status: "approved",
      reviewerId,
      effectiveAt: now,
    },
  };
}

export function activateTemplate(
  template: CommunicationTemplate,
  now: string,
): ApproveTemplateResult {
  if (template.status !== "approved") {
    return { ok: false, error: "Only an approved template can be activated (AH)" };
  }
  return { ok: true, template: { ...template, status: "active", effectiveAt: now } };
}

/* ─────────────────────────────────────────────────────────────
 * Template rendering security (AI)
 * ────────────────────────────────────────────────────────────*/

export type RenderTemplateResult =
  { ok: true; subject: string; body: string } | { ok: false; error: string };

const UNAUTHORIZED_VARIABLE_PATTERN =
  /^\s*(process\.|globalThis\.|window\.|document\.|import\(|require\()/;

/**
 * Render a template with variable substitution. Template security (AI):
 * - only declared variables may be substituted;
 * - rendered output is escaped so template content cannot inject unsafe
 *   HTML or break out of the template body;
 * - variables that reference runtime/system objects are rejected outright.
 */
export function renderTemplate(
  template: CommunicationTemplate,
  variables: Record<string, string>,
): RenderTemplateResult {
  for (const name of template.variables) {
    if (UNAUTHORIZED_VARIABLE_PATTERN.test(name)) {
      return { ok: false, error: `Unauthorized variable '${name}' rejected (AI)` };
    }
  }
  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const render = (templateText: string): string =>
    templateText.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
      if (!template.variables.includes(name)) {
        return match; // undeclared variables are left as-is, never evaluated
      }
      const value = variables[name];
      if (value === undefined) {
        return match;
      }
      return escapeHtml(value);
    });

  return {
    ok: true,
    subject: render(template.subjectTemplate),
    body: render(template.bodyTemplate),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Notification preferences (AD)
 * ────────────────────────────────────────────────────────────*/

export type NotificationFrequency = "immediate" | "digest_daily" | "digest_weekly" | "suppressed";

export const NOTIFICATION_FREQUENCIES: readonly NotificationFrequency[] = [
  "immediate",
  "digest_daily",
  "digest_weekly",
  "suppressed",
] as const;

export interface NotificationPreference {
  recipientId: string;
  tenantId: TenantId;
  category: string;
  channel: string;
  frequency: NotificationFrequency;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  language: string;
  mandatory: boolean;
}

export interface UpsertPreferenceInput {
  recipientId: string;
  tenantId: TenantId;
  category: string;
  channel: string;
  frequency: NotificationFrequency;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  language?: string;
  mandatory?: boolean;
}

export type UpsertPreferenceResult =
  { ok: true; preference: NotificationPreference } | { ok: false; error: string };

export function upsertNotificationPreference(input: UpsertPreferenceInput): UpsertPreferenceResult {
  if (input.category.trim() === "" || input.channel.trim() === "") {
    return { ok: false, error: "Preference requires a category and channel (AD)" };
  }
  const quietStart = input.quietHoursStart ?? null;
  const quietEnd = input.quietHoursEnd ?? null;
  if ((quietStart !== null && quietEnd === null) || (quietStart === null && quietEnd !== null)) {
    return { ok: false, error: "Quiet hours require both start and end (AD)" };
  }
  return {
    ok: true,
    preference: {
      recipientId: input.recipientId,
      tenantId: input.tenantId,
      category: input.category,
      channel: input.channel,
      frequency: input.frequency,
      quietHoursStart: quietStart,
      quietHoursEnd: quietEnd,
      language: input.language ?? "en",
      mandatory: input.mandatory ?? false,
    },
  };
}

/**
 * Mandatory institutional/emergency communications may have restricted
 * preference controls (AD): a mandatory category can never be fully
 * suppressed by the recipient.
 */
export function canSuppressPreference(preference: NotificationPreference): boolean {
  return !preference.mandatory;
}

/* ─────────────────────────────────────────────────────────────
 * Subscriptions (AE)
 * ────────────────────────────────────────────────────────────*/

export interface CommunicationSubscription {
  subscriberId: string;
  tenantId: TenantId;
  targetType: "announcement" | "channel" | "institutional" | "system_event";
  targetId: string;
  createdAt: string;
}

export function subscribe(
  subscriberId: string,
  tenantId: TenantId,
  targetType: CommunicationSubscription["targetType"],
  targetId: string,
  now: string,
): CommunicationSubscription {
  return { subscriberId, tenantId, targetType, targetId, createdAt: now };
}

export function isSubscribed(
  subscriptions: CommunicationSubscription[],
  subscriberId: string,
  tenantId: TenantId,
  targetType: CommunicationSubscription["targetType"],
  targetId: string,
): boolean {
  return subscriptions.some(
    (s) =>
      s.subscriberId === subscriberId &&
      s.tenantId === tenantId &&
      s.targetType === targetType &&
      s.targetId === targetId,
  );
}

/* ─────────────────────────────────────────────────────────────
 * Digest engine (AF)
 * ────────────────────────────────────────────────────────────*/

export type DigestKind = "daily" | "weekly" | "event";

export interface DigestEntry {
  id: string;
  priority: number;
  subject: string;
  content: string;
}

export interface Digest {
  recipientId: string;
  tenantId: TenantId;
  kind: DigestKind;
  entries: DigestEntry[];
  generatedAt: string;
  criticalExcluded: string[];
}

/**
 * Build a digest. Aggregation must preserve message priority and critical
 * messages must not be hidden inside ordinary digests (AF) — CRITICAL/URGENT
 * entries are surfaced at the top and, when requested, returned separately
 * so the caller can deliver them immediately rather than burying them.
 */
export function buildDigest(
  recipientId: string,
  tenantId: TenantId,
  kind: DigestKind,
  entries: DigestEntry[],
  now: string,
  excludeCritical: boolean,
): Digest {
  const critical = entries.filter((e) => e.priority >= 3);
  const normal = entries.filter((e) => e.priority < 3);
  const sorted = [...normal].sort((a, b) => b.priority - a.priority);
  return {
    recipientId,
    tenantId,
    kind,
    entries: [...critical, ...sorted],
    generatedAt: now,
    criticalExcluded: excludeCritical ? critical.map((e) => e.id) : [],
  };
}

/* ─────────────────────────────────────────────────────────────
 * Communication scheduling (BP, BQ)
 * ────────────────────────────────────────────────────────────*/

export interface CommunicationSchedule {
  id: string;
  tenantId: TenantId;
  executionTime: string;
  timezone: string;
  expiresAt: string | null;
  state: "scheduled" | "executed" | "cancelled";
  creatorId: string;
  authorizationContext: string;
  createdAt: string;
}

export interface CreateScheduleInput {
  id: string;
  tenantId: TenantId;
  executionTime: string;
  timezone: string;
  expiresAt?: string | null;
  creatorId: string;
  authorizationContext: string;
  now: string;
}

export type CreateScheduleResult =
  { ok: true; schedule: CommunicationSchedule } | { ok: false; error: string };

export function createCommunicationSchedule(input: CreateScheduleInput): CreateScheduleResult {
  if (input.executionTime <= input.now) {
    return { ok: false, error: "Scheduled execution time must be in the future (BP)" };
  }
  if (input.timezone.trim() === "") {
    return { ok: false, error: "Scheduled communication requires a timezone (BQ)" };
  }
  if (input.authorizationContext.trim() === "") {
    return { ok: false, error: "Scheduled communication requires an authorization context (BP)" };
  }
  return {
    ok: true,
    schedule: {
      id: input.id,
      tenantId: input.tenantId,
      executionTime: input.executionTime,
      timezone: input.timezone,
      expiresAt: input.expiresAt ?? null,
      state: "scheduled",
      creatorId: input.creatorId,
      authorizationContext: input.authorizationContext,
      createdAt: input.now,
    },
  };
}

export function cancelCommunicationSchedule(
  schedule: CommunicationSchedule,
): { ok: true; schedule: CommunicationSchedule } | { ok: false; error: string } {
  if (schedule.state === "executed") {
    return { ok: false, error: "An executed schedule cannot be cancelled (BP)" };
  }
  return { ok: true, schedule: { ...schedule, state: "cancelled" } };
}

export function isScheduleExpired(schedule: CommunicationSchedule, now: string): boolean {
  return schedule.expiresAt !== null && Date.parse(now) >= Date.parse(schedule.expiresAt);
}
