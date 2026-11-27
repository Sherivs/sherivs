/**
 * AIN-06a: the companion contract. What an AI companion may read, may produce, and must show.
 * No model is called here. A provider-agnostic router (later) must pass every answer through
 * `checkCompanionAnswer` before it reaches a person; AIN-07 evals run the same checker.
 */
import { assistantPersonaForRole } from "./assistant-persona";

export type CompanionAudience = "leader" | "staff" | "teacher" | "learner" | "family" | "platform";

/** What a companion may do with its output. It never acts on its own: drafts go to a human. */
export type CompanionOutput = "answer" | "draft_for_review";

export interface CompanionSpec {
  readonly role: string;
  readonly persona: string;
  readonly audience: CompanionAudience;
  /** Source kinds an answer may cite. Anything else is refused. */
  readonly sources: readonly string[];
  readonly outputs: readonly CompanionOutput[];
  /** Must the answer point to a named human for anything it cannot settle? */
  readonly humanHandoff: boolean;
  /** Aggregate-only roles may never carry a person-level detail. */
  readonly aggregateOnly: boolean;
}

const OFFICIAL = ["official_notice", "school_policy", "published_timetable"] as const;

function spec(
  role: string,
  audience: CompanionAudience,
  sources: readonly string[],
  o: Partial<Pick<CompanionSpec, "outputs" | "humanHandoff" | "aggregateOnly">> = {},
): CompanionSpec {
  return {
    role,
    persona: assistantPersonaForRole(role),
    audience,
    sources,
    outputs: o.outputs ?? ["answer", "draft_for_review"],
    humanHandoff: (o.humanHandoff ?? audience === "family") || audience === "learner",
    aggregateOnly: o.aggregateOnly ?? audience === "platform",
  };
}

export const COMPANIONS: readonly CompanionSpec[] = [
  // AIN-06a: leaders and family. These carry the highest risk of a wrong or leaking answer.
  spec("principal", "leader", [...OFFICIAL, "org_report", "org_record"]),
  spec("head_of_institution", "leader", [...OFFICIAL, "org_report", "org_record"]),
  spec("proprietor", "leader", [...OFFICIAL, "org_report"]),
  spec("parent", "family", [...OFFICIAL, "own_child_record"], { outputs: ["answer"] }),
  spec("student", "learner", [...OFFICIAL, "own_record", "course_material"], {
    outputs: ["answer"],
  }),
  // AIN-06b: classroom and academic staff.
  spec("teacher", "teacher", [...OFFICIAL, "own_class_record", "course_material"]),
  spec("form_teacher", "teacher", [...OFFICIAL, "own_class_record", "course_material"]),
  spec("hod", "teacher", [...OFFICIAL, "own_class_record", "org_report", "course_material"]),
  // AIN-06c: administration and operations.
  spec("admin", "staff", [...OFFICIAL, "org_record", "org_report"]),
  spec("admin_officer", "staff", [...OFFICIAL, "org_record"]),
  spec("bursar", "staff", [...OFFICIAL, "fee_record", "org_report"]),
  spec("librarian", "staff", [...OFFICIAL, "library_record"]),
  spec("nurse", "staff", [...OFFICIAL, "own_clinic_record"], { outputs: ["answer"] }),
  spec("driver", "staff", [...OFFICIAL, "own_route"], { outputs: ["answer"] }),
  spec("support_staff", "staff", [...OFFICIAL]),
  // Platform roles see aggregates only (ADR-142).
  spec("super_admin", "platform", ["aggregate_metric", "platform_runbook"], {
    outputs: ["answer"],
  }),
  spec("support", "platform", ["aggregate_metric", "platform_runbook"], { outputs: ["answer"] }),
];

export function companionForRole(role: string | null | undefined): CompanionSpec | null {
  return COMPANIONS.find((c) => c.role === role) ?? null;
}

export interface CompanionAnswer {
  readonly text: string;
  readonly kind: CompanionOutput;
  readonly citations: readonly { readonly source: string; readonly ref: string }[];
  /** A plain statement of what the answer could not establish. Required. */
  readonly limits: string;
  /** A named person or office to ask. Required when the spec demands a handoff. */
  readonly handoff?: string;
}

export type CompanionFault =
  | "no_companion_for_role"
  | "output_not_allowed"
  | "no_citation"
  | "source_not_allowed"
  | "citation_without_ref"
  | "limits_missing"
  | "handoff_missing"
  | "person_detail_in_aggregate";

/** A person-level detail has no place in an aggregate-only answer: an email, a phone number, a long id. */
const PERSON_DETAIL =
  /[\w.+-]+@[\w-]+\.[\w.]+|(?:\+?234|0)[789]\d{9}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

export function checkCompanionAnswer(
  role: string | null | undefined,
  a: CompanionAnswer,
): CompanionFault[] {
  const c = companionForRole(role);
  if (!c) return ["no_companion_for_role"];
  const faults: CompanionFault[] = [];
  if (!c.outputs.includes(a.kind)) faults.push("output_not_allowed");
  if (a.citations.length === 0) faults.push("no_citation");
  if (a.citations.some((x) => !c.sources.includes(x.source))) faults.push("source_not_allowed");
  if (a.citations.some((x) => x.ref.trim() === "")) faults.push("citation_without_ref");
  if (a.limits.trim() === "") faults.push("limits_missing");
  if (c.humanHandoff && !(a.handoff && a.handoff.trim())) faults.push("handoff_missing");
  if (c.aggregateOnly && PERSON_DETAIL.test(a.text)) faults.push("person_detail_in_aggregate");
  return faults;
}
