/**
 * COMMS-02 — one calling agent per Professional or Enterprise organization.
 *
 * The commercial fact lives in tier-entitlements. The actor decision uses the
 * same feature gate as getMyFeatureAccess. SQL remains the enforcement layer.
 * AI output is a proposal: spoken text must stay inside the server fact packet.
 */

import { decideFeatureAccess, type FeatureGateDecision } from "@/lib/scholar/feature-gate";
import { EDUCATION_REALITY_ROLES } from "@/lib/scholar/roles/role-registry";
import { tenantId } from "@/lib/tenant-core";
import {
  schoolCallingAgentEntitlement,
  type SchoolCallingAgentEntitlement,
} from "@/lib/payments/tier-entitlements";

export const SCHOOL_CALLING_AGENT_CODE = "r001.communications.school-calling-agent";
export const SCHOOL_CALLING_CAPABILITY = "communication-messaging";
export const SCHOOL_CALLING_CONTEXT_MARKER = "[[comms02-school-calling-context]]";

export type SchoolCallingTopic = "fees" | "results" | "admissions" | "timetable";
export type SchoolCallingIntent = SchoolCallingTopic | "unknown" | "escalate";

export interface SchoolCallingFacts {
  tenantRef: string;
  verified: boolean;
  fees: { openCount: number; openAmount: string } | null;
  results: ReadonlyArray<{ label: string; score: string; period: string }>;
  admissions: ReadonlyArray<{ reference: string; active: boolean }>;
  timetable: ReadonlyArray<{ day: string; period: number; label: string }>;
}

export const EMPTY_SCHOOL_CALLING_FACTS: SchoolCallingFacts = {
  tenantRef: "",
  verified: false,
  fees: null,
  results: [],
  admissions: [],
  timetable: [],
};

const TOPIC_PATTERNS: ReadonlyArray<[SchoolCallingTopic, RegExp]> = [
  ["fees", /\b(fee|fees|balance|invoice|payment|owing|owe)\b/i],
  ["results", /\b(result|results|score|scores|report card)\b/i],
  ["admissions", /\b(admission|admissions|enrol|enroll|application)\b/i],
  ["timetable", /\b(timetable|schedule|period|lesson time)\b/i],
];

export function proposeSchoolIntent(transcript: string): SchoolCallingIntent {
  if (
    /\b(?:human(?:\s+agent)?|real person|representative|speak to (?:a person|someone)|talk to (?:a person|someone))\b/i.test(
      transcript,
    )
  ) {
    return "escalate";
  }
  const matched = TOPIC_PATTERNS.filter(([, pattern]) => pattern.test(transcript)).map(
    ([topic]) => topic,
  );
  if (matched.length !== 1) return "unknown";
  return matched[0] ?? "unknown";
}

export function groundedSchoolAnswer(
  intent: SchoolCallingIntent,
  facts: SchoolCallingFacts,
): { speak: string; escalate: boolean } {
  const handoff =
    "I cannot confirm that from this organization's records. I will connect you with support.";
  if (!facts.verified || intent === "unknown" || intent === "escalate") {
    return { speak: handoff, escalate: true };
  }
  if (intent === "fees") {
    if (!facts.fees) return { speak: handoff, escalate: true };
    return {
      speak: `There are ${facts.fees.openCount} open fee items totaling ${facts.fees.openAmount}.`,
      escalate: false,
    };
  }
  if (intent === "results") {
    if (facts.results.length === 0) return { speak: handoff, escalate: true };
    const lines = facts.results
      .slice(0, 5)
      .map((row) => `${row.label} ${row.score} for ${row.period}`)
      .join(". ");
    return { speak: `Published results: ${lines}.`, escalate: false };
  }
  if (intent === "admissions") {
    if (facts.admissions.length === 0) return { speak: handoff, escalate: true };
    const lines = facts.admissions
      .slice(0, 3)
      .map((row) => `${row.reference} is ${row.active ? "active" : "inactive"}`)
      .join(". ");
    return { speak: `Admission reference ${lines}.`, escalate: false };
  }
  if (facts.timetable.length === 0) return { speak: handoff, escalate: true };
  const lines = facts.timetable
    .slice(0, 8)
    .map((row) => `${row.label} on ${row.day}, period ${row.period}`)
    .join(". ");
  return { speak: `Published schedule: ${lines}.`, escalate: false };
}

