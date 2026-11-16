import type { CategoryWorkspaceSpec } from "./category-workspace";

/**
 * M009 Stage B-4: Student, Parent and Family workspace.
 *
 * Two separate views so the relationship is never blurred:
 * - guardian view: children the caller is actually linked to (children.view);
 * - learner view: the caller's own records (self.view_own).
 *
 * Each view forbids the other's keys, so an adult student never inherits
 * parental supervision items and a guardian never sees learner self-service
 * items, even if a manifest ever held both. Consent and guardian relationship
 * checks (M09) stay server-side and fail closed; nothing here relaxes them.
 */
const GUARDIAN_KEYS = ["w.children_summary", "w.child_fees", "w.child_bus", "a.pay_fees"] as const;
const LEARNER_KEYS = [
  "w.my_timetable",
  "w.my_results",
  "w.my_cbt",
  "w.ai_tutor",
  "a.ask_tutor",
] as const;

export const GUARDIAN_FAMILY_WORKSPACE: CategoryWorkspaceSpec = {
  id: "family-guardian",
  title: "Your children",
  summary: "Information about children you are verified as responsible for.",
  families: ["parent"],
  queueKeys: ["w.children_summary", "w.child_fees", "w.child_bus"],
  actionKeys: ["a.pay_fees"],
  restricted: {
    "w.children_summary": "children.view",
    "w.child_fees": "children.view",
    "w.child_bus": "children.view",
    "a.pay_fees": "children.view",
  },
  forbiddenKeys: LEARNER_KEYS,
};

export const LEARNER_WORKSPACE: CategoryWorkspaceSpec = {
  id: "learner-self",
  title: "Your learning",
  summary: "Your own timetable, results and tests.",
  families: ["student"],
  queueKeys: ["w.my_timetable", "w.my_results", "w.my_cbt"],
  actionKeys: ["a.ask_tutor"],
  restricted: {
    "w.my_timetable": "self.view_own",
    "w.my_results": "self.view_own",
    "w.my_cbt": "self.view_own",
  },
  forbiddenKeys: GUARDIAN_KEYS,
};
