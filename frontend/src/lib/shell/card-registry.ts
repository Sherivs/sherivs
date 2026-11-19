/**
 * Card registry (mission M3, ADR-106): every workspace card is a contract.
 *
 * Each key that the shell can open at `/home/s/<key>` has exactly one entry here. An entry says
 * which screen renders it, which server functions and tables back it, which permissions and scope
 * dimensions gate it, which audit events it writes, whether it works offline, and whether it is
 * `live` (a real screen exists) or `planned` (an honest planned-capability state is shown).
 *
 * Rules:
 * - A `live` entry has a lazy `screen` loader and a `screenModule` path; screens stay out of the
 *   /home static bundle because they are loaded only when the section opens.
 * - A `planned` entry has no screen, no server functions and no tables: nothing is claimed that does
 *   not exist. Its permissions and scope dimensions come from the catalogue mirror so the contract
 *   is complete before the screen is built.
 * - `tests/unit/card-registry-coverage.test.ts` fails when a catalogue key (from the checked-in
 *   production snapshot) has no entry, or when a `live` entry has no screen or no test that
 *   references its screen module.
 */
import type { ComponentType } from "react";
import { catalogItem, type ItemKind } from "@/lib/sherivs-ws/engine";

export type CardStatus = "live" | "planned";
/** `section` = a shell section that is not a catalogue item (opened from the drawer or a screen). */
export type CardKind = ItemKind | "section";
export type ScreenModule = { default: ComponentType };
export type ScreenLoader = () => Promise<ScreenModule>;

export interface CardPermissions {
  any?: string[];
  all?: string[];
}

export interface CardContract {
  key: string;
  kind: CardKind;
  status: CardStatus;
  /** Lazy loader for the real screen; null for planned cards. */
  screen: ScreenLoader | null;
  /** Repository path of the screen module (without extension); null for planned cards. */
  screenModule: string | null;
  /** Server functions (`fn:<name>`) and database RPCs (`rpc:<name>`) the screen calls. */
  serverFns: string[];
  /** Tables the screen reads or writes directly. */
  tables: string[];
  permissions: CardPermissions;
  scopeDims: string[];
  /** Audit event names the screen writes; empty when none are catalogued yet. */
  auditEvents: string[];
  offline: boolean;
}

const APP_SHELL = "frontend/src/components/app-shell";

type LiveSpec = Omit<CardContract, "key" | "status" | "kind" | "scopeDims" | "permissions"> & {
  kind?: CardKind;
  permissions?: CardPermissions;
  scopeDims?: string[];
};

const roleManagement: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/role-management-screen").then((m) => ({
      default: m.RoleManagementScreen,
    })),
  screenModule: `${APP_SHELL}/role-management-screen`,
  serverFns: ["rpc:can_manage_roles", "rpc:role_create_custom", "rpc:role_unassign"],
  tables: [
    "role_catalog",
    "user_role_assignments",
    "users",
    "workspace_org_units",
    "workspace_responsibility_catalog",
    "workspace_role_responsibilities",
    "workspace_responsibility_permissions",
    "role_assignment_responsibility_grants",
    "role_assignment_delegations",
    "role_assignment_audit_events",
    "institution_authority_links",
  ],
  permissions: { any: ["roles.assign", "roles.configure"] },
  auditEvents: [],
  offline: false,
};

const orgAgents: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/org-workforce-screens").then((m) => ({
      default: m.OrgAgentsScreen,
    })),
  screenModule: `${APP_SHELL}/org-workforce-screens`,
  serverFns: ["rpc:change_org_agent"],
  tables: ["user_role_assignments"],
  auditEvents: [],
  offline: false,
};

const rolePackets: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/org-workforce-screens").then((m) => ({
      default: m.RolePacketScreen,
    })),
  screenModule: `${APP_SHELL}/org-workforce-screens`,
  serverFns: [
    "rpc:role_context",
    "rpc:role_set_optional",
    "rpc:role_add_custom_grant",
    "rpc:role_remove_custom_grant",
  ],
  tables: ["role_catalog", "permission_catalog"],
  auditEvents: [],
  offline: false,
};

const workspacePolicies: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/org-workforce-screens").then((m) => ({
      default: m.WorkspacePolicyScreen,
    })),
  screenModule: `${APP_SHELL}/org-workforce-screens`,
  serverFns: ["rpc:workspace_policy_list", "rpc:workspace_policy_set", "rpc:workspace_feature_set"],
  tables: [],
  auditEvents: [],
  offline: false,
};

const institutionInterview: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/institution-interview-screen").then((m) => ({
      default: m.InstitutionInterviewScreen as ComponentType,
    })),
  screenModule: `${APP_SHELL}/institution-interview-screen`,
  serverFns: [
    "fn:getInterview",
    "fn:submitInterviewAnswer",
    "fn:clearInterviewAnswer",
    "fn:approveInterviewAnswers",
  ],
  tables: [],
  auditEvents: [],
  offline: false,
};

