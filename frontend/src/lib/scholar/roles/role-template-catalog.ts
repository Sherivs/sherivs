// TODO(M009-A1): Reconcile the local typed contract with A1 when its contract is available.
import { z } from "zod";
import { NG_PERMISSIONS } from "./ng-role-catalog.generated";

export const ROLE_TEMPLATE_CATALOG_VERSION = "1.0.0";

export const INSTITUTION_TYPES = [
  "public_primary",
  "private_primary",
  "public_secondary",
  "private_secondary",
  "nursery_ecce",
  "boarding",
  "technical_vocational",
  "university",
  "polytechnic",
  "college_of_education",
  "college_of_health_sciences_and_technology",
  "college_of_nursing_and_midwifery",
  "college_of_agriculture",
  "islamiyya_sangaya",
  "multi_campus_group",
  "multi_shift",
  "government_authority",
  "education_ministry_or_agency",
  "local_education_authority",
  "education_board",
  "teacher_service_authority",
  "quality_assurance_authority",
] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];

export const WORKSPACE_CATEGORIES = [
  "institutional_executive",
  "academic_teaching",
  "administrative_operations",
  "student_parent_family",
  "government_oversight",
] as const;
export type WorkspaceCategory = (typeof WORKSPACE_CATEGORIES)[number];

export const DATA_ACCESS_SCOPES = [
  "own_record",
  "linked_children",
  "class",
  "subject",
  "department",
  "campus",
  "institution",
  "institution_group",
  "authority_aggregate",
] as const;
export type DataAccessScope = (typeof DATA_ACCESS_SCOPES)[number];

export const CATEGORY_DATA_SCOPES: Record<WorkspaceCategory, readonly DataAccessScope[]> = {
  institutional_executive: ["campus", "institution", "institution_group"],
  academic_teaching: ["class", "subject", "department"],
  administrative_operations: ["campus", "institution"],
  student_parent_family: ["own_record", "linked_children"],
  government_oversight: ["authority_aggregate"],
};

export const RESPONSIBILITY_CATALOG = {
  view_institution_dashboard: {
    label: "Review institution-level operational indicators",
    permissionId: "analytics.institution",
    allowedScopes: ["campus", "institution", "institution_group"],
  },
  review_academic_reports: {
    label: "Review academic performance reports",
    permissionId: "reports.academic",
    allowedScopes: ["class", "subject", "department", "campus", "institution"],
  },
  view_attendance: {
    label: "Review attendance in the assigned scope",
    permissionId: "attendance.view",
    allowedScopes: ["class", "subject", "department", "campus", "institution", "linked_children"],
  },
  take_attendance: {
    label: "Record attendance for assigned classes",
    permissionId: "attendance.take",
    allowedScopes: ["class", "subject"],
  },
  manage_timetable: {
    label: "Prepare or maintain the timetable in the assigned scope",
    permissionId: "timetable.manage",
    allowedScopes: ["department", "campus", "institution"],
  },
  view_timetable: {
    label: "View the assigned timetable",
    permissionId: "timetable.view",
    allowedScopes: ["class", "subject", "department", "campus", "institution", "own_record"],
  },
  submit_lesson_notes: {
    label: "Prepare and submit lesson notes",
    permissionId: "lesson_notes.submit",
    allowedScopes: ["class", "subject"],
  },
  approve_lesson_notes: {
    label: "Review lesson notes for the assigned scope",
    permissionId: "lesson_notes.approve",
    allowedScopes: ["department", "campus", "institution"],
  },
  enter_grades: {
    label: "Enter assessment results for assigned teaching",
    permissionId: "grades.enter",
    allowedScopes: ["class", "subject", "department"],
  },
  view_grades: {
    label: "Review results in the assigned scope",
    permissionId: "grades.view",
    allowedScopes: ["class", "subject", "department", "campus", "institution", "own_record"],
  },
  approve_results: {
    label: "Moderate results before publication",
    permissionId: "grades.approve",
    allowedScopes: ["department", "campus", "institution"],
  },
  manage_exam_schedule: {
    label: "Schedule examinations and venues",
    permissionId: "exams.schedule",
    allowedScopes: ["department", "campus", "institution"],
  },
  maintain_exam_records: {
    label: "Maintain official examination records",
    permissionId: "exams.records",
    allowedScopes: ["department", "campus", "institution"],
  },
  invigilate_examinations: {
    label: "Invigilate examinations and record incidents",
    permissionId: "exams.invigilate",
    allowedScopes: ["class", "department", "campus", "institution"],
  },
  view_fee_accounts: {
    label: "Review fee balances in the assigned institution",
    permissionId: "fees.view",
    allowedScopes: ["campus", "institution", "linked_children", "own_record"],
  },
  manage_fee_plans: {
    label: "Maintain fee plans and bills",
    permissionId: "fees.manage_plans",
    allowedScopes: ["campus", "institution"],
  },
  record_cash_payments: {
    label: "Record offline payments",
    permissionId: "payments.record_cash",
    allowedScopes: ["campus", "institution"],
  },
  issue_payment_receipts: {
    label: "Issue receipts for recorded payments",
    permissionId: "payments.record_cash",
    allowedScopes: ["campus", "institution"],
  },
  reconcile_payments: {
    label: "Reconcile payment settlements",
    permissionId: "payments.reconcile",
    allowedScopes: ["campus", "institution"],
  },
  approve_refunds: {
    label: "Approve refunds within assigned policy limits",
    permissionId: "payments.refund",
    allowedScopes: ["campus", "institution"],
  },
  create_expenses: {
    label: "Create expense requests",
    permissionId: "expenses.create",
    allowedScopes: ["campus", "institution"],
  },
  approve_expenses: {
    label: "Approve expenses within assigned policy limits",
    permissionId: "expenses.approve",
    allowedScopes: ["campus", "institution"],
  },
  prepare_budgets: {
    label: "Prepare and maintain institution budgets",
    permissionId: "budget.manage",
    allowedScopes: ["campus", "institution"],
  },
  view_financial_reports: {
    label: "Review financial reports",
    permissionId: "reports.financial",
    allowedScopes: ["campus", "institution", "institution_group"],
  },
  prepare_payroll: {
    label: "Prepare payroll for authorized staff",
    permissionId: "payroll.prepare",
    allowedScopes: ["campus", "institution"],
  },
  review_payroll_register: {
    label: "Review payroll register for authorized staff",
    permissionId: "payroll.view_all",
    allowedScopes: ["campus", "institution"],
  },
  approve_payroll: {
    label: "Approve payroll under the applicable controls",
    permissionId: "payroll.approve",
    allowedScopes: ["campus", "institution"],
  },
  view_staff_directory: {
    label: "Maintain the institution staff directory",
    permissionId: "hr.staff_view",
    allowedScopes: ["campus", "institution"],
  },
  manage_staff_records: {
    label: "Maintain institution employment records",
    permissionId: "hr.staff_manage",
    allowedScopes: ["campus", "institution"],
  },
  approve_staff_leave: {
    label: "Review leave requests from direct reports",
    permissionId: "hr.leave_approve",
    allowedScopes: ["campus", "institution"],
  },
  appraise_staff: {
    label: "Complete staff appraisals in the assigned scope",
    permissionId: "hr.appraisal",
    allowedScopes: ["campus", "institution"],
  },
  view_admissions: {
    label: "Review admission applications",
    permissionId: "admissions.view",
    allowedScopes: ["campus", "institution"],
  },
  process_admissions: {
    label: "Screen and score admission applications",
    permissionId: "admissions.process",
    allowedScopes: ["campus", "institution"],
  },
  issue_admission_offers: {
    label: "Issue or revoke admission offers under institution policy",
    permissionId: "admissions.offer",
    allowedScopes: ["campus", "institution"],
  },
  send_class_communications: {
    label: "Communicate with assigned classes and families",
    permissionId: "comms.send_class",
    allowedScopes: ["class", "subject", "linked_children"],
  },
  view_own_records: {
    label: "View one's own learning and account records",
    permissionId: "self.view_own",
    allowedScopes: ["own_record"],
  },
  view_linked_children: {
    label: "View records for children with a verified relationship",
    permissionId: "children.view",
    allowedScopes: ["linked_children"],
  },
  view_aggregate_reports: {
    label: "Review authorized aggregate education indicators",
    permissionId: "regulator.read_aggregate",
    allowedScopes: ["authority_aggregate"],
  },
  view_audit_trail: {
    label: "Review authorized audit records",
    permissionId: "audit.view",
    allowedScopes: [
      "campus",
      "institution",
      "institution_group",
      "department",
      "authority_aggregate",
    ],
  },
  manage_institution_settings: {
    label: "Manage institution settings within assigned authority",
    permissionId: "settings.manage",
    allowedScopes: ["campus", "institution", "institution_group"],
  },
  assign_institution_roles: {
    label: "Assign institution roles within the approved role catalog",
    permissionId: "roles.assign",
    allowedScopes: ["campus", "institution", "institution_group"],
  },
  manage_curriculum: {
    label: "Maintain curriculum and course records",
    permissionId: "curriculum.manage",
    allowedScopes: ["department", "campus", "institution"],
  },
  manage_classes: {
    label: "Maintain class, arm, and section records",
    permissionId: "classes.manage",
    allowedScopes: ["campus", "institution"],
  },
  manage_research: {
    label: "Coordinate institution research projects",
    permissionId: "research.manage",
    allowedScopes: ["department", "institution"],
  },
  manage_placements: {
    label: "Coordinate supervised clinical or workplace placements",
    permissionId: "siwes.manage",
    allowedScopes: ["department", "institution"],
  },
  view_health_records: {
    label: "Review authorized health records",
    permissionId: "health.records_view",
    allowedScopes: ["campus", "institution"],
  },
  manage_student_welfare: {
    label: "Record student welfare follow-up",
    permissionId: "welfare.pastoral",
    allowedScopes: ["class", "department", "campus", "institution"],
  },
  review_learner_welfare: {
    label: "Review assigned learner welfare follow-up",
    permissionId: "welfare.pastoral",
    allowedScopes: ["class", "department"],
  },
  support_assigned_learning: {
    label: "Support learning activities in assigned classes or subjects",
    permissionId: "lesson_notes.submit",
    allowedScopes: ["class", "subject", "department"],
  },
  view_learning_roster: {
    label: "View the assigned learner roster",
    permissionId: "students.view",
    allowedScopes: ["class", "subject", "department"],
  },
  coordinate_admissions_queue: {
    label: "Coordinate the institution admissions queue",
    permissionId: "admissions.view",
    allowedScopes: ["campus", "institution"],
  },
  maintain_library_catalog: {
    label: "Maintain the assigned library catalog",
    permissionId: "library.catalog",
    allowedScopes: ["department"],
  },
  manage_library_circulation: {
    label: "Manage library circulation",
    permissionId: "library.circulate",
    allowedScopes: ["department"],
  },
  maintain_lab_inventory: {
    label: "Maintain assigned laboratory inventory",
    permissionId: "inventory.manage",
    allowedScopes: ["department"],
  },
  manage_facilities_assets: {
    label: "Maintain facility assets and maintenance records",
    permissionId: "assets.manage",
    allowedScopes: ["campus", "institution"],
  },
  handle_maintenance_requests: {
    label: "Handle facility works and maintenance requests",
    permissionId: "works.requests",
    allowedScopes: ["campus", "institution"],
  },
  record_health_visits: {
    label: "Record authorized clinic visits",
    permissionId: "health.records_edit",
    allowedScopes: ["campus", "institution"],
  },
  manage_hostel_allocations: {
    label: "Manage assigned hostel room allocations",
    permissionId: "hostel.allocate",
    allowedScopes: ["campus", "institution"],
  },
  record_boarding_roll_call: {
    label: "Record boarding roll call and exeat",
    permissionId: "hostel.roll_call",
    allowedScopes: ["campus", "institution"],
  },
  manage_transport_routes: {
    label: "Manage institution routes and transport assignments",
    permissionId: "transport.manage",
    allowedScopes: ["campus", "institution"],
  },
  track_transport_runs: {
    label: "Track assigned transport operations",
    permissionId: "transport.track",
    allowedScopes: ["campus", "institution"],
  },
  operate_assigned_transport_trip: {
    label: "Manage check-ins for an assigned transport trip",
    permissionId: "transport.driver_trip",
    allowedScopes: ["campus", "institution"],
  },
  manage_site_access: {
    label: "Maintain authorized site entry records",
    permissionId: "security.gate_log",
    allowedScopes: ["campus", "institution"],
  },
  manage_visitor_register: {
    label: "Register visitors under institution policy",
    permissionId: "visitors.manage",
    allowedScopes: ["campus", "institution"],
  },
  record_security_incidents: {
    label: "Record security incidents for authorized follow-up",
    permissionId: "security.incident",
    allowedScopes: ["campus", "institution"],
  },
  provide_ict_support: {
    label: "Provide first-line ICT support",
    permissionId: "ict.support",
    allowedScopes: ["campus", "institution"],
  },
  reset_user_access: {
    label: "Reset user access only under approved identity controls",
    permissionId: "ict.reset_access",
    allowedScopes: ["campus", "institution"],
  },
  handle_data_subject_requests: {
    label: "Handle authorized data-subject requests",
    permissionId: "ndpa.dsar",
    allowedScopes: ["institution"],
  },
  review_aggregate_reports: {
    label: "Review aggregate education reports",
    permissionId: "regulator.read_aggregate",
    allowedScopes: ["authority_aggregate"],
  },
  track_aggregate_submissions: {
    label: "Track aggregate reporting submissions",
    permissionId: "regulator.read_aggregate",
    allowedScopes: ["authority_aggregate"],
  },
  review_aggregate_follow_ups: {
    label: "Review aggregate follow-up indicators",
    permissionId: "regulator.read_aggregate",
    allowedScopes: ["authority_aggregate"],
  },
} as const satisfies Record<
  string,
  { label: string; permissionId: string; allowedScopes: readonly DataAccessScope[] }
