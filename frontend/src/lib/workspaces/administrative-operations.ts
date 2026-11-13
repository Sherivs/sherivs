import type { CategoryWorkspaceSpec } from "./category-workspace";

/**
 * M009 Stage B-3: Administrative and Institutional Operations workspace
 * (finance, registry and admissions, HR, facilities and welfare operations).
 *
 * Nothing here is a permission. Separation of duties is enforced by the
 * database (`sod_template_conflicts`, `sod_permission_rules` and the
 * `workspace_role_sod_assert*` guards); the pairs below only make the client
 * fail closed if a manifest ever holds both sides.
 */
export const ADMINISTRATIVE_OPERATIONS_WORKSPACE: CategoryWorkspaceSpec = {
  id: "administrative-operations",
  title: "Institution operations",
  summary:
    "Daily finance, records, staffing and facilities work, limited to what your assignments permit.",
  families: ["bursar", "registrar", "hr", "nurse", "hostel", "transport", "security", "staff"],
  queueKeys: [
    "w.fee_collection",
    "w.reconciliation",
    "w.defaulters",
    "w.wallet_balance",
    "w.expense_approvals",
    "w.cashflow",
    "w.payroll_run",
    "w.leave_requests",
    "w.staff_attendance",
    "w.admissions_funnel",
    "w.enrolment",
    "w.hostel_roll",
    "w.hostel_beds",
    "w.sick_bay",
    "w.bus_live",
    "w.my_trip",
    "w.gate_log",
    "w.incidents",
  ],
  actionKeys: [
    "a.record_cash",
    "a.issue_receipt",
    "a.prepare_payroll",
    "a.approve_payroll",
    "a.enrol_student",
    "a.roll_call",
    "a.log_visit",
    "a.start_trip",
    "a.sign_in_visitor",
    "a.report_incident",
  ],
  restricted: {
    "w.sick_bay": "health.records_view",
    "a.log_visit": "health.records_edit",
  },
  // Preparing and approving the same payroll must never be offered together.
  exclusivePairs: [["a.prepare_payroll", "a.approve_payroll"]],
  notConfigured: [
    {
      label: "Budget tracking, fee disputes, financial aid and internal audit queues",
      reason: "No workspace data source exists for these yet.",
    },
  ],
};