const communicationInbox: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/communication-inbox").then((m) => ({
      default: m.CommunicationInboxScreen,
    })),
  screenModule: `${APP_SHELL}/communication-inbox`,
  serverFns: ["rpc:scholar_can", "rpc:comms_approve_send", "rpc:comms_reject_send"],
  tables: ["outbound_messages", "inbound_messages", "comms_send_proposals"],
  auditEvents: [],
  offline: false,
};

const mobility: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/student-mobility-screen").then((m) => ({
      default: m.StudentMobilityScreen,
    })),
  screenModule: `${APP_SHELL}/student-mobility-screen`,
  serverFns: [
    "fn:getMobilityAdvisory",
    "rpc:scholar_can",
    "rpc:student_mobility_preview",
    "rpc:student_mobility_request",
    "rpc:student_mobility_reschedule",
    "rpc:student_mobility_bulk_preview",
    "rpc:student_mobility_bulk_request",
  ],
  tables: [
    "students",
    "classes",
    "campuses",
    "school_sections",
    "school_shifts",
    "fees",
    "student_placements",
    "student_mobility_requests",
    "student_mobility_approvals",
    "student_mobility_events",
    "student_mobility_rules",
    "student_mobility_fee_allocations",
    "users",
  ],
  auditEvents: [],
  offline: false,
};

const ascExport: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/asc-export-screen").then((m) => ({
      default: m.AscExportScreen,
    })),
  screenModule: `${APP_SHELL}/asc-export-screen`,
  serverFns: ["fn:exportAscFile"],
  tables: [],
  auditEvents: [],
  offline: false,
};

const privacyRegister: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/privacy-register-screen").then((m) => ({
      default: m.PrivacyRegisterScreen,
    })),
  screenModule: `${APP_SHELL}/privacy-register-screen`,
  serverFns: [
    "fn:loadPrivacyRegister",
    "fn:saveRopaActivity",
    "fn:saveDpia",
    "fn:signOffDpia",
    "fn:reviewPlatformRopa",
    "fn:exportPrivacyRegister",
    "rpc:privacy_register_snapshot",
    "rpc:privacy_register_export",
    "rpc:dpia_approve",
  ],
  tables: ["ropa_processing_activities", "privacy_register_audit_events"],
  auditEvents: ["dpia.signed_off"],
  offline: false,
};

const roleBuilder: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/custom-role-builder-screen").then((m) => ({
      default: m.CustomRoleBuilderScreen,
    })),
  screenModule: `${APP_SHELL}/custom-role-builder-screen`,
  serverFns: [
    "fn:loadRoleBuilder",
    "fn:previewCustomRole",
    "fn:simulateCustomRole",
    "fn:saveCustomRoleDraft",
    "fn:submitCustomRole",
    "fn:withdrawCustomRole",
    "fn:approveCustomRole",
    "fn:activateCustomRole",
    "fn:customRoleHistory",
    "fn:defineCustomResponsibility",
    "rpc:custom_role_save_draft",
    "rpc:custom_role_submit",
    "rpc:custom_role_withdraw",
    "rpc:custom_role_approve",
    "rpc:custom_role_activate",
    "rpc:workspace_responsibility_define",
  ],
  tables: [
    "org_custom_roles",
    "permission_catalog",
    "role_templates",
    "role_template_permissions",
    "sod_permission_rules",
    "role_catalog",
    "institution_profile",
    "workspace_responsibility_catalog",
    "workspace_responsibility_permissions",
    "audit_logs",
  ],
  permissions: { any: ["roles.configure", "roles.custom_create"] },
  auditEvents: [
    "scholar.org_custom_roles.insert",
    "scholar.org_custom_roles.update",
    "role_assignment_audit_events",
  ],
  offline: false,
};

const accessReviews: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/access-review-screen").then((m) => ({
      default: m.AccessReviewScreen,
    })),
  screenModule: `${APP_SHELL}/access-review-screen`,
  serverFns: [
    "fn:listAccessReviews",
    "fn:startAccessReview",
    "fn:decideAccessReviewItem",
    "rpc:workspace_access_review_campaign_create",
    "rpc:workspace_access_review_decide",
  ],
  tables: [
    "role_access_review_campaigns",
    "role_access_review_items",
    "role_access_review_audit_events",
    "users",
    "role_catalog",
  ],
  permissions: { any: ["roles.assign"] },
  auditEvents: [
    "campaign_created",
    "assignment_retained",
    "assignment_revoked",
    "campaign_completed",
  ],
  offline: false,
};

