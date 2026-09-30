/**
 * CoreGrid Scholar — AI operations adapter (Phase 26 consumption, R-23).
 *
 * Scholar CONSUMES the domain-neutral Phase-26 AI governance: Scholar
 * supplies ONLY its operation traits (impact, autonomy, data classification);
 * the kernel `classifyAiRisk`, `evaluateHighRiskGate` and `shouldEscalate`
 * own the rules. Unknown operation kinds fail closed (never defaulted).
 */
import { classifyAiRisk, evaluateHighRiskGate, shouldEscalate } from "@/lib/ai-governance";
import type { AiRiskLevel } from "@/lib/ai-core";

export type ScholarAiOperationKind =
  | "lesson_plan_draft"
  | "grade_summary"
  | "discipline_summary"
  | "admission_decision_support"
  | "exam_security_insight"
  | "financial_budget_proposal"
  | "lockdown_recommendation";

type RiskProfile = {
  impact: "informational" | "operational" | "financial" | "safety" | "privacy";
  autonomy: "advisory" | "assisted" | "autonomous" | "irreversible";
  dataClassification: "PUBLIC" | "TENANT_INTERNAL" | "CONFIDENTIAL" | "SENSITIVE" | "RESTRICTED";
};

/** Scholar operation traits (data only — rules stay in the kernel). */
export const SCHOLAR_AI_OPERATION_PROFILES: Readonly<Record<ScholarAiOperationKind, RiskProfile>> =
  {
    lesson_plan_draft: {
      impact: "informational",
      autonomy: "advisory",
      dataClassification: "TENANT_INTERNAL",
    },
    grade_summary: {
      impact: "operational",
      autonomy: "assisted",
      dataClassification: "CONFIDENTIAL",
    },
    discipline_summary: {
      impact: "operational",
      autonomy: "assisted",
      dataClassification: "SENSITIVE",
    },
    admission_decision_support: {
      impact: "privacy",
      autonomy: "assisted",
      dataClassification: "SENSITIVE",
    },
    exam_security_insight: {
      impact: "safety",
      autonomy: "advisory",
      dataClassification: "CONFIDENTIAL",
    },
    financial_budget_proposal: {
      impact: "financial",
      autonomy: "autonomous",
      dataClassification: "TENANT_INTERNAL",
    },
    lockdown_recommendation: {
      impact: "safety",
      autonomy: "irreversible",
      dataClassification: "RESTRICTED",
    },
  };

/** Kernel risk classification; null (fail closed) for unknown kinds. */
export function scholarAiRisk(kind: string): AiRiskLevel | null {
  const profile = SCHOLAR_AI_OPERATION_PROFILES[kind as ScholarAiOperationKind];
  return profile ? classifyAiRisk(profile) : null;
}

export interface ScholarAiGateInput {
  kind: string;
  humanApproval: boolean;
  multiModelVerified: boolean;
}

/** High-risk gate decision for a Scholar operation (kernel-owned rule). */
export function scholarAiOperationGate(input: ScholarAiGateInput): {
  allowed: boolean;
  requiresApproval: boolean;
  risk: AiRiskLevel | null;
} {
  const risk = scholarAiRisk(input.kind);
  if (!risk) return { allowed: false, requiresApproval: false, risk: null };
  const gate = evaluateHighRiskGate({
    riskLevel: risk,
    humanApproval: input.humanApproval,
    multiModelVerified: input.multiModelVerified,
  });
  return { ...gate, risk };
}

/** Escalation check for a Scholar operation (kernel-owned rule). */
export function scholarAiShouldEscalate(input: {
  kind: string;
  confidence: number;
  evidenceConflict: boolean;
  authorizationAmbiguous: boolean;
  policyUnclear: boolean;
}): boolean {
  const risk = scholarAiRisk(input.kind);
  if (!risk) return true; // unknown kind escalates (fail closed)
  return shouldEscalate({ riskLevel: risk, ...input });
}
