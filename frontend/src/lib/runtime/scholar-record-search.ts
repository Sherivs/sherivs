/**
 * Scholar runtime — learner record search published to the platform command palette.
 *
 * The palette offers it only when the member's resolved workspace contains the learner
 * directory. The search itself is a server function that resolves the tenant from the
 * caller's administrator scope and runs under RLS.
 */
import type { RecordSearchProvider } from "@/lib/platform/command-registry";
import { searchLearnerRecords } from "./scholar/learner-search.functions";

export const SCHOLAR_LEARNER_SEARCH: RecordSearchProvider = {
  id: "runtime:scholar/learners",
  groupLabel: "Learners",
  placeholderNoun: "learners",
  navItemKeys: ["r001.org_admin.students"],
  minQueryLength: 3,
  search: (term) => searchLearnerRecords({ data: { term } }),
};