const delegations: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/delegation-screen").then((m) => ({
      default: m.DelegationScreen,
    })),
  screenModule: `${APP_SHELL}/delegation-screen`,
  serverFns: [
    "fn:listDelegations",
    "fn:grantDelegation",
    "fn:revokeDelegation",
    "rpc:workspace_role_delegate",
    "rpc:workspace_role_delegation_revoke",
  ],
  tables: ["user_role_assignments", "role_assignment_delegations", "users", "role_catalog"],
  permissions: { any: ["roles.assign"] },
  auditEvents: ["role_assignment_audit_events"],
  offline: false,
};

const cashierDesk: LiveSpec = {
  screen: () =>
    import("@/components/app-shell/cashier-desk-screen").then((m) => ({
      default: m.CashierDeskScreen,
    })),
  screenModule: `${APP_SHELL}/cashier-desk-screen`,
  serverFns: [
    "fn:getCashierDesk",
    "fn:recordCashierPayment",
    "fn:closeCashierDay",
    "rpc:cg_fee_record_payment",
    "rpc:cg_fee_close_cash_day",
  ],
  tables: [
    "cg_fee_invoice_balances",
    "cg_fee_invoice",
    "cg_fee_payment",
    "cg_fee_receipt",
    "cg_fee_cash_day_close",
  ],
  auditEvents: ["cash.recorded", "day.closed"],
  offline: true,
};

/** Keys with a real screen. Shell sections outside the catalogue are `kind: "section"`. */
const LIVE: Record<string, LiveSpec> = {
  roles: { ...roleManagement, kind: "section" },
  agents: { ...orgAgents, kind: "section" },
  "role-packets": { ...rolePackets, kind: "section" },
  "workspace-policies": { ...workspacePolicies, kind: "section" },
  "role-builder": { ...roleBuilder, kind: "section" },
  "access-reviews": { ...accessReviews, kind: "section" },
  delegations: { ...delegations, kind: "section" },
  school_setup: { ...institutionInterview, kind: "section" },
  communications: { ...communicationInbox, kind: "section" },
  privacy: { ...privacyRegister, kind: "section" },
  "privacy-register": { ...privacyRegister, kind: "section" },
  "r001.org_admin.ndpa": { ...privacyRegister, kind: "section" },
  students: { ...mobility, kind: "section", permissions: { any: ["students.view"] } },
  "nav.students": mobility,
  "nav.reports": ascExport,
  "a.record_cash": cashierDesk,
};

/**
 * Catalogue keys without a real screen yet, as listed by `public.workspace_item_catalog` on
 * production (snapshot `tests/fixtures/workspace-item-catalog.snapshot.json`, 2026-11-17).
 */
export const PLANNED_CATALOGUE_KEYS = [
  "a.approve_payroll",
  "a.ask_tutor",
  "a.assign_role",
  "a.broadcast",
  "a.enrol_student",
  "a.enter_scores",
  "a.gov_inspect",
  "a.issue_book",
  "a.issue_receipt",
  "a.log_visit",
  "a.message_parents",
  "a.new_cbt",
  "a.pay_fees",
  "a.prepare_payroll",
  "a.publish_results",
  "a.report_incident",
  "a.request_leave",
  "a.roll_call",
  "a.schedule_exam",
  "a.sign_in_visitor",
  "a.start_trip",
  "a.submit_note",
  "a.take_attendance",
  "a.topup_wallet",
  "i.alerts",
  "i.approvals",
  "i.messages",
  "i.payments",
  "i.safeguarding",
  "nav.admissions",
  "nav.ai_tutor",
  "nav.attendance",
  "nav.cbt",
  "nav.children",
  "nav.exams",
  "nav.fees",
  "nav.gov",
  "nav.gradebook",
  "nav.health",
  "nav.home",
  "nav.hostel",
  "nav.lesson_notes",
  "nav.library",
  "nav.messages",
  "nav.my_classes",
  "nav.my_pay",
  "nav.my_results",
  "nav.payroll",
  "nav.roles",
  "nav.settings",
  "nav.staff",
  "nav.transport",
  "nav.visitors",
  "nav.wallet",
  "nav.workspace_policies",
  "w.admissions_funnel",
  "w.ai_lesson_helper",
  "w.ai_tutor",
  "w.announcements",
  "w.at_risk",
  "w.attendance_todo",
  "w.bus_live",
  "w.campus_overview",
  "w.cashflow",
  "w.cbt_sessions",
  "w.child_bus",
  "w.child_fees",
  "w.children_summary",
  "w.defaulters",
  "w.dept_performance",
  "w.enrolment",
  "w.exam_timetable",
  "w.expense_approvals",
  "w.fee_collection",
  "w.form_class",
  "w.gate_log",
  "w.gov_compliance",
  "w.gov_overview",
  "w.governance",
  "w.grading_queue",
  "w.hostel_beds",
  "w.hostel_roll",
  "w.house_overview",
  "w.incidents",
  "w.leave_requests",
  "w.lesson_note_approvals",
  "w.lesson_note_status",
  "w.level_overview",
  "w.library_loans",
  "w.malpractice",
  "w.my_cbt",
  "w.my_results",
  "w.my_timetable",
  "w.my_trip",
  "w.payroll_run",
  "w.reconciliation",
  "w.results_pipeline",
  "w.school_health",
  "w.section_overview",
  "w.shift_overview",
  "w.sick_bay",
  "w.staff_attendance",
  "w.today_classes",
  "w.wallet_balance",
] as const;

