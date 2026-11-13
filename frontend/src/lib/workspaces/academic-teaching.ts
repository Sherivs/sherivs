import type { CategoryWorkspaceSpec } from "./category-workspace";

/**
 * M009 Stage B-2: Academic & Teaching workspace.
 *
 * Keys are the existing workspace item catalog (SHERIVS-UX1). Nothing here is a
 * permission: the manifest decides what is visible.
 */
export const ACADEMIC_TEACHING_WORKSPACE: CategoryWorkspaceSpec = {
  id: "academic-teaching",
  title: "Teaching and learning",
  summary:
    "Your classes, registers, assessments and learner support, limited to what your assignments permit.",
  families: ["teacher", "form_teacher", "exams", "librarian", "nurse"],
  queueKeys: [
    "w.today_classes",
    "w.form_class",
    "w.attendance_todo",
    "w.grading_queue",
    "w.lesson_note_status",
    "w.exam_timetable",
    "w.cbt_sessions",
    "w.results_pipeline",
    "w.malpractice",
    "w.library_loans",
    "w.at_risk",
  ],
  actionKeys: [
    "a.take_attendance",
    "a.enter_scores",
    "a.submit_note",
    "a.message_parents",
    "a.schedule_exam",
    "a.new_cbt",
    "a.publish_results",
    "a.issue_book",
  ],
  // Counselling and welfare data is need-to-know: the item is shown only when the
  // welfare permission itself granted it, never because of the role title.
  restricted: {
    "w.at_risk": "welfare.pastoral",
    "i.safeguarding": "welfare.pastoral",
  },
  notConfigured: [
    {
      label: "Clinical placements, fieldwork and research supervision",
      reason: "Institution-specific modules are not configured.",
    },
  ],
};