function sentences(value: string): string[] {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * An organization line speaks the grounded answer word for word.
 * A proposal is kept only when every one of its sentences is already a
 * sentence of that answer. Anything else, including an injected instruction,
 * is discarded.
 */
export function selectSchoolCallingSpeech(proposal: string, grounded: string): string {
  const proposed = sentences(proposal);
  const allowed = new Set(sentences(grounded));
  if (proposed.length === 0 || !proposed.every((sentence) => allowed.has(sentence))) {
    return grounded;
  }
  return proposed.join(" ");
}

export function schoolCallingPromptContext(facts: SchoolCallingFacts, question: string): string {
  const packet = JSON.stringify({
    verified: facts.verified,
    fees: facts.fees,
    results: facts.results,
    admissions: facts.admissions,
    timetable: facts.timetable,
  });
  return [
    SCHOOL_CALLING_CONTEXT_MARKER,
    "Verified records for this caller only. Do not add amounts, names, or phone numbers.",
    packet,
    "Caller question:",
    question,
  ].join("\n");
}

const factRow = {
  label: (value: unknown) => (typeof value === "string" ? value.slice(0, 80) : ""),
  score: (value: unknown) => (typeof value === "string" ? value.slice(0, 32) : ""),
  period: (value: unknown) => (typeof value === "string" ? value.slice(0, 32) : ""),
  reference: (value: unknown) => (typeof value === "string" ? value.slice(0, 40) : ""),
  day: (value: unknown) => (typeof value === "string" ? value.slice(0, 20) : ""),
};

export function parseSchoolCallingFacts(
  payload: unknown,
  expectedTenant: string,
): SchoolCallingFacts {
  if (!payload || typeof payload !== "object")
    return { ...EMPTY_SCHOOL_CALLING_FACTS, tenantRef: expectedTenant };
  const row = payload as Record<string, unknown>;
  if (row.tenantRef !== expectedTenant) {
    throw new Error("Voice facts are outside the active organization.");
  }
  const feesRaw = row.fees;
  const fees =
    feesRaw && typeof feesRaw === "object"
      ? {
          openCount: Number((feesRaw as { openCount?: unknown }).openCount),
          openAmount: String((feesRaw as { openAmount?: unknown }).openAmount ?? ""),
        }
      : null;
  const list = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    tenantRef: expectedTenant,
    verified: row.verified === true,
    fees:
      fees && Number.isInteger(fees.openCount) && fees.openCount >= 0 && fees.openAmount.length > 0
        ? fees
        : null,
    results: list(row.results)
      .slice(0, 5)
      .map((item) => {
        const entry = item as Record<string, unknown>;
        return {
          label: factRow.label(entry.label),
          score: factRow.score(entry.score),
          period: factRow.period(entry.period),
        };
      })
      .filter((item) => item.label && item.score),
    admissions: list(row.admissions)
      .slice(0, 3)
      .map((item) => {
        const entry = item as Record<string, unknown>;
        return { reference: factRow.reference(entry.reference), active: entry.active === true };
      })
      .filter((item) => item.reference),
    timetable: list(row.timetable)
      .slice(0, 8)
      .map((item) => {
        const entry = item as Record<string, unknown>;
        return {
          day: factRow.day(entry.day),
          period: Number(entry.period),
          label: factRow.label(entry.label),
        };
      })
      .filter((item) => item.day && item.label && Number.isInteger(item.period)),
  };
}

export interface SchoolCallingAccessInput {
  identityId: string | null;
  tenantRef: string | null;
  roleIds: readonly string[];
  tier: string | null | undefined;
}

export interface SchoolCallingAccess {
  entitlement: SchoolCallingAgentEntitlement | null;
  decision: FeatureGateDecision;
  allowed: boolean;
}

/**
 * Both gates must allow. A paid plan does not grant the capability, and a
 * role grant does not entitle a lower plan.
 */
export function decideSchoolCallingAgentAccess(
  input: SchoolCallingAccessInput,
): SchoolCallingAccess {
  if (!input.identityId || !input.tenantRef || input.tenantRef.trim() === "") {
    const decision = decideFeatureAccess({
      code: SCHOOL_CALLING_AGENT_CODE,
      actor: { identityId: input.identityId, tenantId: input.tenantRef, roleIds: input.roleIds },
    });
    return { entitlement: null, decision, allowed: false };
  }
  const entitlement = schoolCallingAgentEntitlement(tenantId(input.tenantRef), input.tier);
  const roles = EDUCATION_REALITY_ROLES.map((role) =>
    input.roleIds.includes(role.id)
      ? {
          ...role,
          permissions: [...role.permissions, SCHOOL_CALLING_CAPABILITY],
        }
      : role,
  );
  const decision = decideFeatureAccess({
    code: SCHOOL_CALLING_AGENT_CODE,
    actor: {
      identityId: input.identityId,
      tenantId: input.tenantRef,
      roleIds: input.roleIds,
    },
    roles,
    policies: entitlement.entitled
      ? []
      : [
          {
            id: "policy.calling-agent-plan",
            capability: SCHOOL_CALLING_CAPABILITY,
            outcome: "DENY",
            reason: "plan is not Professional or Enterprise",
          },
        ],
  });
  return { entitlement, decision, allowed: entitlement.entitled && decision.enabled };
}
