/**
 * CoreGrid — placeholder-page disposition registry (V1CAP-40, mission V1-011).
 *
 * Typed audit record of the §57 no-product-theatre disposition pass over the
 * portal's zero-state pages. Every page that previously rendered fabricated
 * statics (static zeros posing as data, disabled fake actions, invented
 * intelligence metrics) is classified here:
 *
 *   - V1_BUILD       — the page covers a V1 capability and now reads real
 *                      data through server functions over existing
 *                      RLS-protected tables (`portal-overview.functions.ts`);
 *   - V2_CLASSIFIED  — the page is real future scope; it renders an honest
 *                      "planned capability — not in V1" state (no numbers, no
 *                      fake actions) via `PlannedCapabilityState`;
 *   - AUDITED_REAL   — the page was flagged by discovery as a placeholder but
 *                      audit found it already real (DB-backed or an honest
 *                      self-report surface); no change was needed.
 *
 * A static zero that pretends to be data is a violation; an honest "no data
 * yet" state is correct. This registry is the program's audit surface for
 * that law.
 */

export const PLACEHOLDER_DISPOSITION_MISSION = "V1-011" as const;

export type PlaceholderDisposition = "V1_BUILD" | "V2_CLASSIFIED" | "AUDITED_REAL";

export interface PlaceholderDispositionEntry {
  /** Portal route path as registered by the router. */
  route: string;
  /** Source file of the route, relative to the repository root. */
  file: string;
  title: string;
  disposition: PlaceholderDisposition;
  /**
   * V1_BUILD: the existing DB tables that back the page.
   * V2_CLASSIFIED: the fabricated content that was removed.
   * AUDITED_REAL: the evidence that the page was already real.
   */
  evidence: string;
  /** V2_CLASSIFIED only: the capability's planned state, stated in the open. */
  plannedCapability?: string;
  /** The frozen V1 envelope reason for a V2 classification (§45). */
  versionTargetNote?: string;
}