function kindFromKey(key: string): CardKind {
  if (key.startsWith("nav.")) return "nav";
  if (key.startsWith("w.")) return "widget";
  if (key.startsWith("a.")) return "action";
  if (key.startsWith("i.")) return "inbox";
  return "section";
}

function catalogueGates(key: string): Pick<CardContract, "permissions" | "scopeDims"> {
  const item = catalogItem(key);
  const permissions: CardPermissions = {};
  if (item?.any.length) permissions.any = [...item.any];
  if (item?.all.length) permissions.all = [...item.all];
  return { permissions, scopeDims: item ? [...item.scopeDims] : [] };
}

function liveEntry(key: string, spec: LiveSpec): CardContract {
  const gates = catalogueGates(key);
  return {
    key,
    kind: spec.kind ?? catalogItem(key)?.kind ?? kindFromKey(key),
    status: "live",
    screen: spec.screen,
    screenModule: spec.screenModule,
    serverFns: [...spec.serverFns],
    tables: [...spec.tables],
    permissions: spec.permissions ?? gates.permissions,
    scopeDims: spec.scopeDims ?? gates.scopeDims,
    auditEvents: [...spec.auditEvents],
    offline: spec.offline,
  };
}

export function plannedEntry(key: string): CardContract {
  return {
    key,
    kind: catalogItem(key)?.kind ?? kindFromKey(key),
    status: "planned",
    screen: null,
    screenModule: null,
    serverFns: [],
    tables: [],
    ...catalogueGates(key),
    auditEvents: [],
    offline: false,
  };
}

export const CARD_REGISTRY: Readonly<Record<string, CardContract>> = Object.freeze({
  ...Object.fromEntries(PLANNED_CATALOGUE_KEYS.map((key) => [key, plannedEntry(key)])),
  ...Object.fromEntries(Object.entries(LIVE).map(([key, spec]) => [key, liveEntry(key, spec)])),
});

export function cardContract(key: string): CardContract | null {
  return Object.prototype.hasOwnProperty.call(CARD_REGISTRY, key) ? CARD_REGISTRY[key]! : null;
}

export type CardResolution =
  | { kind: "live"; contract: CardContract & { screen: ScreenLoader } }
  | { kind: "planned"; contract: CardContract }
  | { kind: "unknown"; key: string };

/** Dispatch rule used by the section screen: live -> screen, planned -> planned state, else not found. */
export function resolveCard(
  key: string,
  registry: Readonly<Record<string, CardContract>> = CARD_REGISTRY,
): CardResolution {
  const contract = Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : undefined;
  if (!contract) return { kind: "unknown", key };
  if (contract.status === "live" && contract.screen) {
    return { kind: "live", contract: contract as CardContract & { screen: ScreenLoader } };
  }
  return { kind: "planned", contract };
}

export interface RegistryCoverageInput {
  catalogueKeys: readonly string[];
  registry: Readonly<Record<string, CardContract>>;
  /** Does some test file (other than the coverage test itself) reference this screen module? */
  hasTestFor: (screenModule: string) => boolean;
}

/** Pure coverage check so the CI test can prove it fails on a fake key. */
export function registryCoverageIssues(input: RegistryCoverageInput): string[] {
  const issues: string[] = [];
  for (const key of input.catalogueKeys) {
    if (!Object.prototype.hasOwnProperty.call(input.registry, key)) {
      issues.push(`${key}: catalogue key has no card-registry entry`);
    }
  }
  for (const [key, contract] of Object.entries(input.registry)) {
    if (contract.key !== key) issues.push(`${key}: entry key mismatch (${contract.key})`);
    if (contract.status === "live") {
      if (!contract.screen || !contract.screenModule) {
        issues.push(`${key}: live entry has no screen`);
      } else if (!input.hasTestFor(contract.screenModule)) {
        issues.push(`${key}: live screen ${contract.screenModule} has no test referencing it`);
      }
    } else if (
      contract.screen ||
      contract.screenModule ||
      contract.serverFns.length ||
      contract.tables.length
    ) {
      issues.push(`${key}: planned entry must not claim a screen, server functions or tables`);
    }
  }
  return issues;
}
