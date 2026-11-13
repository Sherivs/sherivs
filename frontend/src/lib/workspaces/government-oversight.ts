import type { CategoryWorkspaceSpec } from "./category-workspace";

/**
 * M009 Stage B-5: Government Education Oversight workspace.
 *
 * Aggregated data only. The view shows a metric per authorized widget and never
 * list or note payloads, and it forbids every widget that can carry identifiable
 * learner, health, counselling or incident data, even if a manifest held one.
 * Oversight roles are also authority-dependent in the database (the B-5
 * migration flags both oversight templates); this view adds nothing to access.
 */
export const GOVERNMENT_OVERSIGHT_WORKSPACE: CategoryWorkspaceSpec = {
  id: "government-oversight",
  title: "Oversight",
  summary:
    "Aggregated indicators for institutions within your verified mandate. No individual learner records are shown.",
  families: ["gov"],
  queueKeys: ["w.gov_overview", "w.gov_compliance"],
  actionKeys: ["a.gov_inspect"],
  aggregateOnly: true,
  forbiddenKeys: [
    "w.at_risk",
    "w.sick_bay",
    "w.form_class",
    "w.children_summary",
    "w.child_fees",
    "w.child_bus",
    "w.my_results",
    "w.my_timetable",
    "w.my_cbt",
    "w.malpractice",
    "w.incidents",
    "w.house_overview",
    "w.defaulters",
    "w.gate_log",
    "w.hostel_roll",
    "w.library_loans",
    "w.grading_queue",
    "w.attendance_todo",
    "w.lesson_note_status",
    "i.safeguarding",
  ],
  notConfigured: [
    {
      label: "Statutory reporting workflow",
      reason: "The reporting stage is out of scope for this workspace.",
    },
  ],
};