export const PLACEHOLDER_DISPOSITIONS: readonly PlaceholderDispositionEntry[] = [
  // ── V1-BUILD: real capability, real tables, wired in this mission ─────────
  {
    route: "/admin/audit",
    file: "frontend/src/routes/_authenticated/admin/audit.tsx",
    title: "Comprehensive Audit & Compliance System",
    disposition: "V1_BUILD",
    evidence:
      "audit_logs table exists (migration 20260620122048, V1CAP-27 audit trail IMPLEMENTED). " +
      "Page now reads tenant-scoped event counts through loadAuditOverview " +
      "(portal-overview.functions.ts, school_admin gate). Fabricated compliance claims " +
      "('✓ GDPR compliant', '✓ No anomalies detected — AI monitoring active') removed.",
  },
  {
    route: "/admin/payroll",
    file: "frontend/src/routes/_authenticated/admin/payroll.tsx",
    title: "Payroll Management System",
    disposition: "V1_BUILD",
    evidence:
      "staff_payroll table exists (migration 20260725065302) with gross/net generated columns " +
      "and school-isolation RLS. Page now reads current-period aggregates through " +
      "loadPayrollOverview. Disabled 'Process Payroll'/'Generate Payslips' fake actions removed.",
  },
  {
    route: "/admin/financial-reports",
    file: "frontend/src/routes/_authenticated/admin/financial-reports.tsx",
    title: "Financial Analytics & Reporting",
    disposition: "V1_BUILD",
    evidence:
      "fees (migration 20260620122048) and school_expenses (migration 20260626150625) tables " +
      "exist with RLS. Page now reads billed/collected/outstanding and expense totals through " +
      "loadFinancialReportsOverview. Fabricated revenue/grant splits and forecast tabs removed.",
  },
  {
    route: "/admin/extracurricular",
    file: "frontend/src/routes/_authenticated/admin/extracurricular.tsx",
    title: "Extracurricular & Activities Hub",
    disposition: "V1_BUILD",
    evidence:
      "school_sports table exists (migration 20260626150625) with RLS. Page now lists real " +
      "sports programs through loadExtracurricularOverview. Club/event management (no backing " +
      "table) is stated as planned capability instead of fabricated zero-state tabs.",
  },

  // ── V2-CLASSIFIED: real future scope, honest planned state ────────────────
  {
    route: "/admin/inventory",
    file: "frontend/src/routes/_authenticated/admin/inventory.tsx",
    title: "Inventory & Asset Management",
    disposition: "V2_CLASSIFIED",
    evidence:
      "No inventory/asset table exists in any migration (audited all CREATE TABLE statements). " +
      "Page rendered static zeros ('Total Assets 0', '₦0 inventory value') and disabled " +
      "'Register Asset'/'Create Requisition' buttons. Schema gap reported to the program.",
    plannedCapability:
      "Asset register, stock levels, maintenance scheduling and requisitions — requires an " +
      "inventory schema (assets, stock movements, requisitions) before any real surface can exist.",
    versionTargetNote: "Not launch-critical for V1; dispositioned V2 per the capability matrix.",
  },
  {
    route: "/admin/examinations",
    file: "frontend/src/routes/_authenticated/admin/examinations.tsx",
    title: "Examination Management System",
    disposition: "V2_CLASSIFIED",
    evidence:
      "No examination-scheduling/seating/invigilation table exists (grades exist and are served " +
      "by the real grades/report-card pages). Page rendered static zeros and a fake 'exams' list " +
      "with zero students. Schema gap reported to the program.",
    plannedCapability:
      "Exam scheduling, seating plans, exam-centre and invigilator coordination — requires an " +
      "examinations schema before any real surface can exist.",
    versionTargetNote:
      "Grade capture and report-card publishing are V1 and live on their real routes " +
      "(/admin/grades, /admin/report-cards); exam logistics are not launch-critical.",
  },
  {
    route: "/admin/visitors",
    file: "frontend/src/routes/_authenticated/admin/visitors.tsx",
    title: "Visitor Management & Gate Control",
    disposition: "V2_CLASSIFIED",
    evidence:
      "No visitor/pass table exists in any migration. Page rendered static zeros, a fabricated " +
      "'Security Status: Secure' stat and disabled 'Check In Visitor'/'Issue Pass' buttons.",
    plannedCapability:
      "Visitor check-in, pass issuance and gate logs — requires a visitors schema before any " +
      "real surface can exist.",
    versionTargetNote: "Not launch-critical for V1; dispositioned V2 per the capability matrix.",
  },
  {
    route: "/admin/intelligence-ai",
    file: "frontend/src/routes/_authenticated/admin/intelligence-ai.tsx",
    title: "AI Command Center",
    disposition: "V2_CLASSIFIED",
    evidence:
      "Rendered invented metrics ('Active agents 8', 'Reports generated 246', 'AI hours saved " +
      "1,840') with no data source. AI-operations rollups are V2 scope " +
      "(per-org cost rollup dashboards, capability matrix V2 list).",
    plannedCapability:
      "AI agent/workflow/report operations dashboard backed by real usage-attribution data " +
      "(cg_usage_attribution_* tables) once AI operations reach V2 scope.",
    versionTargetNote:
      "V3 Reality Intelligence and V2 AI-ops dashboards are frozen (§45); the real V1 AI " +
      "gateway surface is the AI governance registry, not this page.",
  },
  {
    route: "/admin/intelligence-operations",
    file: "frontend/src/routes/_authenticated/admin/intelligence-operations.tsx",
    title: "Operations Command Center",
    disposition: "V2_CLASSIFIED",
    evidence:
      "Rendered invented metrics ('Live attendance 94%', 'Buses on route 6 / 8', 'Incidents " +
      "(24h) 2'). Real operations data lives on the real attendance/transport/facilities pages.",
    plannedCapability:
      "A unified live operations picture across attendance, transport and facilities.",
    versionTargetNote:
      "Frozen V3 Reality Intelligence scope (§45); every real signal it promises is already " +
      "served by its V1 page. Linked honestly to those surfaces.",
  },
  {
    route: "/admin/intelligence-parents",
    file: "frontend/src/routes/_authenticated/admin/intelligence-parents.tsx",
    title: "Parent Experience Center",
    disposition: "V2_CLASSIFIED",
    evidence:
      "Rendered invented metrics ('Active parents 412', 'Trust score 4.7', 'Messages this week " +
      "1280', 'Events this week 3,420'). Sentiment/trust indices are fabricated intelligence.",
    plannedCapability:
      "Parent engagement analytics (engagement, sentiment, fee health) built on real messaging " +
      "and payment data.",
    versionTargetNote:
      "Sentiment scoring is V3 Reality Intelligence (frozen, §45); not launch-critical for V1.",
  },
  {
    route: "/admin/intelligence-students",
    file: "frontend/src/routes/_authenticated/admin/intelligence-students.tsx",
    title: "Student Intelligence Center",
    disposition: "V2_CLASSIFIED",
    evidence:
      "Rendered invented metrics ('Avg success score 82', 'At-risk students 17', 'Scholarship " +
      "candidates 9', 'Dropout flagged 5'). Prediction models are fabricated intelligence.",
    plannedCapability:
      "Student success scoring, dropout prediction and risk registers built on real " +
      "attendance/grade data.",
    versionTargetNote:
      "V3 Reality Intelligence is frozen (§45). The real V1 student surface is " +
      "/admin/student-intelligence (DB-backed), linked from this page.",
  },
  {
    route: "/admin/intelligence-teachers",
    file: "frontend/src/routes/_authenticated/admin/intelligence-teachers.tsx",
    title: "Teacher Intelligence Center",
    disposition: "V2_CLASSIFIED",
    evidence:
      "Rendered invented metrics ('Avg performance 8.4 / 10', 'Burnout risk 3', 'Training " +
      "completion 76%', 'Recognitions issued 14'). Burnout/performance models are fabricated.",
    plannedCapability:
      "Teacher performance and workload analytics built on real lesson-plan, attendance and " +
      "outcome data.",
    versionTargetNote:
      "V3 Reality Intelligence is frozen (§45). The real V1 teacher surface is " +
      "/admin/teacher-intelligence (DB-backed), linked from this page.",
  },

  // ── AUDITED-REAL: discovery flagged these; audit found them already real ──
  {
    route: "/super-admin/academic-intelligence",
    file: "frontend/src/routes/_authenticated/super-admin/academic-intelligence.tsx",
    title: "Academic intelligence (control plane)",
    disposition: "AUDITED_REAL",
    evidence:
      "Renders the Phase 11 self-report (academicIntelligenceReport) which exercises the real " +
      "engines and names its gaps in the open — the opposite of product theatre. No change.",
  },
  {
    route: "/super-admin/agent-governance",
    file: "frontend/src/routes/_authenticated/super-admin/agent-governance.tsx",
    title: "Agent governance (control plane)",
    disposition: "AUDITED_REAL",
    evidence:
      "Renders agentGovernanceReport, which exercises the real task/loop state machines and " +
      "ties every rule to its implementation and proof suite. No change.",
  },
  {
    route: "/super-admin/billing",
    file: "frontend/src/routes/_authenticated/super-admin/billing.tsx",
    title: "Billing (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "DB-backed via supabase queries over subscriptions/schools. No change.",
  },
  {
    route: "/super-admin/communication-steward",
    file: "frontend/src/routes/_authenticated/super-admin/communication-steward.tsx",
    title: "Communication steward (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "Renders the communication-steward self-report over real code checks. No change.",
  },
  {
    route: "/super-admin/dashboard",
    file: "frontend/src/routes/_authenticated/super-admin/dashboard.tsx",
    title: "Super-admin dashboard",
    disposition: "AUDITED_REAL",
    evidence: "DB-backed (useQuery over supabase). No change.",
  },
  {
    route: "/super-admin/financial-operations",
    file: "frontend/src/routes/_authenticated/super-admin/financial-operations.tsx",
    title: "Financial operations (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "Renders buildFinancialIntelligenceReport over real financial controls. No change.",
  },
  {
    route: "/super-admin/logs",
    file: "frontend/src/routes/_authenticated/super-admin/logs.tsx",
    title: "Platform logs (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "DB-backed paginated query over super_admin_logs. No change.",
  },
  {
    route: "/super-admin/platform-config",
    file: "frontend/src/routes/_authenticated/super-admin/platform-config.tsx",
    title: "Platform configuration (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "DB-backed read/write over platform_config. No change.",
  },
  {
    route: "/super-admin/runtime-contracts",
    file: "frontend/src/routes/_authenticated/super-admin/runtime-contracts.tsx",
    title: "Runtime contracts (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "Renders runtimeSelfReport over real module checks. No change.",
  },
  {
    route: "/super-admin/scheduling-intelligence",
    file: "frontend/src/routes/_authenticated/super-admin/scheduling-intelligence.tsx",
    title: "Scheduling intelligence (control plane)",
    disposition: "AUDITED_REAL",
    evidence:
      "Renders buildSchedulingIntelligenceReport over real scheduling validators. No change.",
  },
  {
    route: "/super-admin/schools",
    file: "frontend/src/routes/_authenticated/super-admin/schools.tsx",
    title: "Schools (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "DB-backed list + provisioning server functions. No change.",
  },
  {
    route: "/super-admin/settings",
    file: "frontend/src/routes/_authenticated/super-admin/settings.tsx",
    title: "Platform settings (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "DB-backed via supabase queries. No change.",
  },
  {
    route: "/super-admin/support",
    file: "frontend/src/routes/_authenticated/super-admin/support.tsx",
    title: "Support queue (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "DB-backed over platform_complaints with mutations. No change.",
  },
  {
    route: "/super-admin/tenants",
    file: "frontend/src/routes/_authenticated/super-admin/tenants.tsx",
    title: "Tenants (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "DB-backed via listTenants/registerTenant server functions (super-admin gated).",
  },
  {
    route: "/super-admin/tiers",
    file: "frontend/src/routes/_authenticated/super-admin/tiers.tsx",
    title: "Subscription tiers (control plane)",
    disposition: "AUDITED_REAL",
    evidence:
      "Renders SUBSCRIPTION_TIERS — the platform's real tier configuration (declared data, not " +
      "fabricated metrics). No change.",
  },
  {
    route: "/super-admin/trust-fabric",
    file: "frontend/src/routes/_authenticated/super-admin/trust-fabric.tsx",
    title: "Trust fabric (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "Renders trustFabricReport over real trust assertions. No change.",
  },
  {
    route: "/super-admin/workspace-projection",
    file: "frontend/src/routes/_authenticated/super-admin/workspace-projection.tsx",
    title: "Workspace projection (control plane)",
    disposition: "AUDITED_REAL",
    evidence: "Renders composeWorkspaces over the real projection engine. No change.",
  },
];

