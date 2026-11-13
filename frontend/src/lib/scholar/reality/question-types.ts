/**
 * SV1-REALITY R1 (#332) — discovery question metadata and answer-state
 * semantics (ADR-051). Pure contract: no storage, no AI, no UI.
 */
import type { AnswerState, AnswerType, InstitutionType, RealityDomain } from "./taxonomy";

export type VisibilityOp = "equals" | "in" | "answered";

/** A question is visible only when ALL of its conditions hold. */
export interface VisibilityCondition {
  readonly questionId: string;
  readonly op: VisibilityOp;
  /** Compared with the confirmed answer value; unused for `answered`. */
  readonly value?: string | number | boolean | readonly string[];
}

export interface QuestionValidation {
  readonly min?: number;
  readonly max?: number;
  readonly maxLength?: number;
  readonly options?: readonly string[];
  readonly minItems?: number;
  readonly maxItems?: number;
}

export interface ConfigMapping {
  /** Namespaced path inside the existing `scholar.institution.operating_model` attributes. */
  readonly path: string;
  /** Taxonomy entity type whose existing owner persists the value. */
  readonly entityType: string;
}

/** `confirmed`: only a human-confirmed answer satisfies; `inferred_ok`: an inference may satisfy a non-activation gate. */
export type ConfidenceRequirement = "confirmed" | "inferred_ok";

/**
 * Metadata only: marks which APPROVED answers may later feed the public
 * website. Default is not public. The website stays a presentation layer and
 * never a source of truth; no generation runtime exists in R1.
 */
export interface WebsiteMapping {
  readonly publicSafe: boolean;
  /** Public-site field key; required when publicSafe. */
  readonly field?: string;
}

export interface DiscoveryQuestion {
  readonly id: string;
  readonly pack: string;
  readonly domain: RealityDomain;
  readonly institutionTypes: readonly InstitutionType[];
  readonly prompt: string;
  readonly answerType: AnswerType;
  readonly visibleWhen: readonly VisibilityCondition[];
  readonly required: boolean;
  /** Needed before activation; otherwise it can be configured later. */
  readonly requiredToActivate: boolean;
  readonly dependsOn: readonly string[];
  readonly validation: QuestionValidation;
  readonly followUps: readonly string[];
  readonly configMapping: ConfigMapping;
  readonly confidence: ConfidenceRequirement;
  readonly allowNotApplicable: boolean;
  readonly websiteMapping: WebsiteMapping;
}

export type AnswerSource = "human" | "ai" | "system";
export type AnswerValue = string | number | boolean | readonly string[] | readonly unknown[] | null;

export interface DiscoveryAnswer {
  readonly questionId: string;
  readonly state: AnswerState;
  readonly value?: AnswerValue;
  readonly source: AnswerSource;
  /** Required for `conflicting`: the competing candidate values (>= 2). */
  readonly candidates?: readonly AnswerValue[];
  readonly evidenceRef?: string;
}

export interface QuestionIssue {
  readonly code: string;
  readonly questionId?: string;
  readonly message: string;
}