>;

export type ResponsibilityId = keyof typeof RESPONSIBILITY_CATALOG;

export const SOD_RULES = {
  cash_collection_vs_refund_approval: ["record_cash_payments", "approve_refunds"],
  cash_collection_vs_reconciliation: ["record_cash_payments", "reconcile_payments"],
  expense_creation_vs_approval: ["create_expenses", "approve_expenses"],
  payroll_preparation_vs_approval: ["prepare_payroll", "approve_payroll"],
  result_entry_vs_approval: ["enter_grades", "approve_results"],
  admission_screening_vs_offer: ["process_admissions", "issue_admission_offers"],
  audit_vs_expense_approval: ["view_audit_trail", "approve_expenses"],
  audit_vs_payroll_approval: ["view_audit_trail", "approve_payroll"],
} as const satisfies Record<string, readonly [ResponsibilityId, ResponsibilityId]>;
export type SodRuleId = keyof typeof SOD_RULES;

export const REQUIRED_MODULES = [
  "leadership",
  "academic",
  "attendance",
  "examinations",
  "finance",
  "human_resources",
  "admissions",
  "student_relationships",
  "government_oversight",
  "tertiary",
  "clinical_placements",
  "agricultural_fieldwork",
  "research_supervision",
  "community_learning",
  "facilities",
  "health",
  "boarding",
  "transport",
  "safety",
  "technology",
  "privacy",
] as const;
export type RequiredModule = (typeof REQUIRED_MODULES)[number];

export const WIDGETS = [
  "institution_overview",
  "academic_progress",
  "attendance_summary",
  "timetable",
  "pending_approvals",
  "staff_directory",
  "finance_summary",
  "exam_calendar",
  "class_roster",
  "lesson_planner",
  "learner_progress",
  "family_linked_records",
  "personal_records",
  "aggregate_reporting",
  "inspection_follow_up",
  "placement_tracker",
  "fieldwork_log",
  "research_supervision",
  "campus_operations",
  "admissions_queue",
] as const;
export type CatalogWidget = (typeof WIDGETS)[number];

export interface RoleTemplate {
  id: string;
  title: string;
  category: WorkspaceCategory;
  institutionTypes: readonly InstitutionType[];
  coreResponsibilities: readonly ResponsibilityId[];
  optionalAddOnResponsibilities: readonly ResponsibilityId[];
  primaryDailyResponsibilities: readonly ResponsibilityId[];
  widgets: readonly CatalogWidget[];
  requiredModules: readonly RequiredModule[];
  dataAccessScope: DataAccessScope;
  approvalAuthority: string;
  approvalAuthorityByInstitutionType?: readonly {
    institutionTypes: readonly InstitutionType[];
    authority: string;
  }[];
  reportsTo: readonly string[];
  requiredQualificationRegistration: readonly string[];
  sodConflicts: readonly SodRuleId[];
  enabled: boolean;
  assignable: boolean;
  mandate_status: "not_applicable" | "unverified";
  sourceNotes?: string;
}

const roleTemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    title: z.string().min(2),
    category: z.enum(WORKSPACE_CATEGORIES),
    institutionTypes: z.array(z.enum(INSTITUTION_TYPES)).min(1),
    coreResponsibilities: z
      .array(
        z.enum(Object.keys(RESPONSIBILITY_CATALOG) as [ResponsibilityId, ...ResponsibilityId[]]),
      )
      .min(1),
    optionalAddOnResponsibilities: z.array(
      z.enum(Object.keys(RESPONSIBILITY_CATALOG) as [ResponsibilityId, ...ResponsibilityId[]]),
    ),
    primaryDailyResponsibilities: z
      .array(
        z.enum(Object.keys(RESPONSIBILITY_CATALOG) as [ResponsibilityId, ...ResponsibilityId[]]),
      )
      .length(3),
    widgets: z.array(z.enum(WIDGETS)),
    requiredModules: z.array(z.enum(REQUIRED_MODULES)).min(1),
    dataAccessScope: z.enum(DATA_ACCESS_SCOPES),
    approvalAuthority: z.string().min(1),
    approvalAuthorityByInstitutionType: z
      .array(
        z
          .object({
            institutionTypes: z.array(z.enum(INSTITUTION_TYPES)).min(1),
            authority: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
    reportsTo: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)),
    requiredQualificationRegistration: z.array(z.string().min(1)),
    sodConflicts: z.array(z.enum(Object.keys(SOD_RULES) as [SodRuleId, ...SodRuleId[]])),
    enabled: z.boolean(),
    assignable: z.boolean(),
    mandate_status: z.enum(["not_applicable", "unverified"]),
    sourceNotes: z.string().optional(),
  })
  .strict()
  .superRefine((template, context) => {
    if (template.assignable !== template.enabled) {
      context.addIssue({
        code: "custom",
        path: ["assignable"],
        message: "Only enabled V1 templates may be assigned",
      });
    }
    if (template.mandate_status === "unverified" && template.assignable) {
      context.addIssue({
        code: "custom",
        path: ["assignable"],
        message: "Templates with an unverified mandate cannot be assigned",
      });
    }
    if (template.mandate_status === "unverified" && !template.sourceNotes) {
      context.addIssue({
        code: "custom",
        path: ["sourceNotes"],
        message: "Unverified mandate templates require source notes",
      });
    }
  });

const relationshipSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    jurisdiction: z.literal("Borno State, Nigeria"),
    institutionType: z.enum(INSTITUTION_TYPES),
    institutionLabel: z.string().min(1),
    authorityType: z.enum(INSTITUTION_TYPES),
    authorityLabel: z.string().min(1),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    effectiveTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    source: z.string().min(1),
    evidence_url: z.string().url(),
    verification_status: z.enum(["unverified", "verified"]),
    notes: z.string().min(1),
  })
  .strict()
  .superRefine((relationship, context) => {
    if (
      relationship.effectiveFrom &&
      relationship.effectiveTo &&
      relationship.effectiveFrom > relationship.effectiveTo
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "Effective end date must not precede the start date",
      });
    }
  });

export const ROLE_TEMPLATE_CATALOG_SCHEMA = z
  .object({
    version: z.literal(ROLE_TEMPLATE_CATALOG_VERSION),
    institutionTypes: z.array(z.enum(INSTITUTION_TYPES)).min(1),
    templates: z.array(roleTemplateSchema).min(1),
    relationships: z.array(relationshipSchema).min(1),
  })
  .strict();

const institutionTypes = [
  "public_primary",
  "private_primary",
  "public_secondary",
  "private_secondary",
  "nursery_ecce",
  "boarding",
  "technical_vocational",
  "university",
  "polytechnic",
  "college_of_education",
  "college_of_health_sciences_and_technology",
  "college_of_nursing_and_midwifery",
  "college_of_agriculture",
  "islamiyya_sangaya",
  "multi_campus_group",
  "multi_shift",
  "government_authority",
  "education_ministry_or_agency",
  "local_education_authority",
  "education_board",
  "teacher_service_authority",
  "quality_assurance_authority",
] as const satisfies readonly InstitutionType[];

const verifiedPlaceholder = [
  "Qualification requirements: to be determined and verified for the institution and jurisdiction.",
  "Professional registration: to be determined and verified where applicable.",
] as const;

const authorityNotes =
  "Candidate operational role only. The official title and legal mandate are unverified; no legal mandate is asserted.";