/* ─────────────────────────────────────────────────────────────
 * Validation — the registry audits itself (fail-closed)
 * ────────────────────────────────────────────────────────────*/

export interface DispositionValidationResult {
  ok: boolean;
  issues: string[];
}

export function validatePlaceholderDispositions(): DispositionValidationResult {
  const issues: string[] = [];
  const seenRoutes = new Set<string>();
  const seenFiles = new Set<string>();

  for (const entry of PLACEHOLDER_DISPOSITIONS) {
    const at = `entry ${entry.route}`;
    if (seenRoutes.has(entry.route)) issues.push(`${at}: duplicate route`);
    if (seenFiles.has(entry.file)) issues.push(`${at}: duplicate file`);
    seenRoutes.add(entry.route);
    seenFiles.add(entry.file);

    if (!entry.route.startsWith("/")) issues.push(`${at}: route must be absolute`);
    if (!entry.file.startsWith("frontend/src/routes/")) {
      issues.push(`${at}: file must live under frontend/src/routes/`);
    }
    if (entry.file.includes("(site)")) {
      issues.push(`${at}: (site) routes are owned by another mission`);
    }
    if (entry.evidence.trim() === "") issues.push(`${at}: evidence must not be empty`);

    if (entry.disposition === "V2_CLASSIFIED" && !entry.plannedCapability) {
      issues.push(`${at}: V2_CLASSIFIED entries must state the planned capability`);
    }
    if (entry.disposition !== "V2_CLASSIFIED" && entry.plannedCapability) {
      issues.push(`${at}: only V2_CLASSIFIED entries carry a planned capability`);
    }
    if (
      entry.disposition === "V1_BUILD" &&
      !entry.evidence.includes("portal-overview.functions.ts") &&
      !entry.evidence.includes("table")
    ) {
      issues.push(`${at}: V1_BUILD entries must cite the real tables backing the page`);
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Count entries by disposition — the audit summary for the program. */
export function dispositionCounts(): Record<PlaceholderDisposition, number> {
  const counts: Record<PlaceholderDisposition, number> = {
    V1_BUILD: 0,
    V2_CLASSIFIED: 0,
    AUDITED_REAL: 0,
  };
  for (const entry of PLACEHOLDER_DISPOSITIONS) counts[entry.disposition] += 1;
  return counts;
}
