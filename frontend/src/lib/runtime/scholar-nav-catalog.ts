/**
 * Sherivs — installed runtime navigation contribution (runtime layer).
 *
 * A runtime publishes the navigation it owns as DATA: capability-coded items with no UI
 * logic, resolved by the kernel's workspace engine. This file is one runtime's
 * contribution and lives in the runtime layer, because the KERNEL holds no navigation
 * data of its own — it renders what installed runtimes contribute, so adding a runtime
 * adds its navigation without touching the shell or the kernel.
 *
 * Labels here are display data owned by the contributing runtime. The icons are registry
 * KEYS; the UI maps keys to components.
 */
import type { NavContribution } from "@/lib/workspace-engine/navigation";
import type { AppRole } from "@/lib/roles";
import { resolveWorkspaceHome, resolveWorkspaceNav } from "@/lib/workspace-engine/navigation";

export const RUNTIME_SCHOLAR = "runtime:scholar";

export type ScholarPortalKind = "parent" | "student";

/** R-001 portal capability codes (authorization data, P08 resolves later). */
const P = "r001:parent";
const S = "r001:student";

export const SCHOLAR_PORTAL_CAPABILITIES: Readonly<Record<ScholarPortalKind, readonly string[]>> = {
  parent: [
    `${P}.dashboard`,
    `${P}.children`,
    `${P}.grades`,
    `${P}.attendance`,
    `${P}.fees`,
    `${P}.report_cards`,
    `${P}.bus`,
    `${P}.ai_assistant`,
    `${P}.calendar`,
    `${P}.news`,
    `${P}.messages`,
    `${P}.notifications`,
    `${P}.settings`,
  ],
  student: [
    `${S}.dashboard`,
    `${S}.timetable`,
    `${S}.grades`,
    `${S}.attendance`,
    `${S}.report_card`,
    `${S}.fees`,
    `${S}.ai_tutor`,
    `${S}.calendar`,
    `${S}.news`,
    `${S}.messages`,
    `${S}.notifications`,
    `${S}.settings`,
    `${S}.cbt`,
    `${S}.course_registration`,
  ],
};

/** Initial allowed set for a Scholar portal member (legacy role substitute). */
export function scholarCapabilitiesForPortal(kind: ScholarPortalKind): ReadonlySet<string> {
  return new Set(SCHOLAR_PORTAL_CAPABILITIES[kind]);
}

/**
 * Scholar R-001 contribution seeds. item.orderHint 0–4 select the mobile
 * quick-nav; higher hints feed the full workspace sidebar later.
 */
