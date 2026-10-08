/**
 * CoreGrid — per-page guidance registry (Scholar R-001 UI surface).
 *
 * Route-keyed "what can I do on this page" tips shown inside the portal shell.
 * Pure data + matcher; tips are guidance text only — they never change
 * behavior, capability or authorization. The match picks the LONGEST
 * registered prefix for the current path so specific pages override generic
 * area tips.
 */
export interface PageTips {
  /** Route prefixes this tip card applies to (longest match wins). */
  patterns: string[];
  title: string;
  tips: string[];
}

export const PAGE_TIPS: ReadonlyArray<PageTips> = [
  {
    patterns: ["/admin/staff-accounts"],
    title: "Staff & user accounts",
    tips: [
      "Pick the access level (Role) AND the real post the person holds (Position) — one person can hold several positions, and the ★ marks their primary post.",
      "End a position with the × on its chip; ending a primary post auto-promotes their next open position.",
      "New accounts also register a canonical identity (P02) — credentials are shown only once.",
    ],
  },
  {
    patterns: ["/admin/hr"],
    title: "HR & workforce",
    tips: [
      "Positions reflect real African school posts (71 kinds) — manage them per person from Staff & user accounts.",
      "The staffing-reality summary shows open posts, families and primary roles at a glance.",
    ],
  },
  {
    patterns: ["/admin/analytics", "/admin/intelligence"],
    title: "Analytics & intelligence",
    tips: [
      "Filter by class, level or period before reading trends — every chart adapts to the selected scope.",
      "Use AI summaries as a starting point; always verify against the underlying records.",
    ],
  },
  {
    patterns: ["/admin/fees", "/bursar"],
    title: "Fees & finance",
    tips: [
      "Fees, payment plans and receipts are tenant-scoped — you only ever see your organization's data.",
      "Payment confirmations are verified server-side; reconcile against the ledger before approval.",
    ],
  },
  {
    patterns: ["/admin/timetable", "/admin/classes", "/teacher"],
    title: "Timetable & classes",
    tips: [
      "Schedules respect the school's own hours — morning/afternoon shifts and boarding sessions included.",
      "Class lists and grades update from attendance and assessment records in real time.",
    ],
  },
  {
    patterns: ["/admin/library"],
    title: "Library",
    tips: ["Catalog books, track borrowings and manage reading rooms from one place."],
  },
  {
    patterns: ["/admin/school-profile"],
    title: "School profile & templates",
    tips: [
      "Tick what your school ACTUALLY runs — Sherivs recommends matching templates but never forces any feature on you.",
      "A template is only a starting point; every choice stays reversible and your own mix is always supported.",
    ],
  },
  {
    patterns: ["/admin/facilities"],
    title: "Facilities & twin estate",
    tips: [
      "Each facility is bound to a Sherivs twin kind — sensors, inspections and occupancy reports attach to that binding.",
      "The metric chips show which observation attributes the facility can publish (occupancy, temperature, power, water, maintenance, availability).",
    ],
  },
  {
    patterns: ["/admin"],
    title: "Administration",
    tips: [
      "The sidebar groups every administrative surface: academics, finance, learners, communication and platform.",
      "Use Staff & user accounts to reflect your real workforce, then set exam, fee and timetable data to match your calendar.",
    ],
  },
  {
    patterns: ["/parent"],
    title: "Parent portal",
    tips: [
      "Follow your child's grades, attendance, fees and bus route here — notifications keep you updated.",
      "Messages sent from this portal go to the right staff contact for your child's school.",
    ],
  },
  {
    patterns: ["/student"],
    title: "Student portal",
    tips: [
      "Check your timetable, grades and report card. Use the AI tutor for study help on your own work.",
      "Offline? You can still read your timetable — changes sync when the connection returns.",
    ],
  },
  {
    patterns: ["/settings"],
    title: "Settings",
    tips: [
      "Update your profile, notification preferences and security details here.",
      "Changes apply to your account only — organization settings are managed by administrators.",
    ],
  },
  {
    patterns: ["/messages"],
    title: "Messages",
    tips: [
      "Conversations stay within your organization and role scope — you can only message who you're allowed to reach.",
    ],
  },
  {
    patterns: ["/notifications"],
    title: "Notifications",
    tips: [
      "Notifications are push-enabled after you opt in — you can manage topics from settings.",
    ],
  },
];

/** Longest registered prefix match for a path; null when no guidance exists. */
export function findTipsForPath(path: string): PageTips | null {
  const normalized = path.split("?")[0] ?? path;
  let best: PageTips | null = null;
  for (const entry of PAGE_TIPS) {
    for (const pattern of entry.patterns) {
      if (normalized.startsWith(pattern)) {
        if (!best || pattern.length > best.patterns[0].length) best = entry;
      }
    }
  }
  return best;
}