const roleTemplates: readonly RoleTemplate[] = [
  {
    id: "proprietor_group_director",
    title: "Proprietor / group director",
    category: "institutional_executive",
    institutionTypes: [
      "private_primary",
      "private_secondary",
      "nursery_ecce",
      "multi_campus_group",
    ],
    coreResponsibilities: [
      "view_institution_dashboard",
      "view_financial_reports",
      "manage_institution_settings",
    ],
    optionalAddOnResponsibilities: ["assign_institution_roles", "view_audit_trail"],
    primaryDailyResponsibilities: [
      "view_institution_dashboard",
      "view_financial_reports",
      "manage_institution_settings",
    ],
    widgets: ["institution_overview", "finance_summary", "pending_approvals", "campus_operations"],
    requiredModules: ["leadership", "finance"],
    dataAccessScope: "institution_group",
    approvalAuthority:
      "Institution-group decisions only, subject to policy, documented delegation, and applicable SoD controls.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["expense_creation_vs_approval", "payroll_preparation_vs_approval"],
    enabled: true,
    assignable: true,
    mandate_status: "not_applicable",
  },
  {
    id: "principal_head_teacher",
    title: "Principal / head teacher",
    category: "institutional_executive",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
      "boarding",
      "multi_shift",
    ],
    coreResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_attendance",
    ],
    optionalAddOnResponsibilities: [
      "approve_lesson_notes",
      "approve_staff_leave",
      "view_audit_trail",
      "manage_classes",
    ],
    primaryDailyResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_attendance",
    ],
    widgets: [
      "institution_overview",
      "academic_progress",
      "attendance_summary",
      "pending_approvals",
    ],
    requiredModules: ["leadership", "academic", "attendance"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Institution-level operational approvals only where assigned; no proprietor or public-authority powers are inferred.",
    approvalAuthorityByInstitutionType: [
      {
        institutionTypes: ["public_primary", "public_secondary"],
        authority:
          "Institution-level decisions only within verified public-service delegation and policy; no proprietor authority is implied.",
      },
      {
        institutionTypes: ["private_primary", "private_secondary", "nursery_ecce"],
        authority:
          "Institution-level decisions only within delegation recorded by the proprietor or governing body.",
      },
    ],
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval", "payroll_preparation_vs_approval"],
    enabled: true,
    assignable: true,
    mandate_status: "not_applicable",
  },
  {
    id: "vice_principal",
    title: "Vice-principal",
    category: "institutional_executive",
    institutionTypes: ["public_secondary", "private_secondary", "boarding", "multi_shift"],
    coreResponsibilities: ["view_attendance", "review_academic_reports", "approve_lesson_notes"],
    optionalAddOnResponsibilities: [
      "manage_timetable",
      "approve_staff_leave",
      "manage_student_welfare",
    ],
    primaryDailyResponsibilities: [
      "view_attendance",
      "review_academic_reports",
      "approve_lesson_notes",
    ],
    widgets: ["attendance_summary", "academic_progress", "pending_approvals", "campus_operations"],
    requiredModules: ["leadership", "academic", "attendance"],
    dataAccessScope: "campus",
    approvalAuthority: "Delegated campus-level academic and operational approvals only.",
    reportsTo: ["principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval", "payroll_preparation_vs_approval"],
    enabled: true,
    assignable: true,
    mandate_status: "not_applicable",
  },
  {
    id: "campus_head",
    title: "Campus head",
    category: "institutional_executive",
    institutionTypes: [
      "multi_campus_group",
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
    ],
    coreResponsibilities: [
      "view_institution_dashboard",
      "view_attendance",
      "review_academic_reports",
    ],
    optionalAddOnResponsibilities: [
      "manage_timetable",
      "view_financial_reports",
      "approve_staff_leave",
    ],
    primaryDailyResponsibilities: [
      "view_institution_dashboard",
      "view_attendance",
      "review_academic_reports",
    ],
    widgets: [
      "institution_overview",
      "attendance_summary",
      "academic_progress",
      "campus_operations",
    ],
    requiredModules: ["leadership", "academic", "attendance"],
    dataAccessScope: "campus",
    approvalAuthority:
      "Campus-level decisions only within institution policy and recorded delegation.",
    reportsTo: ["proprietor_group_director", "principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["expense_creation_vs_approval", "payroll_preparation_vs_approval"],
    enabled: true,
    assignable: true,
    mandate_status: "not_applicable",
  },
  {
    id: "vice_chancellor",
    title: "Vice-chancellor",
    category: "institutional_executive",
    institutionTypes: ["university"],
    coreResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_financial_reports",
    ],
    optionalAddOnResponsibilities: ["view_audit_trail", "assign_institution_roles"],
    primaryDailyResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_financial_reports",
    ],
    widgets: ["institution_overview", "academic_progress", "finance_summary", "pending_approvals"],
    requiredModules: ["leadership", "academic", "tertiary"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Tertiary leadership template retained for future review; no legal or statutory authority is asserted.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["expense_creation_vs_approval", "payroll_preparation_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary leadership role retained for future review; official title, delegation, and applicable requirements need verification.",
  },
  {
    id: "deputy_vice_chancellor",
    title: "Deputy vice-chancellor",
    category: "institutional_executive",
    institutionTypes: ["university"],
    coreResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_attendance",
    ],
    optionalAddOnResponsibilities: ["approve_lesson_notes", "view_financial_reports"],
    primaryDailyResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_attendance",
    ],
    widgets: ["institution_overview", "academic_progress", "attendance_summary"],
    requiredModules: ["leadership", "academic", "tertiary"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Tertiary leadership template retained for future review; no legal or statutory authority is asserted.",
    reportsTo: ["vice_chancellor"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["expense_creation_vs_approval", "payroll_preparation_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary leadership role retained for future review; official title, delegation, and applicable requirements need verification.",
  },
  {
    id: "rector_or_provost",
    title: "Rector / provost",
    category: "institutional_executive",
    institutionTypes: [
      "polytechnic",
      "college_of_education",
      "college_of_health_sciences_and_technology",
      "college_of_nursing_and_midwifery",
      "college_of_agriculture",
    ],
    coreResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_financial_reports",
    ],
    optionalAddOnResponsibilities: ["view_audit_trail", "assign_institution_roles"],
    primaryDailyResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_financial_reports",
    ],
    widgets: ["institution_overview", "academic_progress", "finance_summary", "pending_approvals"],
    requiredModules: ["leadership", "academic", "tertiary"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Tertiary leadership template retained for future review; no legal or statutory authority is asserted.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["expense_creation_vs_approval", "payroll_preparation_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary leadership role retained for future review; official title, delegation, and applicable requirements need verification.",
  },
  {
    id: "dean",
    title: "Dean",
    category: "academic_teaching",
    institutionTypes: [
      "university",
      "polytechnic",
      "college_of_education",
      "college_of_health_sciences_and_technology",
      "college_of_nursing_and_midwifery",
      "college_of_agriculture",
    ],
    coreResponsibilities: ["review_academic_reports", "manage_curriculum", "view_attendance"],
    optionalAddOnResponsibilities: ["manage_research", "view_grades", "approve_lesson_notes"],
    primaryDailyResponsibilities: [
      "review_academic_reports",
      "manage_curriculum",
      "view_attendance",
    ],
    widgets: ["academic_progress", "research_supervision", "pending_approvals"],
    requiredModules: ["academic", "tertiary"],
    dataAccessScope: "department",
    approvalAuthority:
      "Faculty-level academic review only under institution policy; no statutory authority is asserted.",
    reportsTo: ["rector_or_provost", "vice_chancellor"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary academic leadership role retained for future review; official title, delegation, and applicable requirements need verification.",
  },
  {
    id: "institution_board_member",
    title: "Institution board member",
    category: "institutional_executive",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
      "college_of_education",
      "multi_campus_group",
    ],
    coreResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_financial_reports",
    ],
    optionalAddOnResponsibilities: ["view_audit_trail"],
    primaryDailyResponsibilities: [
      "view_institution_dashboard",
      "review_academic_reports",
      "view_financial_reports",
    ],
    widgets: ["institution_overview", "academic_progress", "finance_summary"],
    requiredModules: ["leadership"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Read-only governance template; any decision authority requires verified governing documents and explicit delegation.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["expense_creation_vs_approval", "payroll_preparation_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Governance template only; membership, title, authority, and mandate require verification.",
  },
  {
    id: "class_teacher",
    title: "Class teacher",
    category: "academic_teaching",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
      "multi_shift",
    ],
    coreResponsibilities: ["take_attendance", "enter_grades", "send_class_communications"],
    optionalAddOnResponsibilities: ["submit_lesson_notes", "view_grades", "manage_student_welfare"],
    primaryDailyResponsibilities: ["take_attendance", "enter_grades", "send_class_communications"],
    widgets: ["class_roster", "attendance_summary", "learner_progress", "timetable"],
    requiredModules: ["academic", "attendance", "student_relationships"],
    dataAccessScope: "class",
    approvalAuthority: "No institution-wide approval authority; assigned class work only.",
    reportsTo: ["principal_head_teacher", "vice_principal"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: true,
    assignable: true,
    mandate_status: "not_applicable",
  },
  {
    id: "subject_teacher",
    title: "Subject teacher",
    category: "academic_teaching",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "technical_vocational",
      "multi_shift",
    ],
    coreResponsibilities: ["submit_lesson_notes", "enter_grades", "view_timetable"],
    optionalAddOnResponsibilities: ["take_attendance", "view_grades", "send_class_communications"],
    primaryDailyResponsibilities: ["submit_lesson_notes", "enter_grades", "view_timetable"],
    widgets: ["lesson_planner", "timetable", "learner_progress", "class_roster"],
    requiredModules: ["academic", "attendance"],
    dataAccessScope: "subject",
    approvalAuthority: "No approval of own assessment results; subject-assignment scope only.",
    reportsTo: ["principal_head_teacher", "vice_principal"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: true,
    assignable: true,
    mandate_status: "not_applicable",
  },
  {
    id: "exams_officer",
    title: "Examinations officer",
    category: "academic_teaching",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "technical_vocational",
      "university",
      "polytechnic",
      "college_of_education",
    ],
    coreResponsibilities: [
      "manage_exam_schedule",
      "maintain_exam_records",
      "invigilate_examinations",
    ],
    optionalAddOnResponsibilities: ["view_grades", "view_attendance"],
    primaryDailyResponsibilities: [
      "manage_exam_schedule",
      "maintain_exam_records",
      "invigilate_examinations",
    ],
    widgets: ["exam_calendar", "pending_approvals", "academic_progress"],
    requiredModules: ["examinations", "academic"],
    dataAccessScope: "department",
    approvalAuthority:
      "Examination operations only; result adjudication and publication remain separately controlled.",
    reportsTo: ["principal_head_teacher", "vice_principal"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: true,
    assignable: true,
    mandate_status: "not_applicable",
  },
  {
    id: "bursar",
    title: "Bursar",
    category: "administrative_operations",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
      "college_of_education",
      "college_of_health_sciences_and_technology",
      "college_of_nursing_and_midwifery",
      "college_of_agriculture",
    ],
    coreResponsibilities: ["view_fee_accounts", "reconcile_payments", "view_financial_reports"],
    optionalAddOnResponsibilities: ["manage_fee_plans", "create_expenses", "prepare_budgets"],
    primaryDailyResponsibilities: [
      "view_fee_accounts",
      "reconcile_payments",
      "view_financial_reports",
    ],
    widgets: ["finance_summary", "pending_approvals", "institution_overview"],
    requiredModules: ["finance"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Finance actions only where specifically granted; payment collection, refunds, and approvals remain subject to SoD.",
    reportsTo: ["principal_head_teacher", "proprietor_group_director"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [
      "cash_collection_vs_refund_approval",
      "cash_collection_vs_reconciliation",
      "expense_creation_vs_approval",
      "payroll_preparation_vs_approval",
    ],
    enabled: true,
    assignable: true,
    mandate_status: "not_applicable",
  },
  {
    id: "admin_hr",
    title: "Administration / HR",
    category: "administrative_operations",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
      "college_of_education",
      "multi_campus_group",
    ],
    coreResponsibilities: ["view_staff_directory", "manage_staff_records", "approve_staff_leave"],
    optionalAddOnResponsibilities: ["appraise_staff", "view_audit_trail", "manage_classes"],
    primaryDailyResponsibilities: [
      "view_staff_directory",
      "manage_staff_records",
      "approve_staff_leave",
    ],
    widgets: ["staff_directory", "pending_approvals", "campus_operations"],
    requiredModules: ["human_resources", "leadership"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Institution HR administration only; no government employment-board powers are implied.",
    reportsTo: ["principal_head_teacher", "proprietor_group_director"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["payroll_preparation_vs_approval"],
    enabled: true,
    assignable: true,
    mandate_status: "not_applicable",
  },
  {
    id: "accountant",
    title: "Accountant",
    category: "administrative_operations",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
      "college_of_education",
    ],
    coreResponsibilities: ["reconcile_payments", "prepare_budgets", "view_financial_reports"],
    optionalAddOnResponsibilities: ["view_fee_accounts", "create_expenses"],
    primaryDailyResponsibilities: [
      "reconcile_payments",
      "prepare_budgets",
      "view_financial_reports",
    ],
    widgets: ["finance_summary", "pending_approvals"],
    requiredModules: ["finance"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Finance preparation and reconciliation only; approvals remain independently controlled.",
    reportsTo: ["bursar", "principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["cash_collection_vs_refund_approval", "expense_creation_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "cashier",
    title: "Cashier",
    category: "administrative_operations",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
      "university",
      "polytechnic",
    ],
    coreResponsibilities: ["view_fee_accounts", "record_cash_payments", "issue_payment_receipts"],
    optionalAddOnResponsibilities: [],
    primaryDailyResponsibilities: [
      "view_fee_accounts",
      "record_cash_payments",
      "issue_payment_receipts",
    ],
    widgets: ["finance_summary"],
    requiredModules: ["finance"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Payment recording and receipts only; no refund approval or settlement reconciliation.",
    reportsTo: ["bursar"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["cash_collection_vs_refund_approval", "cash_collection_vs_reconciliation"],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "payroll_officer",
    title: "Payroll officer",
    category: "administrative_operations",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
      "multi_campus_group",
    ],
    coreResponsibilities: ["view_staff_directory", "prepare_payroll", "review_payroll_register"],
    optionalAddOnResponsibilities: ["view_financial_reports"],
    primaryDailyResponsibilities: [
      "view_staff_directory",
      "prepare_payroll",
      "review_payroll_register",
    ],
    widgets: ["staff_directory", "finance_summary", "pending_approvals"],
    requiredModules: ["human_resources", "finance"],
    dataAccessScope: "institution",
    approvalAuthority: "Payroll preparation only; cannot approve its own payroll run.",
    reportsTo: ["bursar", "admin_hr"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["payroll_preparation_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "internal_auditor",
    title: "Internal auditor",
    category: "administrative_operations",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
      "college_of_education",
      "multi_campus_group",
    ],
    coreResponsibilities: ["view_audit_trail", "view_financial_reports", "review_payroll_register"],
    optionalAddOnResponsibilities: ["view_fee_accounts"],
    primaryDailyResponsibilities: [
      "view_audit_trail",
      "view_financial_reports",
      "review_payroll_register",
    ],
    widgets: ["finance_summary", "institution_overview"],
    requiredModules: ["finance", "leadership"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Review only; cannot approve transactions or payroll that are subject to audit.",
    reportsTo: ["institution_board_member"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [
      "expense_creation_vs_approval",
      "payroll_preparation_vs_approval",
      "audit_vs_expense_approval",
      "audit_vs_payroll_approval",
    ],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "admissions_officer",
    title: "Admissions officer",
    category: "administrative_operations",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
      "university",
      "polytechnic",
      "college_of_education",
    ],
    coreResponsibilities: ["view_admissions", "coordinate_admissions_queue", "process_admissions"],
    optionalAddOnResponsibilities: ["view_audit_trail"],
    primaryDailyResponsibilities: [
      "view_admissions",
      "coordinate_admissions_queue",
      "process_admissions",
    ],
    widgets: ["admissions_queue", "pending_approvals"],
    requiredModules: ["admissions"],
    dataAccessScope: "institution",
    approvalAuthority:
      "Application screening only; admission offers remain a separate approval responsibility.",
    reportsTo: ["institution_registrar", "principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["admission_screening_vs_offer"],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "academic_coordinator",
    title: "Academic coordinator",
    category: "academic_teaching",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "technical_vocational",
      "multi_shift",
    ],
    coreResponsibilities: ["review_academic_reports", "approve_lesson_notes", "manage_curriculum"],
    optionalAddOnResponsibilities: ["manage_timetable", "view_attendance"],
    primaryDailyResponsibilities: [
      "review_academic_reports",
      "approve_lesson_notes",
      "manage_curriculum",
    ],
    widgets: ["academic_progress", "pending_approvals", "timetable"],
    requiredModules: ["academic"],
    dataAccessScope: "department",
    approvalAuthority:
      "Academic coordination only within assigned department and institution policy.",
    reportsTo: ["principal_head_teacher", "vice_principal"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "teaching_assistant",
    title: "Teaching assistant",
    category: "academic_teaching",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
      "technical_vocational",
    ],
    coreResponsibilities: ["support_assigned_learning", "view_learning_roster", "view_timetable"],
    optionalAddOnResponsibilities: ["take_attendance", "review_learner_welfare"],
    primaryDailyResponsibilities: [
      "support_assigned_learning",
      "view_learning_roster",
      "view_timetable",
    ],
    widgets: ["class_roster", "timetable", "learner_progress"],
    requiredModules: ["academic", "student_relationships"],
    dataAccessScope: "class",
    approvalAuthority:
      "Assigned learning support only; no result approval or institution-wide access.",
    reportsTo: ["class_teacher", "subject_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "teaching_practice_supervisor",
    title: "Teaching-practice supervisor",
    category: "academic_teaching",
    institutionTypes: ["university", "college_of_education"],
    coreResponsibilities: ["manage_placements", "review_academic_reports", "view_attendance"],
    optionalAddOnResponsibilities: ["view_grades", "review_learner_welfare"],
    primaryDailyResponsibilities: [
      "manage_placements",
      "review_academic_reports",
      "view_attendance",
    ],
    widgets: ["placement_tracker", "academic_progress", "attendance_summary"],
    requiredModules: ["academic", "tertiary", "clinical_placements"],
    dataAccessScope: "department",
    approvalAuthority: "Supervision of assigned teaching-practice placements only.",
    reportsTo: ["head_of_department"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary placement role retained for future review; institutional placement requirements need verification.",
  },
  {
    id: "technical_instructor",
    title: "Technical instructor",
    category: "academic_teaching",
    institutionTypes: ["technical_vocational", "polytechnic"],
    coreResponsibilities: ["support_assigned_learning", "maintain_lab_inventory", "view_timetable"],
    optionalAddOnResponsibilities: ["view_grades"],
    primaryDailyResponsibilities: [
      "support_assigned_learning",
      "maintain_lab_inventory",
      "view_timetable",
    ],
    widgets: ["lesson_planner", "timetable", "fieldwork_log"],
    requiredModules: ["academic", "agricultural_fieldwork"],
    dataAccessScope: "department",
    approvalAuthority:
      "Assigned technical instruction only; no external site or safety authority is inferred.",
    reportsTo: ["head_of_department", "principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "school_counsellor",
    title: "School counsellor",
    category: "academic_teaching",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
    ],
    coreResponsibilities: ["review_learner_welfare", "view_learning_roster", "view_attendance"],
    optionalAddOnResponsibilities: ["manage_student_welfare"],
    primaryDailyResponsibilities: [
      "review_learner_welfare",
      "view_learning_roster",
      "view_attendance",
    ],
    widgets: ["learner_progress", "attendance_summary"],
    requiredModules: ["academic", "student_relationships"],
    dataAccessScope: "department",
    approvalAuthority:
      "Support and referral only; confidential counselling records require separate authorization.",
    reportsTo: ["principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "librarian",
    title: "Librarian",
    category: "academic_teaching",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
      "college_of_education",
    ],
    coreResponsibilities: [
      "maintain_library_catalog",
      "manage_library_circulation",
      "view_learning_roster",
    ],
    optionalAddOnResponsibilities: ["view_timetable"],
    primaryDailyResponsibilities: [
      "maintain_library_catalog",
      "manage_library_circulation",
      "view_learning_roster",
    ],
    widgets: ["class_roster", "timetable"],
    requiredModules: ["academic"],
    dataAccessScope: "department",
    approvalAuthority: "Library operations only within assigned institution policy.",
    reportsTo: ["principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "special_education_teacher",
    title: "Special education teacher",
    category: "academic_teaching",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
    ],
    coreResponsibilities: [
      "support_assigned_learning",
      "review_learner_welfare",
      "view_learning_roster",
    ],
    optionalAddOnResponsibilities: ["view_attendance", "view_grades"],
    primaryDailyResponsibilities: [
      "support_assigned_learning",
      "review_learner_welfare",
      "view_learning_roster",
    ],
    widgets: ["class_roster", "learner_progress", "attendance_summary"],
    requiredModules: ["academic", "student_relationships"],
    dataAccessScope: "class",
    approvalAuthority:
      "Assigned learning support only; sensitive support records remain separately restricted.",
    reportsTo: ["class_teacher", "principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "institution_registrar",
    title: "Institution registrar",
    category: "administrative_operations",
    institutionTypes: [
      "university",
      "polytechnic",
      "college_of_education",
      "college_of_health_sciences_and_technology",
      "college_of_nursing_and_midwifery",
      "college_of_agriculture",
    ],
    coreResponsibilities: ["view_admissions", "issue_admission_offers", "view_grades"],
    optionalAddOnResponsibilities: ["view_audit_trail"],
    primaryDailyResponsibilities: ["view_admissions", "issue_admission_offers", "view_grades"],
    widgets: ["admissions_queue", "pending_approvals", "institution_overview"],
    requiredModules: ["admissions", "tertiary"],
    dataAccessScope: "institution",
    approvalAuthority: "Admissions and registry actions only as assigned by institution policy.",
    reportsTo: ["principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["admission_screening_vs_offer"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary template retained for future review; title and applicable authority require local verification.",
  },
  {
    id: "head_of_department",
    title: "Head of department",
    category: "academic_teaching",
    institutionTypes: [
      "public_secondary",
      "private_secondary",
      "technical_vocational",
      "university",
      "polytechnic",
      "college_of_education",
      "college_of_health_sciences_and_technology",
      "college_of_nursing_and_midwifery",
      "college_of_agriculture",
    ],
    coreResponsibilities: ["review_academic_reports", "approve_lesson_notes", "manage_curriculum"],
    optionalAddOnResponsibilities: ["manage_timetable", "view_grades", "manage_research"],
    primaryDailyResponsibilities: [
      "review_academic_reports",
      "approve_lesson_notes",
      "manage_curriculum",
    ],
    widgets: ["academic_progress", "pending_approvals", "timetable"],
    requiredModules: ["academic", "tertiary"],
    dataAccessScope: "department",
    approvalAuthority: "Department-level academic review only under institution policy.",
    reportsTo: ["principal_head_teacher"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary template retained for future review; title and reporting relationship require local verification.",
  },
  {
    id: "lecturer",
    title: "Lecturer",
    category: "academic_teaching",
    institutionTypes: [
      "university",
      "polytechnic",
      "college_of_education",
      "college_of_health_sciences_and_technology",
      "college_of_nursing_and_midwifery",
      "college_of_agriculture",
    ],
    coreResponsibilities: ["manage_curriculum", "enter_grades", "view_timetable"],
    optionalAddOnResponsibilities: ["view_grades", "manage_research", "manage_placements"],
    primaryDailyResponsibilities: ["manage_curriculum", "enter_grades", "view_timetable"],
    widgets: ["academic_progress", "timetable", "research_supervision", "placement_tracker"],
    requiredModules: ["academic", "tertiary"],
    dataAccessScope: "department",
    approvalAuthority:
      "Teaching and assessment in assigned courses only; no self-approval of results.",
    reportsTo: ["head_of_department"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary template retained for future review; title and applicable institutional rules require verification.",
  },
  {
    id: "clinical_instructor",
    title: "Clinical instructor",
    category: "academic_teaching",
    institutionTypes: [
      "college_of_health_sciences_and_technology",
      "college_of_nursing_and_midwifery",
    ],
    coreResponsibilities: ["manage_placements", "view_grades", "view_attendance"],
    optionalAddOnResponsibilities: ["manage_student_welfare"],
    primaryDailyResponsibilities: ["manage_placements", "view_attendance", "view_grades"],
    widgets: ["placement_tracker", "learner_progress", "attendance_summary"],
    requiredModules: ["tertiary", "clinical_placements"],
    dataAccessScope: "department",
    approvalAuthority:
      "Placement supervision only within an explicitly assigned institution and placement scope.",
    reportsTo: ["head_of_department"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary placement role retained for future review; local clinical and institutional requirements need verification.",
  },
  {
    id: "agricultural_fieldwork_instructor",
    title: "Agricultural fieldwork instructor",
    category: "academic_teaching",
    institutionTypes: ["college_of_agriculture", "technical_vocational"],
    coreResponsibilities: ["manage_curriculum", "view_attendance", "view_grades"],
    optionalAddOnResponsibilities: ["manage_placements", "manage_student_welfare"],
    primaryDailyResponsibilities: ["manage_curriculum", "view_attendance", "view_grades"],
    widgets: ["fieldwork_log", "learner_progress", "attendance_summary"],
    requiredModules: ["tertiary", "agricultural_fieldwork"],
    dataAccessScope: "department",
    approvalAuthority:
      "Assigned fieldwork supervision only; no land or external-site authority is inferred.",
    reportsTo: ["head_of_department"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: ["result_entry_vs_approval"],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary fieldwork role retained for future review; local course, site, and institutional requirements need verification.",
  },
  {
    id: "research_supervisor",
    title: "Research supervisor",
    category: "academic_teaching",
    institutionTypes: [
      "university",
      "polytechnic",
      "college_of_education",
      "college_of_health_sciences_and_technology",
      "college_of_nursing_and_midwifery",
      "college_of_agriculture",
    ],
    coreResponsibilities: ["manage_research", "view_grades", "view_attendance"],
    optionalAddOnResponsibilities: ["manage_placements", "view_audit_trail"],
    primaryDailyResponsibilities: ["manage_research", "view_grades", "view_attendance"],
    widgets: ["research_supervision", "learner_progress", "pending_approvals"],
    requiredModules: ["tertiary", "research_supervision"],
    dataAccessScope: "department",
    approvalAuthority:
      "Research supervision only within an assigned programme and institutional review process.",
    reportsTo: ["head_of_department"],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Tertiary research role retained for future review; local supervision and institutional requirements need verification.",
  },
  {
    id: "sangaya_learning_facilitator",
    title: "Sangaya / Islamiyya learning facilitator",
    category: "academic_teaching",
    institutionTypes: ["islamiyya_sangaya"],
    coreResponsibilities: ["submit_lesson_notes", "take_attendance", "manage_student_welfare"],
    optionalAddOnResponsibilities: ["view_grades", "send_class_communications"],
    primaryDailyResponsibilities: [
      "submit_lesson_notes",
      "take_attendance",
      "manage_student_welfare",
    ],
    widgets: ["class_roster", "attendance_summary", "learner_progress"],
    requiredModules: ["community_learning", "academic", "attendance"],
    dataAccessScope: "class",
    approvalAuthority:
      "Assigned learning activities only; no religious-board authority is inferred.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes:
      "Candidate learning role only. Applicable official titles, oversight body, and mandate require confirmation.",
  },
  {
    id: "adult_student",
    title: "Adult student",
    category: "student_parent_family",
    institutionTypes: [
      "university",
      "polytechnic",
      "college_of_education",
      "college_of_health_sciences_and_technology",
      "college_of_nursing_and_midwifery",
      "college_of_agriculture",
      "technical_vocational",
    ],
    coreResponsibilities: ["view_own_records", "view_timetable", "view_grades"],
    optionalAddOnResponsibilities: ["view_fee_accounts"],
    primaryDailyResponsibilities: ["view_own_records", "view_timetable", "view_grades"],
    widgets: ["personal_records", "timetable", "learner_progress"],
    requiredModules: ["student_relationships", "academic"],
    dataAccessScope: "own_record",
    approvalAuthority: "No authority over another adult student's records or decisions.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "pupil_learner",
    title: "Pupil learner",
    category: "student_parent_family",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
    ],
    coreResponsibilities: ["view_own_records", "view_timetable", "view_grades"],
    optionalAddOnResponsibilities: [],
    primaryDailyResponsibilities: ["view_own_records", "view_timetable", "view_grades"],
    widgets: ["personal_records", "timetable", "learner_progress"],
    requiredModules: ["student_relationships", "academic"],
    dataAccessScope: "own_record",
    approvalAuthority: "No authority over other learners' records.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "parent_legal_guardian",
    title: "Parent / legal guardian",
    category: "student_parent_family",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
    ],
    coreResponsibilities: ["view_linked_children", "view_fee_accounts", "view_attendance"],
    optionalAddOnResponsibilities: ["send_class_communications"],
    primaryDailyResponsibilities: ["view_linked_children", "view_fee_accounts", "view_attendance"],
    widgets: ["family_linked_records", "attendance_summary", "finance_summary"],
    requiredModules: ["student_relationships"],
    dataAccessScope: "linked_children",
    approvalAuthority:
      "Relationship-limited participation only; a fee payer or caregiver is not automatically a legal guardian.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "verified_caregiver",
    title: "Verified caregiver",
    category: "student_parent_family",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
    ],
    coreResponsibilities: ["view_linked_children", "view_attendance", "view_fee_accounts"],
    optionalAddOnResponsibilities: [],
    primaryDailyResponsibilities: ["view_linked_children", "view_attendance", "view_fee_accounts"],
    widgets: ["family_linked_records", "attendance_summary"],
    requiredModules: ["student_relationships"],
    dataAccessScope: "linked_children",
    approvalAuthority:
      "Only the minimum relationship-scoped access approved by the institution; caregiver status alone does not establish legal guardianship.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "fee_payer",
    title: "Fee payer",
    category: "student_parent_family",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "nursery_ecce",
      "university",
      "polytechnic",
    ],
    coreResponsibilities: ["view_fee_accounts", "view_own_records", "view_timetable"],
    optionalAddOnResponsibilities: [],
    primaryDailyResponsibilities: ["view_fee_accounts", "view_own_records", "view_timetable"],
    widgets: ["finance_summary", "personal_records"],
    requiredModules: ["student_relationships"],
    dataAccessScope: "own_record",
    approvalAuthority: "Payment relationship only; no access to unrelated student records.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "student_representative",
    title: "Student representative",
    category: "student_parent_family",
    institutionTypes: [
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
      "college_of_education",
    ],
    coreResponsibilities: ["view_own_records", "view_timetable", "view_grades"],
    optionalAddOnResponsibilities: [],
    primaryDailyResponsibilities: ["view_own_records", "view_timetable", "view_grades"],
    widgets: ["personal_records", "timetable"],
    requiredModules: ["student_relationships", "community_learning"],
    dataAccessScope: "own_record",
    approvalAuthority: "No delegated access to other students' records.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "alumnus",
    title: "Alumnus",
    category: "student_parent_family",
    institutionTypes: [
      "public_primary",
      "private_primary",
      "public_secondary",
      "private_secondary",
      "university",
      "polytechnic",
    ],
    coreResponsibilities: ["view_own_records", "view_timetable", "view_grades"],
    optionalAddOnResponsibilities: [],
    primaryDailyResponsibilities: ["view_own_records", "view_timetable", "view_grades"],
    widgets: ["personal_records"],
    requiredModules: ["student_relationships", "community_learning"],
    dataAccessScope: "own_record",
    approvalAuthority: "Own records only; no current-student access is implied.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "not_applicable",
  },
  {
    id: "lgea_education_secretary",
    title: "Local education authority education secretary (candidate)",
    category: "government_oversight",
    institutionTypes: ["local_education_authority"],
    coreResponsibilities: [
      "view_aggregate_reports",
      "review_aggregate_reports",
      "track_aggregate_submissions",
    ],
    optionalAddOnResponsibilities: ["review_aggregate_follow_ups"],
    primaryDailyResponsibilities: [
      "view_aggregate_reports",
      "review_aggregate_reports",
      "track_aggregate_submissions",
    ],
    widgets: ["aggregate_reporting", "inspection_follow_up"],
    requiredModules: ["government_oversight"],
    dataAccessScope: "authority_aggregate",
    approvalAuthority:
      "No authority is asserted; any future action requires confirmed mandate and explicit authorization.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes: authorityNotes,
  },
  {
    id: "quality_assurance_inspector",
    title: "Quality assurance inspector (candidate)",
    category: "government_oversight",
    institutionTypes: ["quality_assurance_authority"],
    coreResponsibilities: [
      "view_aggregate_reports",
      "review_aggregate_reports",
      "track_aggregate_submissions",
    ],
    optionalAddOnResponsibilities: ["review_aggregate_follow_ups"],
    primaryDailyResponsibilities: [
      "view_aggregate_reports",
      "review_aggregate_reports",
      "track_aggregate_submissions",
    ],
    widgets: ["aggregate_reporting", "inspection_follow_up"],
    requiredModules: ["government_oversight"],
    dataAccessScope: "authority_aggregate",
    approvalAuthority: "No inspection or enforcement authority is asserted.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes: authorityNotes,
  },
  {
    id: "bosaseb_desk_officer",
    title: "BOSASEB desk officer (candidate)",
    category: "government_oversight",
    institutionTypes: ["education_board"],
    coreResponsibilities: [
      "view_aggregate_reports",
      "review_aggregate_reports",
      "track_aggregate_submissions",
    ],
    optionalAddOnResponsibilities: ["review_aggregate_follow_ups"],
    primaryDailyResponsibilities: [
      "view_aggregate_reports",
      "review_aggregate_reports",
      "track_aggregate_submissions",
    ],
    widgets: ["aggregate_reporting", "inspection_follow_up"],
    requiredModules: ["government_oversight"],
    dataAccessScope: "authority_aggregate",
    approvalAuthority:
      "No board authority is asserted; official identity and mandate require confirmation.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes: authorityNotes,
  },
  {
    id: "commissioner_candidate",
    title: "Education commissioner (candidate)",
    category: "government_oversight",
    institutionTypes: ["government_authority", "education_ministry_or_agency"],
    coreResponsibilities: [
      "view_aggregate_reports",
      "review_aggregate_reports",
      "review_aggregate_follow_ups",
    ],
    optionalAddOnResponsibilities: [],
    primaryDailyResponsibilities: [
      "view_aggregate_reports",
      "review_aggregate_reports",
      "review_aggregate_follow_ups",
    ],
    widgets: ["aggregate_reporting", "institution_overview"],
    requiredModules: ["government_oversight"],
    dataAccessScope: "authority_aggregate",
    approvalAuthority: "Decision-support view only; no legal or executive authority is asserted.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes: authorityNotes,
  },
  {
    id: "permanent_secretary_candidate",
    title: "Permanent secretary (candidate)",
    category: "government_oversight",
    institutionTypes: ["government_authority", "education_ministry_or_agency"],
    coreResponsibilities: [
      "view_aggregate_reports",
      "track_aggregate_submissions",
      "review_aggregate_follow_ups",
    ],
    optionalAddOnResponsibilities: [],
    primaryDailyResponsibilities: [
      "view_aggregate_reports",
      "track_aggregate_submissions",
      "review_aggregate_follow_ups",
    ],
    widgets: ["aggregate_reporting", "institution_overview"],
    requiredModules: ["government_oversight"],
    dataAccessScope: "authority_aggregate",
    approvalAuthority: "Decision-support view only; no legal or executive authority is asserted.",
    reportsTo: [],
    requiredQualificationRegistration: [...verifiedPlaceholder],
    sodConflicts: [],
    enabled: false,
    assignable: false,
    mandate_status: "unverified",
    sourceNotes: authorityNotes,
  },
] as const satisfies readonly RoleTemplate[];

const relationshipSource =
  "M009 epic #175 and owner-provided research comment on #178; candidate only, not an authority determination";
const relationshipEvidenceUrl = "https://github.com/Sherivs/sherivs/issues/178";
const relationshipNotes =
  "Unverified candidate only. Official institution and authority names, responsibilities, and mandates must be confirmed before use. The reported LGEA and teacher-posting changes are not verified here; their current division and legal effect remain unconfirmed.";

export const INSTITUTION_AUTHORITY_RELATIONSHIPS = [
  {
    id: "borno_lgea_subeb_candidate",
    jurisdiction: "Borno State, Nigeria",
    institutionType: "local_education_authority",
    institutionLabel: "Local education authority (candidate)",
    authorityType: "education_board",
    authorityLabel: "SUBEB (candidate authority; mandate unverified)",
    effectiveFrom: null,
    effectiveTo: null,
    source: relationshipSource,
    evidence_url: relationshipEvidenceUrl,
    verification_status: "unverified",
    notes: relationshipNotes,
  },
  {
    id: "borno_lgea_ministry_candidate",
    jurisdiction: "Borno State, Nigeria",
    institutionType: "local_education_authority",
    institutionLabel: "Local education authority (candidate)",
    authorityType: "education_ministry_or_agency",
    authorityLabel: "Education ministry or agency (candidate authority; mandate unverified)",
    effectiveFrom: null,
    effectiveTo: null,
    source: relationshipSource,
    evidence_url: relationshipEvidenceUrl,
    verification_status: "unverified",
    notes: relationshipNotes,
  },
  {
    id: "borno_teachers_service_board_candidate",
    jurisdiction: "Borno State, Nigeria",
    institutionType: "public_secondary",
    institutionLabel: "Public school teachers (candidate relationship)",
    authorityType: "teacher_service_authority",
    authorityLabel: "TESCOM / teachers service authority (candidate; division unconfirmed)",
    effectiveFrom: null,
    effectiveTo: null,
    source: relationshipSource,
    evidence_url: relationshipEvidenceUrl,
    verification_status: "unverified",
    notes: relationshipNotes,
  },
  {
    id: "borno_senior_secondary_board_candidate",
    jurisdiction: "Borno State, Nigeria",
    institutionType: "public_secondary",
    institutionLabel: "Senior secondary institutions (candidate relationship)",
    authorityType: "education_board",
    authorityLabel: "BSSSEB / secondary education board (candidate; scope unverified)",
    effectiveFrom: null,
    effectiveTo: null,
    source: relationshipSource,
    evidence_url: relationshipEvidenceUrl,
    verification_status: "unverified",
    notes: relationshipNotes,
  },
  {
    id: "borno_sangaya_board_candidate",
    jurisdiction: "Borno State, Nigeria",
    institutionType: "islamiyya_sangaya",
    institutionLabel: "Sangaya / Islamiyya-type institution (candidate relationship)",
    authorityType: "education_board",
    authorityLabel: "Relevant board (candidate authority; identity and mandate unverified)",
    effectiveFrom: null,
    effectiveTo: null,
    source: relationshipSource,
    evidence_url: relationshipEvidenceUrl,
    verification_status: "unverified",
    notes: relationshipNotes,
  },
  {
    id: "borno_private_school_ministry_candidate",
    jurisdiction: "Borno State, Nigeria",
    institutionType: "private_primary",
    institutionLabel: "Private schools (candidate relationship)",
    authorityType: "education_ministry_or_agency",
    authorityLabel: "Education ministry or agency (candidate authority; mandate unverified)",
    effectiveFrom: null,
    effectiveTo: null,
    source: relationshipSource,
    evidence_url: relationshipEvidenceUrl,
    verification_status: "unverified",
    notes: relationshipNotes,
  },
] as const;

export const ROLE_TEMPLATE_CATALOG = {
  version: ROLE_TEMPLATE_CATALOG_VERSION,
  institutionTypes,
  templates: roleTemplates,
  relationships: INSTITUTION_AUTHORITY_RELATIONSHIPS,
} as const;

export function validateRoleTemplateCatalog(): string[] {
  const parsed = ROLE_TEMPLATE_CATALOG_SCHEMA.safeParse(ROLE_TEMPLATE_CATALOG);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  }

  const issues: string[] = [];
  const permissionIds = new Set(Object.keys(NG_PERMISSIONS));
  const roleIds = new Set(ROLE_TEMPLATE_CATALOG.templates.map(({ id }) => id));
  if (new Set(roleIds).size !== ROLE_TEMPLATE_CATALOG.templates.length) {
    issues.push("role template ids must be unique");
  }

  for (const [responsibilityId, responsibility] of Object.entries(RESPONSIBILITY_CATALOG)) {
    if (!permissionIds.has(responsibility.permissionId)) {
      issues.push(
        `${responsibilityId}: permission "${responsibility.permissionId}" is not defined`,
      );
    }
  }

  for (const template of ROLE_TEMPLATE_CATALOG.templates) {
    const ownResponsibilities = new Set([
      ...template.coreResponsibilities,
      ...template.optionalAddOnResponsibilities,
    ]);
    if (
      ownResponsibilities.size !==
      template.coreResponsibilities.length + template.optionalAddOnResponsibilities.length
    ) {
      issues.push(`${template.id}: responsibility ids must not be duplicated`);
    }
    if (template.primaryDailyResponsibilities.length !== 3) {
      issues.push(`${template.id}: exactly three daily responsibilities are required`);
    }
    for (const responsibilityId of template.primaryDailyResponsibilities) {
      if (!ownResponsibilities.has(responsibilityId)) {
        issues.push(
          `${template.id}: daily responsibility "${responsibilityId}" is not assigned to the template`,
        );
      }
    }
    if (!CATEGORY_DATA_SCOPES[template.category].includes(template.dataAccessScope)) {
      issues.push(
        `${template.id}: data scope "${template.dataAccessScope}" exceeds category scope`,
      );
    }
    for (const variant of template.approvalAuthorityByInstitutionType ?? []) {
      for (const institutionType of variant.institutionTypes) {
        if (!template.institutionTypes.includes(institutionType)) {
          issues.push(
            `${template.id}: authority variant references unsupported institution type "${institutionType}"`,
          );
        }
      }
    }
    for (const responsibilityId of ownResponsibilities) {
      const responsibility = RESPONSIBILITY_CATALOG[responsibilityId];
      const allowedScopes: readonly DataAccessScope[] = responsibility.allowedScopes;
      if (!allowedScopes.includes(template.dataAccessScope)) {
        issues.push(
          `${template.id}: "${responsibilityId}" is not valid at "${template.dataAccessScope}" scope`,
        );
      }
    }
    for (const reportTo of template.reportsTo) {
      if (!roleIds.has(reportTo))
        issues.push(`${template.id}: unknown reporting role "${reportTo}"`);
    }
    for (const [ruleId, [left, right]] of Object.entries(SOD_RULES)) {
      if (ownResponsibilities.has(left) && ownResponsibilities.has(right)) {
        issues.push(`${template.id}: responsibilities violate SoD rule "${ruleId}"`);
      }
    }
  }

  for (const relationship of ROLE_TEMPLATE_CATALOG.relationships) {
    if (!relationship.verification_status) {
      issues.push(`${relationship.id}: verification_status is required`);
    }
  }

  return issues;
}

export function composeCustomRole(responsibilityIds: readonly string[]): {
  responsibilityIds: readonly ResponsibilityId[];
  permissionIds: readonly string[];
} {
  const uniqueIds = [...new Set(responsibilityIds)];
  const unknownIds = uniqueIds.filter(
    (id): id is string => !Object.hasOwn(RESPONSIBILITY_CATALOG, id),
  );
  if (unknownIds.length > 0) {
    throw new Error(`Unknown catalog responsibilities: ${unknownIds.join(", ")}`);
  }

  const validIds = uniqueIds as ResponsibilityId[];
  const conflictingRule = Object.entries(SOD_RULES).find(
    ([, [left, right]]) => validIds.includes(left) && validIds.includes(right),
  );
  if (conflictingRule) {
    throw new Error(`Custom role responsibilities violate SoD rule "${conflictingRule[0]}"`);
  }

  return {
    responsibilityIds: validIds,
    permissionIds: [...new Set(validIds.map((id) => RESPONSIBILITY_CATALOG[id].permissionId))],
  };
}

export function renderRoleCatalogMarkdown(): string {
  const templateRows = ROLE_TEMPLATE_CATALOG.templates
    .map(
      (template) =>
        `| ${template.title} | ${template.category} | ${template.enabled ? "Enabled" : "Disabled"} | ${template.dataAccessScope} |`,
    )
    .join("\n");
  const relationshipRows = ROLE_TEMPLATE_CATALOG.relationships
    .map(
      (relationship) =>
        `| ${relationship.institutionLabel} | ${relationship.authorityLabel} | ${relationship.verification_status} |`,
    )
    .join("\n");

  return `# Role template catalog

Version: ${ROLE_TEMPLATE_CATALOG.version} (V1 organizational capability envelope)

This is a data catalog, not an assignment or authorization mechanism. Enabled templates are limited to the approved V1 institution roles; disabled templates cannot be assigned. Candidate authority, tertiary-office, and Sangaya/Islamiyya templates have mandate_status unverified and cannot be assigned; no legal mandate is asserted. All permissions refer to existing catalog primitives. Qualification and registration entries are placeholders pending local verification.

## Institution types

${ROLE_TEMPLATE_CATALOG.institutionTypes.map((type) => `- \`${type}\``).join("\n")}

## Role templates

| Template | Workspace category | V1 status | Default data scope |
|---|---|---|---|
${templateRows}

## Candidate Borno State institution-authority relationships

All rows below are unverified candidates with no asserted mandate. Official names, responsibilities, and mandates must be confirmed before use. Effective dates are unset because none are verified.

| Institution candidate | Authority candidate | Verification |
|---|---|---|
${relationshipRows}
`;
}