export const SCHOLAR_NAV_CONTRIBUTIONS: readonly NavContribution[] = [
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "scholar",
    sectionLabel: "Scholar workspace",
    items: [
      {
        key: "r001.parent.dashboard",
        label: "Home",
        iconKey: "home",
        url: "/parent/dashboard",
        capabilities: [`${P}.dashboard`],
        orderHint: 0,
      },
      {
        key: "r001.parent.children",
        label: "Children",
        iconKey: "children",
        url: "/parent/children",
        capabilities: [`${P}.children`],
        orderHint: 1,
      },
      {
        key: "r001.parent.fees",
        label: "Fees",
        iconKey: "fees",
        url: "/parent/fees",
        capabilities: [`${P}.fees`],
        orderHint: 2,
      },
      {
        key: "r001.parent.bus",
        label: "Bus",
        iconKey: "bus",
        url: "/parent/bus-tracking",
        capabilities: [`${P}.bus`],
        orderHint: 3,
      },
      {
        key: "r001.parent.ai",
        label: "AI Assistant",
        iconKey: "ai",
        url: "/parent/ai-assistant",
        capabilities: [`${P}.ai_assistant`],
        orderHint: 4,
      },
      {
        key: "r001.parent.grades",
        label: "Grades",
        iconKey: "grades",
        url: "/parent/grades",
        capabilities: [`${P}.grades`],
        orderHint: 10,
      },
      {
        key: "r001.parent.attendance",
        label: "Attendance",
        iconKey: "attendance",
        url: "/parent/attendance",
        capabilities: [`${P}.attendance`],
        orderHint: 11,
      },
      {
        key: "r001.parent.report_cards",
        label: "Report cards",
        iconKey: "report",
        url: "/parent/report-cards",
        capabilities: [`${P}.report_cards`],
        orderHint: 12,
      },
      {
        key: "r001.parent.calendar",
        label: "Calendar",
        iconKey: "calendar",
        url: "/parent/calendar",
        capabilities: [`${P}.calendar`],
        orderHint: 13,
      },
      {
        key: "r001.parent.news",
        label: "News",
        iconKey: "news",
        url: "/parent/news",
        capabilities: [`${P}.news`],
        orderHint: 14,
      },
      {
        key: "r001.parent.messages",
        label: "Messages",
        iconKey: "messages",
        url: "/messages",
        capabilities: [`${P}.messages`],
        orderHint: 15,
      },
      {
        key: "r001.parent.notifications",
        label: "Notifications",
        iconKey: "notifications",
        url: "/notifications",
        capabilities: [`${P}.notifications`],
        orderHint: 16,
      },
      {
        key: "r001.parent.settings",
        label: "Settings",
        iconKey: "settings",
        url: "/settings",
        capabilities: [`${P}.settings`],
        orderHint: 17,
      },

      {
        key: "r001.student.dashboard",
        label: "Home",
        iconKey: "home",
        url: "/student/dashboard",
        capabilities: [`${S}.dashboard`],
        orderHint: 0,
      },
      {
        key: "r001.student.timetable",
        label: "Timetable",
        iconKey: "timetable",
        url: "/student/timetable",
        capabilities: [`${S}.timetable`],
        orderHint: 1,
      },
      {
        key: "r001.student.grades",
        label: "Grades",
        iconKey: "grades",
        url: "/student/grades",
        capabilities: [`${S}.grades`],
        orderHint: 2,
      },
      {
        key: "r001.student.ai_tutor",
        label: "AI Tutor",
        iconKey: "ai",
        url: "/student/ai-tutor",
        capabilities: [`${S}.ai_tutor`],
        orderHint: 3,
      },
      {
        key: "r001.student.fees",
        label: "Fees",
        iconKey: "fees",
        url: "/student/fees",
        capabilities: [`${S}.fees`],
        orderHint: 4,
      },
      {
        key: "r001.student.attendance",
        label: "Attendance",
        iconKey: "attendance",
        url: "/student/attendance",
        capabilities: [`${S}.attendance`],
        orderHint: 10,
      },
      {
        key: "r001.student.report_card",
        label: "Report Card",
        iconKey: "report",
        url: "/student/report-card",
        capabilities: [`${S}.report_card`],
        orderHint: 11,
      },
      {
        key: "r001.student.calendar",
        label: "Calendar",
        iconKey: "calendar",
        url: "/student/calendar",
        capabilities: [`${S}.calendar`],
        orderHint: 12,
      },
      {
        key: "r001.student.news",
        label: "News",
        iconKey: "news",
        url: "/student/news",
        capabilities: [`${S}.news`],
        orderHint: 13,
      },
      {
        key: "r001.student.messages",
        label: "Messages",
        iconKey: "messages",
        url: "/messages",
        capabilities: [`${S}.messages`],
        orderHint: 14,
      },
      {
        key: "r001.student.notifications",
        label: "Notifications",
        iconKey: "notifications",
        url: "/notifications",
        capabilities: [`${S}.notifications`],
        orderHint: 15,
      },
      {
        key: "r001.student.settings",
        label: "Settings",
        iconKey: "settings",
        url: "/settings",
        capabilities: [`${S}.settings`],
        orderHint: 16,
      },
      {
        key: "r001.student.cbt",
        label: "CBT exams",
        iconKey: "grades",
        url: "/student/cbt",
        capabilities: [`${S}.cbt`],
        orderHint: 17,
      },
      {
        key: "r001.student.course_registration",
        label: "Course registration",
        iconKey: "academic",
        url: "/student/course-registration",
        capabilities: [`${S}.course_registration`],
        orderHint: 18,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "teacher",
    sectionLabel: "Teacher workspace",
    items: [
      {
        key: "r001.teacher.dashboard",
        label: "Dashboard",
        iconKey: "dashboard",
        url: "/teacher/dashboard",
        capabilities: ["r001:teacher.dashboard"],
        orderHint: 0,
      },
      {
        key: "r001.teacher.signin",
        label: "My Sign-in",
        iconKey: "signin",
        url: "/teacher/sign-in",
        capabilities: ["r001:teacher.signin"],
        orderHint: 1,
      },
      {
        key: "r001.teacher.attendance",
        label: "Mark Attendance",
        iconKey: "attendance",
        url: "/teacher/attendance",
        capabilities: ["r001:teacher.attendance"],
        orderHint: 3,
      },
      {
        key: "r001.teacher.attendance_week",
        label: "Weekly attendance",
        iconKey: "attendance",
        url: "/teacher/attendance-week",
        capabilities: ["r001:teacher.attendance_week"],
        orderHint: 4,
      },
      {
        key: "r001.teacher.timetable",
        label: "Timetable",
        iconKey: "timetable",
        url: "/teacher/timetable",
        capabilities: ["r001:teacher.timetable"],
        orderHint: 5,
      },
      {
        key: "r001.teacher.grades",
        label: "Grades",
        iconKey: "grades",
        url: "/teacher/grades",
        capabilities: ["r001:teacher.grades"],
        orderHint: 6,
      },
      {
        key: "r001.teacher.gradebook",
        label: "Gradebook",
        iconKey: "grades",
        url: "/teacher/gradebook",
        capabilities: ["r001:teacher.gradebook"],
        orderHint: 7,
      },
      {
        key: "r001.teacher.lesson_plans",
        label: "Lesson plans",
        iconKey: "lessons",
        url: "/teacher/lesson-plans",
        capabilities: ["r001:teacher.lesson_plans"],
        orderHint: 8,
      },
      {
        key: "r001.teacher.classes",
        label: "My Classes",
        iconKey: "users",
        url: "/teacher/class-intelligence",
        capabilities: ["r001:teacher.classes"],
        orderHint: 9,
      },
      {
        key: "r001.teacher.ai",
        label: "AI Assistant",
        iconKey: "ai",
        url: "/teacher/ai-assistant",
        capabilities: ["r001:teacher.ai"],
        orderHint: 10,
      },
      {
        key: "r001.teacher.calendar",
        label: "Calendar",
        iconKey: "calendar",
        url: "/teacher/calendar",
        capabilities: ["r001:teacher.calendar"],
        orderHint: 11,
      },
      {
        key: "r001.teacher.news",
        label: "News",
        iconKey: "news",
        url: "/teacher/news",
        capabilities: ["r001:teacher.news"],
        orderHint: 12,
      },
      {
        key: "r001.teacher.messages",
        label: "Messages",
        iconKey: "messages",
        url: "/messages",
        capabilities: ["r001:teacher.messages"],
        orderHint: 13,
      },
      {
        key: "r001.teacher.broadcast",
        label: "Broadcast",
        iconKey: "broadcast",
        url: "/admin/broadcast",
        capabilities: ["r001:teacher.broadcast"],
        orderHint: 14,
      },
      {
        key: "r001.teacher.notifications",
        label: "Notifications",
        iconKey: "notifications",
        url: "/notifications",
        capabilities: ["r001:teacher.notifications"],
        orderHint: 15,
      },
      {
        key: "r001.teacher.settings",
        label: "Settings",
        iconKey: "settings",
        url: "/settings",
        capabilities: ["r001:teacher.settings"],
        orderHint: 16,
      },
      {
        key: "r001.teacher.lesson_notes",
        label: "Lesson notes",
        iconKey: "lessons",
        url: "/teacher/lesson-notes",
        capabilities: ["r001:teacher.lesson_notes"],
        orderHint: 17,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "bursar",
    sectionLabel: "Bursar workspace",
    items: [
      {
        key: "r001.bursar.dashboard",
        label: "Dashboard",
        iconKey: "dashboard",
        url: "/bursar/dashboard",
        capabilities: ["r001:bursar.dashboard"],
        orderHint: 0,
      },
      {
        key: "r001.bursar.receipts",
        label: "Receipts",
        iconKey: "receipts",
        url: "/bursar/receipts",
        capabilities: ["r001:bursar.receipts"],
        orderHint: 1,
      },
      {
        key: "r001.bursar.reports",
        label: "Reports",
        iconKey: "reports",
        url: "/bursar/reports",
        capabilities: ["r001:bursar.reports"],
        orderHint: 2,
      },
      {
        key: "r001.bursar.reconciliation",
        label: "Reconciliation",
        iconKey: "receipts",
        url: "/bursar/reconciliation",
        capabilities: ["r001:bursar.reconciliation"],
        orderHint: 3,
      },
      {
        key: "r001.bursar.fee_plans",
        label: "Fee Plans",
        iconKey: "timetable",
        url: "/bursar/fee-plans",
        capabilities: ["r001:bursar.fee_plans"],
        orderHint: 4,
      },
      {
        key: "r001.bursar.financial",
        label: "Financial Intelligence",
        iconKey: "ai",
        url: "/bursar/financial-intelligence",
        capabilities: ["r001:bursar.financial"],
        orderHint: 5,
      },
      {
        key: "r001.bursar.all_fees",
        label: "All Fees",
        iconKey: "fees",
        url: "/admin/fees",
        capabilities: ["r001:bursar.all_fees"],
        orderHint: 6,
      },
      {
        key: "r001.bursar.defaulters",
        label: "Defaulters",
        iconKey: "fees",
        url: "/admin/fees-defaulters",
        capabilities: ["r001:bursar.defaulters"],
        orderHint: 7,
      },
      {
        key: "r001.bursar.messages",
        label: "Messages",
        iconKey: "messages",
        url: "/messages",
        capabilities: ["r001:bursar.messages"],
        orderHint: 8,
      },
      {
        key: "r001.bursar.notifications",
        label: "Notifications",
        iconKey: "notifications",
        url: "/notifications",
        capabilities: ["r001:bursar.notifications"],
        orderHint: 9,
      },
      {
        key: "r001.bursar.settings",
        label: "Settings",
        iconKey: "settings",
        url: "/settings",
        capabilities: ["r001:bursar.settings"],
        orderHint: 10,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "hq",
    sectionLabel: "HQ workspace",
    items: [
      {
        key: "r001.hq.dashboard",
        label: "Dashboard",
        iconKey: "dashboard",
        url: "/hq/dashboard",
        capabilities: ["r001:hq.dashboard"],
        orderHint: 0,
      },
      {
        key: "r001.hq.finance",
        label: "Finance",
        iconKey: "fees",
        url: "/hq/finance",
        capabilities: ["r001:hq.finance"],
        orderHint: 1,
      },
      {
        key: "r001.hq.reports",
        label: "Reports",
        iconKey: "reports",
        url: "/hq/reports",
        capabilities: ["r001:hq.reports"],
        orderHint: 2,
      },
      {
        key: "r001.hq.messages",
        label: "Messages",
        iconKey: "messages",
        url: "/messages",
        capabilities: ["r001:hq.messages"],
        orderHint: 3,
      },
      {
        key: "r001.hq.notifications",
        label: "Notifications",
        iconKey: "notifications",
        url: "/notifications",
        capabilities: ["r001:hq.notifications"],
        orderHint: 4,
      },
      {
        key: "r001.hq.settings",
        label: "Settings",
        iconKey: "settings",
        url: "/settings",
        capabilities: ["r001:hq.settings"],
        orderHint: 5,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "super_admin",
    sectionLabel: "Platform control workspace",
    items: [
      {
        key: "r001.super_admin.dashboard",
        label: "Dashboard",
        iconKey: "dashboard",
        url: "/super-admin/dashboard",
        capabilities: ["r001:super_admin.dashboard"],
        orderHint: 0,
      },
      {
        key: "r001.super_admin.organizations",
        label: "Organizations",
        iconKey: "schools",
        url: "/super-admin/schools",
        capabilities: ["r001:super_admin.organizations"],
        orderHint: 1,
      },
      {
        key: "r001.super_admin.billing",
        label: "Billing",
        iconKey: "fees",
        url: "/super-admin/billing",
        capabilities: ["r001:super_admin.billing"],
        orderHint: 2,
      },
      {
        key: "r001.super_admin.support",
        label: "Support",
        iconKey: "messages",
        url: "/super-admin/support",
        capabilities: ["r001:super_admin.support"],
        orderHint: 3,
      },
      {
        key: "r001.super_admin.logs",
        label: "Audit logs",
        iconKey: "reports",
        url: "/super-admin/logs",
        capabilities: ["r001:super_admin.logs"],
        orderHint: 4,
      },
      {
        key: "r001.super_admin.tiers",
        label: "Tiers",
        iconKey: "tiers",
        url: "/super-admin/tiers",
        capabilities: ["r001:super_admin.tiers"],
        orderHint: 5,
      },
      {
        key: "r001.super_admin.platform_config",
        label: "Platform config",
        iconKey: "config",
        url: "/super-admin/platform-config",
        capabilities: ["r001:super_admin.platform_config"],
        orderHint: 6,
      },
      {
        key: "r001.super_admin.settings",
        label: "Settings",
        iconKey: "settings",
        url: "/super-admin/settings",
        capabilities: ["r001:super_admin.settings"],
        orderHint: 7,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "driver",
    sectionLabel: "Driver workspace",
    items: [
      {
        key: "r001.driver.dashboard",
        label: "Dashboard",
        iconKey: "dashboard",
        url: "/driver/dashboard",
        capabilities: ["r001:driver.dashboard"],
        orderHint: 0,
      },
      {
        key: "r001.driver.messages",
        label: "Messages",
        iconKey: "messages",
        url: "/messages",
        capabilities: ["r001:driver.messages"],
        orderHint: 1,
      },
      {
        key: "r001.driver.notifications",
        label: "Notifications",
        iconKey: "notifications",
        url: "/notifications",
        capabilities: ["r001:driver.notifications"],
        orderHint: 2,
      },
      {
        key: "r001.driver.settings",
        label: "Settings",
        iconKey: "settings",
        url: "/settings",
        capabilities: ["r001:driver.settings"],
        orderHint: 3,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "org_admin.intelligence",
    sectionLabel: "Intelligence",
    iconKey: "intelligence",
    collapsible: true,
    items: [
      {
        key: "r001.org_admin.dashboard",
        label: "Executive Dashboard",
        iconKey: "dashboard",
        url: "/admin/dashboard",
        capabilities: ["r001:org_admin.dashboard"],
        orderHint: 0,
      },
      {
        key: "r001.org_admin.student_intelligence",
        label: "Student Intelligence",
        iconKey: "ai",
        url: "/admin/student-intelligence",
        activeUrls: ["/admin/intelligence-students"],
        capabilities: ["r001:org_admin.student_intelligence"],
        orderHint: 1,
      },
      {
        key: "r001.org_admin.teacher_intelligence",
        label: "Teacher Intelligence",
        iconKey: "ai",
        url: "/admin/teacher-intelligence",
        activeUrls: ["/admin/intelligence-teachers"],
        capabilities: ["r001:org_admin.teacher_intelligence"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.economy_score",
        label: "Organization Economy Score",
        iconKey: "shield",
        url: "/admin/health-certificate",
        capabilities: ["r001:org_admin.economy_score"],
        orderHint: 3,
      },
      {
        key: "r001.org_admin.operations",
        label: "Operations Center",
        iconKey: "activity",
        url: "/admin/operations",
        activePrefixes: ["/admin/intelligence-operations"],
        capabilities: ["r001:org_admin.operations"],
        orderHint: 4,
      },
      {
        key: "r001.org_admin.coregrid_intelligence",
        label: "Sherivs Intelligence",
        iconKey: "intelligence",
        url: "/admin/intelligence",
        activePrefixes: ["/admin/intelligence-"],
        capabilities: ["r001:org_admin.coregrid_intelligence"],
        orderHint: 5,
      },
      {
        key: "r001.org_admin.ai",
        label: "AI Assistant",
        iconKey: "ai",
        url: "/admin/ai-assistant",
        capabilities: ["r001:org_admin.ai"],
        orderHint: 6,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "org_admin.academic",
    sectionLabel: "Academic",
    iconKey: "academic",
    collapsible: true,
    items: [
      {
        key: "r001.org_admin.students",
        label: "Learners",
        iconKey: "users",
        url: "/admin/students",
        capabilities: ["r001:org_admin.students"],
        orderHint: 0,
      },
      {
        key: "r001.org_admin.teachers",
        label: "Educators",
        iconKey: "teachers",
        url: "/admin/teachers",
        capabilities: ["r001:org_admin.teachers"],
        orderHint: 1,
      },
      {
        key: "r001.org_admin.classes",
        label: "Classes",
        iconKey: "tiers",
        url: "/admin/classes",
        capabilities: ["r001:org_admin.classes"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.timetable",
        label: "Timetable",
        iconKey: "timetable",
        url: "/admin/timetable",
        capabilities: ["r001:org_admin.timetable"],
        orderHint: 3,
      },
      {
        key: "r001.org_admin.attendance",
        label: "Attendance",
        iconKey: "attendance",
        url: "/admin/attendance",
        capabilities: ["r001:org_admin.attendance"],
        orderHint: 4,
      },
      {
        key: "r001.org_admin.geofence",
        label: "Geofence Settings",
        iconKey: "signin",
        url: "/admin/geofence-settings",
        capabilities: ["r001:org_admin.geofence"],
        orderHint: 5,
      },
      {
        key: "r001.org_admin.lesson_plans",
        label: "Lesson Plans",
        iconKey: "lessons",
        url: "/admin/lesson-plans",
        capabilities: ["r001:org_admin.lesson_plans"],
        orderHint: 6,
      },
      {
        key: "r001.org_admin.grades",
        label: "Grades",
        iconKey: "grades",
        url: "/admin/grades",
        capabilities: ["r001:org_admin.grades"],
        orderHint: 7,
      },
      {
        key: "r001.org_admin.report_cards",
        label: "Report Cards",
        iconKey: "report",
        url: "/admin/report-cards",
        capabilities: ["r001:org_admin.report_cards"],
        orderHint: 8,
      },
      {
        key: "r001.org_admin.examinations",
        label: "Examinations",
        iconKey: "reports",
        url: "/admin/examinations",
        capabilities: ["r001:org_admin.examinations"],
        orderHint: 9,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "org_admin.finance",
    sectionLabel: "Finance",
    iconKey: "finance",
    collapsible: true,
    items: [
      {
        key: "r001.org_admin.fee_management",
        label: "Fee Management",
        iconKey: "fees",
        url: "/admin/fees",
        capabilities: ["r001:org_admin.fee_management"],
        orderHint: 0,
      },
      {
        key: "r001.org_admin.fee_defaulters",
        label: "Fee Defaulters",
        iconKey: "receipts",
        url: "/admin/fees-defaulters",
        capabilities: ["r001:org_admin.fee_defaulters"],
        orderHint: 1,
      },
      {
        key: "r001.org_admin.expenses",
        label: "Expenses",
        iconKey: "reports",
        url: "/admin/expenses",
        capabilities: ["r001:org_admin.expenses"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.payroll",
        label: "Payroll",
        iconKey: "fees",
        url: "/admin/payroll",
        capabilities: ["r001:org_admin.payroll"],
        orderHint: 3,
      },
      {
        key: "r001.org_admin.financial_reports",
        label: "Financial Reports",
        iconKey: "reports",
        url: "/admin/financial-reports",
        capabilities: ["r001:org_admin.financial_reports"],
        orderHint: 4,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "org_admin.services",
    sectionLabel: "Learner Services",
    iconKey: "services",
    collapsible: true,
    items: [
      {
        key: "r001.org_admin.health",
        label: "Health / Clinic",
        iconKey: "services",
        url: "/admin/health",
        capabilities: ["r001:org_admin.health"],
        orderHint: 0,
      },
      {
        key: "r001.org_admin.bus_management",
        label: "Bus Management",
        iconKey: "bus",
        url: "/admin/bus-management",
        capabilities: ["r001:org_admin.bus_management"],
        orderHint: 1,
      },
      {
        key: "r001.org_admin.buses",
        label: "Buses",
        iconKey: "bus",
        url: "/admin/buses",
        capabilities: ["r001:org_admin.buses"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.hostel",
        label: "Hostel",
        iconKey: "home",
        url: "/admin/hostel",
        capabilities: ["r001:org_admin.hostel"],
        orderHint: 3,
      },
      {
        key: "r001.org_admin.library",
        label: "Library",
        iconKey: "lessons",
        url: "/admin/library",
        capabilities: ["r001:org_admin.library"],
        orderHint: 4,
      },
      {
        key: "r001.org_admin.discipline",
        label: "Discipline",
        iconKey: "shield",
        url: "/admin/discipline",
        capabilities: ["r001:org_admin.discipline"],
        orderHint: 5,
      },
      {
        key: "r001.org_admin.extracurricular",
        label: "Extracurricular",
        iconKey: "tiers",
        url: "/admin/extracurricular",
        capabilities: ["r001:org_admin.extracurricular"],
        orderHint: 6,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "org_admin.communication",
    sectionLabel: "Communication",
    iconKey: "communication",
    collapsible: true,
    items: [
      {
        key: "r001.org_admin.announcements",
        label: "Announcements / News",
        iconKey: "news",
        url: "/admin/news",
        capabilities: ["r001:org_admin.announcements"],
        orderHint: 0,
      },
      {
        key: "r001.org_admin.calendar",
        label: "Calendar",
        iconKey: "calendar",
        url: "/admin/calendar",
        capabilities: ["r001:org_admin.calendar"],
        orderHint: 1,
      },
      {
        key: "r001.org_admin.messages",
        label: "Messages",
        iconKey: "messages",
        url: "/messages",
        capabilities: ["r001:org_admin.messages"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.broadcast",
        label: "Broadcast",
        iconKey: "broadcast",
        url: "/admin/broadcast",
        capabilities: ["r001:org_admin.broadcast"],
        orderHint: 3,
      },
      {
        key: "r001.org_admin.notifications",
        label: "Notifications",
        iconKey: "notifications",
        url: "/notifications",
        capabilities: ["r001:org_admin.notifications"],
        orderHint: 4,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "org_admin.administration",
    sectionLabel: "Administration",
    iconKey: "administration",
    collapsible: true,
    items: [
      {
        key: "r001.org_admin.admissions",
        label: "Admissions",
        iconKey: "signin",
        url: "/admin/admissions",
        capabilities: ["r001:org_admin.admissions"],
        orderHint: 0,
      },
      {
        key: "r001.org_admin.hr",
        label: "HR & Staff",
        iconKey: "teachers",
        url: "/admin/hr",
        activeUrls: ["/admin/staff-accounts"],
        capabilities: ["r001:org_admin.hr"],
        orderHint: 1,
      },
      {
        key: "r001.org_admin.visitors",
        label: "Visitor Management",
        iconKey: "users",
        url: "/admin/visitors",
        capabilities: ["r001:org_admin.visitors"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.inventory",
        label: "Inventory",
        iconKey: "tiers",
        url: "/admin/inventory",
        capabilities: ["r001:org_admin.inventory"],
        orderHint: 3,
      },
      {
        key: "r001.org_admin.audit",
        label: "Audit Logs",
        iconKey: "reports",
        url: "/admin/audit",
        activeUrls: ["/admin/audit-logs"],
        capabilities: ["r001:org_admin.audit"],
        orderHint: 4,
      },
      {
        key: "r001.org_admin.support",
        label: "Support",
        iconKey: "messages",
        url: "/admin/support",
        capabilities: ["r001:org_admin.support"],
        orderHint: 5,
      },
      {
        key: "r001.org_admin.locked_accounts",
        label: "Locked Accounts",
        iconKey: "security",
        url: "/admin/locked-accounts",
        capabilities: ["r001:org_admin.locked_accounts"],
        orderHint: 6,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "org_admin.platform",
    sectionLabel: "Platform",
    iconKey: "platform",
    collapsible: true,
    items: [
      {
        key: "r001.org_admin.cms",
        label: "Public Website CMS",
        iconKey: "globe",
        url: "/admin/cms",
        capabilities: ["r001:org_admin.cms"],
        orderHint: 0,
      },
      {
        key: "r001.org_admin.features",
        label: "Features",
        iconKey: "config",
        url: "/admin/features",
        capabilities: ["r001:org_admin.features"],
        orderHint: 1,
      },
      {
        key: "r001.org_admin.api_keys",
        label: "API Keys",
        iconKey: "security",
        url: "/admin/api-keys",
        capabilities: ["r001:org_admin.api_keys"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.digital_twin",
        label: "Digital Twin",
        iconKey: "intelligence",
        url: "/admin/digital-twin",
        capabilities: ["r001:org_admin.digital_twin"],
        orderHint: 3,
      },
      {
        key: "r001.org_admin.settings",
        label: "Settings",
        iconKey: "settings",
        url: "/admin/settings",
        capabilities: ["r001:org_admin.settings"],
        orderHint: 4,
      },
      {
        key: "r001.org_admin.school_profile",
        label: "School profile & templates",
        iconKey: "settings",
        url: "/admin/school-profile",
        capabilities: ["r001:org_admin.school_profile"],
        orderHint: 5,
      },
      {
        key: "r001.org_admin.facilities",
        label: "Facilities & twin estate",
        iconKey: "settings",
        url: "/admin/facilities",
        capabilities: ["r001:org_admin.facilities"],
        orderHint: 6,
      },
    ],
  },
  {
    runtimeRef: RUNTIME_SCHOLAR,
    sectionKey: "org_admin.scholar_ops",
    sectionLabel: "School operations",
    iconKey: "administration",
    collapsible: true,
    items: [
      {
        key: "r001.org_admin.onboarding_interview",
        label: "Setup interview",
        iconKey: "config",
        url: "/admin/onboarding-interview",
        capabilities: ["r001:org_admin.onboarding_interview"],
        orderHint: 0,
      },
      {
        key: "r001.org_admin.role_scopes",
        label: "Role scopes",
        iconKey: "security",
        url: "/admin/role-scopes",
        capabilities: ["r001:org_admin.role_scopes"],
        orderHint: 1,
      },
      {
        key: "r001.org_admin.campuses",
        label: "Campuses & sections",
        iconKey: "schools",
        url: "/admin/campuses",
        capabilities: ["r001:org_admin.campuses"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.structure",
        label: "Shifts, levels & terms",
        iconKey: "schools",
        url: "/admin/structure",
        capabilities: ["r001:org_admin.structure"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.academic_standing",
        label: "Results & standing",
        iconKey: "reports",
        url: "/admin/academic-standing",
        capabilities: ["r001:org_admin.academic_standing"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.exam_bodies",
        label: "External exams (WAEC, NECO…)",
        iconKey: "grades",
        url: "/admin/exam-bodies",
        capabilities: ["r001:org_admin.exam_bodies"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.fee_relief",
        label: "Fee relief & levies",
        iconKey: "fees",
        url: "/admin/fee-relief",
        capabilities: ["r001:org_admin.fee_relief"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.transfers_custody",
        label: "Transfers, guardians & pickup",
        iconKey: "users",
        url: "/admin/transfers-custody",
        capabilities: ["r001:org_admin.transfers_custody"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.domains",
        label: "School domains",
        iconKey: "settings",
        url: "/admin/domains",
        capabilities: ["r001:org_admin.domains"],
        orderHint: 2,
      },
      {
        key: "r001.org_admin.wallet",
        label: "School wallet",
        iconKey: "finance",
        url: "/admin/wallet",
        capabilities: ["r001:org_admin.wallet"],
        orderHint: 3,
      },
      {
        key: "r001.org_admin.ndpa",
        label: "Data protection (NDPA)",
        iconKey: "shield",
        url: "/admin/ndpa",
        capabilities: ["r001:org_admin.ndpa"],
        orderHint: 4,
      },
      {
        key: "r001.org_admin.admissions_funnel",
        label: "Admissions funnel",
        iconKey: "users",
        url: "/admin/admissions-funnel",
        capabilities: ["r001:org_admin.admissions_funnel"],
        orderHint: 5,
      },
      {
        key: "r001.org_admin.messages_log",
        label: "Messaging log",
        iconKey: "messages",
        url: "/admin/messages-log",
        capabilities: ["r001:org_admin.messages_log"],
        orderHint: 6,
      },
      {
        key: "r001.org_admin.exams",
        label: "Exams & CBT",
        iconKey: "grades",
        url: "/admin/exams",
        capabilities: ["r001:org_admin.exams"],
        orderHint: 7,
      },
      {
        key: "r001.org_admin.early_warning",
        label: "Early warning",
        iconKey: "activity",
        url: "/admin/early-warning",
        capabilities: ["r001:org_admin.early_warning"],
        orderHint: 8,
      },
      {
        key: "r001.org_admin.hr_payroll",
        label: "HR & payroll",
        iconKey: "fees",
        url: "/admin/hr-payroll",
        capabilities: ["r001:org_admin.hr_payroll"],
        orderHint: 9,
      },
      {
        key: "r001.org_admin.stores_assets",
        label: "Stores & assets",
        iconKey: "reports",
        url: "/admin/stores-assets",
        capabilities: ["r001:org_admin.stores_assets"],
        orderHint: 10,
      },
      {
        key: "r001.org_admin.visitors",
        label: "Visitors & pick-ups",
        iconKey: "signin",
        url: "/admin/visitors",
        capabilities: ["r001:org_admin.visitors"],
        orderHint: 11,
      },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────
 * R-001 feature-code index — every capability actually shipped in
 * the Scholar contribution data (single home). Gate primitives use
 * this set to fail closed on codes the runtime never declared.
 * ────────────────────────────────────────────────────────────*/

export const SCHOLAR_FEATURE_CODES: ReadonlySet<string> = new Set(
  SCHOLAR_NAV_CONTRIBUTIONS.flatMap((contribution) =>
    (contribution.items ?? []).flatMap((item) => item.capabilities ?? []),
  ),
);

export function isScholarFeatureCode(code: string): boolean {
  return SCHOLAR_FEATURE_CODES.has(code);
}

/* ─────────────────────────────────────────────────────────────
 * Scholar workspace kinds → authorized capability sets.
 * Single source: contribution item capability codes (prefix scan).
 * A viewer sees a section/item only when P08-equivalent membership grants
 * the underlying capability — the UI never decides.
 * ────────────────────────────────────────────────────────────*/

export type ScholarNavKind =
  "parent" | "student" | "teacher" | "org_admin" | "bursar" | "hq" | "super_admin" | "driver";

export function scholarCapabilitiesForKind(kind: ScholarNavKind): ReadonlySet<string> {
  const prefix = `r001:${kind}.`;
  const capabilities = new Set<string>();
  for (const contribution of SCHOLAR_NAV_CONTRIBUTIONS) {
    for (const item of contribution.items) {
      for (const capability of item.capabilities ?? []) {
        if (capability.startsWith(prefix)) capabilities.add(capability);
      }
    }
  }
  return capabilities;
}

/** Legacy AppRole (identity-store membership kind) → Scholar nav capability set. */
export function scholarCapabilitiesForRole(role: AppRole): ReadonlySet<string> {
  const kind: ScholarNavKind =
    role === "admin" || role === "principal" ? "org_admin" : (role as ScholarNavKind);
  return scholarCapabilitiesForKind(kind);
}

/* ─────────────────────────────────────────────────────────────
 * Workspace landing + display labels (no role-switch redirects).
 * The post-login landing IS the resolved workspace home.
 * ────────────────────────────────────────────────────────────*/

/** Scholar workspace display label for a legacy membership kind (UI copy only). */
export const SCHOLAR_WORKSPACE_LABELS: Readonly<Record<ScholarNavKind, string>> = {
  org_admin: "Organization administrator",
  teacher: "Educator",
  parent: "Parent / guardian",
  student: "Learner",
  bursar: "Finance officer",
  hq: "HQ operator",
  super_admin: "Platform administrator",
  driver: "Driver",
};

export function scholarWorkspaceLabelForRole(role: AppRole): string {
  const kind: ScholarNavKind =
    role === "admin" || role === "principal" ? "org_admin" : (role as ScholarNavKind);
  return SCHOLAR_WORKSPACE_LABELS[kind] ?? "Workspace member";
}

/**
 * The workspace landing surface — the home item (orderHint 0) of the chrome
 * resolved from authorized capabilities. Never a role-keyed switch.
 */
export function scholarWorkspaceHome(role: AppRole): string {
  const sections = resolveWorkspaceNav(SCHOLAR_NAV_CONTRIBUTIONS, scholarCapabilitiesForRole(role));
  return resolveWorkspaceHome(sections) ?? "/";
}
