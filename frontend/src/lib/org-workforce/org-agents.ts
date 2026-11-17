/**
 * Organization workforce definitions (ENGINE-17, ADR-095).
 *
 * Seventeen agents an organization (a school) can run. They are organization-level and
 * accountable to one human role; they are NOT bound to a person's membership role.
 * The database allows only nine membership roles, so an admissions, exams or records
 * agent has no role to bind to, and these definitions are deliberately kept out of the
 * pack registry and out of TENANT_ROLE_PACKS. Nothing here is published or runs.
 *
 * Every pack is a valid tenant Role Pack: at most T2, no autonomous action above T1,
 * approvals by the organization's own role owner (never the sheriff), permissions that
 * come from the generated Nigerian role catalog and from the template for the function,
 * and shadow until evaluations earn more. Anything that reaches a parent, an applicant
 * or a record is approval-gated; decisions that belong to a human (admission, refund,
 * leave, publishing results, a safeguarding referral) are propose-only.
 *
 * Definitions only: no I/O, no environment, no secrets.
 */
import { ROLE_PACK_SCHEMA, type RolePack, type RolePackCapability } from "../twin-engine/role-pack";
import type { FeatureKey, TierName } from "../subscription-tiers";

/** The only roles a membership can hold in the live database. */
export const MEMBERSHIP_ROLES = [
  "admin",
  "principal",
  "teacher",
  "parent",
  "student",
  "bursar",
  "hq",
  "alumni",
  "driver",
] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export interface OrgAgent {
  readonly codename: string;
  /** The human role accountable for this agent and its approvals. */
  readonly accountable: MembershipRole;
  /** Key in NG_ROLE_TEMPLATES whose permissions bound this agent. */
  readonly template: string;
  /**
   * The existing plan feature this agent follows: the agent's minimum plan is the first plan
   * that enables it, so packaging cannot drift from pricing. Null when no feature fits.
   */
  readonly anchorFeature: FeatureKey | null;
  /** Used only when anchorFeature is null. */
  readonly minTier: TierName | null;
  /** Why the plan placement is what it is. */
  readonly rationale: string;
  readonly pack: RolePack;
}

const read = (id: string, title: string, perm: string): RolePackCapability => ({
  id,
  title,
  tier: "T0",
  autonomy: "act_autonomously",
  requiresPermission: perm,
});
const send = (id: string, title: string, perm: string): RolePackCapability => ({
  id,
  title,
  tier: "T2",
  autonomy: "act_with_approval",
  approver: "role_owner",
  requiresPermission: perm,
});
const propose = (id: string, title: string, perm: string): RolePackCapability => ({
  id,
  title,
  tier: "T2",
  autonomy: "propose_only",
  requiresPermission: perm,
});

function pack(
  code: string,
  title: string,
  accountable: MembershipRole,
  domains: readonly string[],
  permissions: readonly string[],
  capabilities: readonly RolePackCapability[],
): RolePack {
  return {
    schema: ROLE_PACK_SCHEMA,
    code,
    version: "1.0.0",
    title,
    kind: "tenant_role",
    appliesTo: [accountable],
    permissions: [...permissions],
    capabilities: [...capabilities],
    playbooks: [],
    memory: {
      domains: [...domains],
      maxSensitivity: "internal",
      retentionDays: 365,
      crossTenant: false,
    },
    budget: { dailyActions: 150, dailyModelCalls: 30, dailyCostCapMinor: 300 },
    escalation: { defaultApprover: "role_owner", t3Approver: "platform_staff" },
    startsInShadow: true,
  };
}

export const ORG_AGENTS: readonly OrgAgent[] = Object.freeze([
  {
    codename: "Concierge",
    accountable: "admin",
    template: "ict_head",
    anchorFeature: "support_tickets",
    minTier: null,
    rationale: "Support tickets are already on every plan including the trial.",
    pack: pack(
      "org-support",
      "Organization support agent",
      "admin",
      ["support"],
      ["ict.support"],
      [
        read("answer.how.to", "Answer a how-to question about the platform", "ict.support"),
        read("triage.ticket", "Triage and categorise a support ticket", "ict.support"),
        read("draft.ticket.reply", "Draft a reply to a ticket", "ict.support"),
        send("send.ticket.reply", "Send a reply to a ticket", "ict.support"),
      ],
    ),
  },
  {
    codename: "Tally",
    accountable: "bursar",
    template: "bursar",
    anchorFeature: "fee_management",
    minTier: null,
    rationale: "Fee management first appears on Starter.",
    pack: pack(
      "org-fees",
      "Organization fees agent",
      "bursar",
      ["fees"],
      ["fees.view", "payments.reconcile", "reports.financial"],
      [
        read("flag.arrears", "Flag overdue balances", "fees.view"),
        read("suggest.matches", "Suggest payment matches", "payments.reconcile"),
        read("draft.reminder", "Draft a fee reminder", "fees.view"),
        send("send.reminder", "Send a fee reminder", "fees.view"),
        propose("propose.refund", "Propose a refund for a human decision", "payments.reconcile"),
      ],
    ),
  },
  {
    codename: "Roll",
    accountable: "principal",
    template: "form_teacher",
    anchorFeature: "qr_attendance",
    minTier: null,
    rationale: "Attendance beyond manual marking starts on Starter.",
    pack: pack(
      "org-attendance",
      "Organization attendance agent",
      "principal",
      ["attendance"],
      ["attendance.take", "students.view", "comms.send_class"],
      [
        read("flag.chronic.absence", "Flag pupils with repeated absence", "students.view"),
        read("summarise.register", "Summarise today's registers", "students.view"),
        propose(
          "propose.register.marks",
          "Suggest register marks for a teacher to confirm",
          "attendance.take",
        ),
        send("send.absence.notice", "Send an absence notice to a guardian", "comms.send_class"),
      ],
    ),
  },
  {
    codename: "Marksheet",
    accountable: "principal",
    template: "exams_records",
    anchorFeature: "report_cards",
    minTier: null,
    rationale: "Report cards first appear on Starter.",
    pack: pack(
      "org-report-cards",
      "Organization report cards agent",
      "principal",
      ["results"],
      ["grades.view", "exams.schedule"],
      [
        read("check.missing.scores", "Find missing scores before a report run", "grades.view"),
        read("draft.comments", "Draft report card comments for teachers to edit", "grades.view"),
        read("compile.report.cards", "Compile report cards for review", "grades.view"),
        propose(
          "propose.publish.results",
          "Propose publishing results for a human decision",
          "grades.view",
        ),
      ],
    ),
  },
  {
    codename: "Courier",
    accountable: "admin",
    template: "pr",
    anchorFeature: "email_notifications",
    minTier: null,
    rationale: "Email notifications first appear on Starter.",
    pack: pack(
      "org-parent-comms",
      "Organization parent communications agent",
      "admin",
      ["communications"],
      ["news.publish"],
      [
        read("draft.newsletter", "Draft a newsletter", "news.publish"),
        read("draft.announcement", "Draft an announcement", "news.publish"),
        propose(
          "propose.broadcast",
          "Propose a school-wide broadcast for a human to send",
          "news.publish",
        ),
        send("publish.news", "Publish a news item", "news.publish"),
      ],
    ),
  },
  {
    codename: "Intake",
    accountable: "admin",
    template: "admissions",
    anchorFeature: "ai_admissions_review",
    minTier: null,
    rationale: "AI admissions review is already a Growth feature.",
    pack: pack(
      "org-admissions",
      "Organization admissions agent",
      "admin",
      ["admissions"],
      ["admissions.view", "admissions.process", "students.view", "comms.send_class"],
      [
        read(
          "screen.applications",
          "Screen applications against entry requirements",
          "admissions.view",
        ),
        read("flag.incomplete", "Flag incomplete applications", "admissions.view"),
        send("send.applicant.update", "Send an update to an applicant", "comms.send_class"),
        propose(
          "propose.admission",
          "Recommend an admission decision for a human",
          "admissions.process",
        ),
      ],
    ),
  },
  {
    codename: "Bell",
    accountable: "principal",
    template: "deputy_academic",
    anchorFeature: "ai_timetable",
    minTier: null,
    rationale: "AI timetabling is already a Growth feature.",
    pack: pack(
      "org-timetable",
      "Organization timetable agent",
      "principal",
      ["timetable"],
      ["timetable.view", "timetable.manage", "classes.manage"],
      [
        read("detect.clashes", "Detect teacher, room and class clashes", "timetable.view"),
        read("suggest.cover", "Suggest cover for an absent teacher", "timetable.view"),
        propose(
          "propose.timetable",
          "Propose a timetable for a human to approve",
          "timetable.manage",
        ),
        propose("propose.class.change", "Propose a class arrangement change", "classes.manage"),
      ],
    ),
  },
  {
    codename: "Haven",
    accountable: "principal",
    template: "counsellor",
    anchorFeature: "student_at_risk",
    minTier: null,
    rationale: "Student at-risk detection is already a Growth feature.",
    pack: pack(
      "org-safeguarding",
      "Organization safeguarding agent",
      "principal",
      ["welfare"],
      ["welfare.pastoral", "students.view", "attendance.view", "discipline.record"],
      [
        read(
          "screen.concern",
          "Screen a concern and suggest its urgency for the safeguarding lead",
          "welfare.pastoral",
        ),
        read(
          "surface.patterns",
          "Surface absence and incident patterns for the safeguarding lead",
          "attendance.view",
        ),
        propose(
          "propose.referral",
          "Propose a referral for the safeguarding lead to decide",
          "welfare.pastoral",
        ),
      ],
    ),
  },
  {
    codename: "Route",
    accountable: "admin",
    template: "transport_head",
    anchorFeature: "bus_live_tracking",
    minTier: null,
    rationale: "Live bus tracking is already a Growth feature.",
    pack: pack(
      "org-transport",
      "Organization transport agent",
      "admin",
      ["transport"],
      ["transport.manage", "transport.track", "comms.send_class"],
      [
        read("flag.route.delay", "Flag a delayed or off-route trip", "transport.track"),
        read("draft.trip.notice", "Draft a trip notice", "transport.manage"),
        send("send.trip.notice", "Send a trip notice to guardians", "comms.send_class"),
        propose("propose.route.change", "Propose a route change", "transport.manage"),
      ],
    ),
  },
  {
    codename: "Overview",
    accountable: "hq",
    template: "proprietor",
    anchorFeature: "advanced_analytics",
    minTier: null,
    rationale: "Advanced analytics is already a Growth feature.",
    pack: pack(
      "org-proprietor",
      "Organization proprietor reporting agent",
      "hq",
      ["reporting"],
      ["analytics.institution", "reports.financial", "reports.academic"],
      [
        read("compose.board.pack", "Compose the board pack", "analytics.institution"),
        read("summarise.finances", "Summarise the finances", "reports.financial"),
        read("summarise.academics", "Summarise academic performance", "reports.academic"),
        read("flag.kpi.drift", "Flag a measure drifting from its target", "analytics.institution"),
      ],
    ),
  },
  {
    codename: "Sitting",
    accountable: "principal",
    template: "exams_officer",
    anchorFeature: null,
    minTier: "growth",
    rationale:
      "Exam logistics sit with the AI academic tools on Growth; no existing feature is exam-specific.",
    pack: pack(
      "org-exams",
      "Organization examinations agent",
      "principal",
      ["exams"],
      ["exams.schedule", "exams.invigilate", "attendance.view", "grades.view"],
      [
        read("detect.exam.clashes", "Detect exam clashes", "exams.schedule"),
        read("draft.invigilation.roster", "Draft an invigilation roster", "exams.invigilate"),
        read("flag.absentees", "Flag pupils absent from a paper", "attendance.view"),
        propose(
          "propose.exam.timetable",
          "Propose an exam timetable for a human to approve",
          "exams.schedule",
        ),
      ],
    ),
  },
  {
    codename: "Archive",
    accountable: "admin",
    template: "registrar",
    anchorFeature: null,
    minTier: "growth",
    rationale:
      "Bulk import and record clean-up arrive with Growth; no existing feature is records-specific.",
    pack: pack(
      "org-records",
      "Organization records agent",
      "admin",
      ["records"],
      ["students.view", "students.edit", "admissions.view"],
      [
        read("find.duplicates", "Find duplicate student records", "students.view"),
        read("flag.record.gaps", "Flag missing or inconsistent record fields", "students.view"),
        propose("propose.record.fix", "Propose a record correction for a human", "students.edit"),
      ],
    ),
  },
  {
    codename: "Roster",
    accountable: "admin",
    template: "hr",
    anchorFeature: null,
    minTier: "professional",
    rationale: "Staff wellbeing and workforce analytics start on Professional.",
    pack: pack(
      "org-staff-admin",
      "Organization staff administration agent",
      "admin",
      ["staff"],
      ["hr.staff_view", "hr.leave_approve", "hr.appraisal"],
      [
        read("summarise.leave", "Summarise leave balances", "hr.staff_view"),
        read("flag.cover.gaps", "Flag cover gaps from approved leave", "hr.staff_view"),
        read("draft.appraisal.notes", "Draft appraisal notes for the appraiser", "hr.appraisal"),
        propose(
          "propose.leave.decision",
          "Propose a leave decision for a human",
          "hr.leave_approve",
        ),
      ],
    ),
  },
  {
    codename: "Upkeep",
    accountable: "admin",
    template: "works",
    anchorFeature: "fleet_management",
    minTier: null,
    rationale: "Fleet and asset management first appears on Professional.",
    pack: pack(
      "org-facilities",
      "Organization facilities agent",
      "admin",
      ["facilities"],
      ["works.requests", "assets.manage", "inventory.manage", "procurement.request"],
      [
        read("triage.requests", "Triage maintenance requests", "works.requests"),
        read("flag.low.stock", "Flag low stock", "inventory.manage"),
        read("draft.work.order", "Draft a work order", "works.requests"),
        propose(
          "propose.procurement",
          "Propose a purchase request for a human",
          "procurement.request",
        ),
      ],
    ),
  },
  {
    codename: "Scaffold",
    accountable: "principal",
    template: "teaching_support",
    anchorFeature: null,
    minTier: "professional",
    rationale:
      "Individual learning support builds on the Growth at-risk signals and is placed one plan above them.",
    pack: pack(
      "org-learning-support",
      "Organization learning support agent",
      "principal",
      ["learning-support"],
      ["students.view", "lesson_notes.submit", "comms.send_class"],
      [
        read(
          "suggest.support.strategies",
          "Suggest learning-support strategies for a pupil",
          "students.view",
        ),
        read(
          "draft.lesson.adaptation",
          "Draft a lesson adaptation for a teacher",
          "lesson_notes.submit",
        ),
        send(
          "send.parent.update",
          "Send a learning-support update to a guardian",
          "comms.send_class",
        ),
      ],
    ),
  },
  {
    codename: "Shield",
    accountable: "principal",
    template: "data_protection",
    anchorFeature: null,
    minTier: "professional",
    rationale: "Data-protection operations are a compliance product and sit on Professional.",
    pack: pack(
      "org-compliance",
      "Organization data protection agent",
      "principal",
      ["compliance"],
      ["ndpa.dsar", "audit.view"],
      [
        read("track.dsar.deadlines", "Track data-subject request deadlines", "ndpa.dsar"),
        read("draft.dsar.response", "Draft a response to a data-subject request", "ndpa.dsar"),
        read("flag.retention.due", "Flag records past their retention period", "audit.view"),
        propose(
          "propose.breach.notice",
          "Propose a breach notice for a human decision",
          "ndpa.dsar",
        ),
      ],
    ),
  },
  {
    codename: "Legacy",
    accountable: "admin",
    template: "alumni",
    anchorFeature: "alumni_portal",
    minTier: null,
    rationale: "The alumni portal is already an Enterprise feature.",
    pack: pack(
      "org-alumni",
      "Organization alumni agent",
      "admin",
      ["alumni"],
      ["alumni.manage", "news.publish"],
      [
        read("segment.alumni", "Segment alumni for outreach", "alumni.manage"),
        read("draft.alumni.newsletter", "Draft an alumni newsletter", "news.publish"),
        propose(
          "propose.alumni.broadcast",
          "Propose an alumni broadcast for a human to send",
          "alumni.manage",
        ),
        propose("propose.reunion", "Propose a reunion plan", "alumni.manage"),
      ],
    ),
  },
]);

export const ORG_AGENT_PACKS: readonly RolePack[] = ORG_AGENTS.map((a) => a.pack);
