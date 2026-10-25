/** Widget bodies. In the lab they render sample data; in the live app each widget loads its own data through
 *  the existing RLS-protected queries/RPCs (the server re-checks the permission there too). Until a widget's
 *  live loader is wired, the live shell shows a light card that links to the full page (no fake numbers). */
import type { ManifestItem } from "@/lib/sherivs-ws/engine";
import type { CardData } from "@/lib/sherivs-ws/live";
type Body = {
  metric?: string;
  note?: string;
  list?: [string, string][];
  bar?: number;
  warn?: string;
};
const naira = (n: number) => "₦" + n.toLocaleString("en-NG");
export const SAMPLE: Record<string, Body> = {
  "w.today_classes": {
    list: [
      ["08:00 JSS2A Mathematics", "Rm 4"],
      ["10:10 JSS2C Mathematics", "Rm 4"],
      ["12:30 JSS3B Further Maths", "Lab 2"],
    ],
  },
  "w.attendance_todo": { metric: "2", note: "registers still open this morning" },
  "w.grading_queue": { metric: "64", note: "CA2 scores left to enter, due Fri" },
  "w.lesson_note_status": {
    metric: "Wk 7",
    note: "submitted · awaiting HOD",
    warn: "Wk 8 due Monday",
  },
  "w.lesson_note_approvals": { metric: "11", note: "lesson notes awaiting your approval" },
  "w.cbt_sessions": {
    list: [
      ["JSS2 Maths mock (CBT)", "Thu 9:00"],
      ["JSS3 BECE practice", "Mon 11:00"],
    ],
  },
  "w.form_class": {
    metric: "38 / 41",
    note: "present today in your form class",
    list: [
      ["Absent 3 days in a row", "2 pupils"],
      ["Fees owing (parents notified)", "5 pupils"],
    ],
  },
  "w.at_risk": { metric: "17", note: "students flagged by early warning this week" },
  "w.dept_performance": {
    list: [
      ["Biology", "64% avg"],
      ["Chemistry", "58% avg"],
      ["Physics", "61% avg"],
    ],
    bar: 61,
  },
  "w.results_pipeline": {
    list: [
      ["Scores entered", "92%"],
      ["HOD approved", "71%"],
      ["Principal approved", "40%"],
      ["Published to parents", "0%"],
    ],
    bar: 71,
  },
  "w.exam_timetable": {
    list: [
      ["ND1 Engineering Maths", "Mon 8 Dec"],
      ["HND2 Project defence", "Wed 10 Dec"],
    ],
  },
  "w.malpractice": { metric: "3", note: "cases awaiting panel decision" },
  "w.fee_collection": {
    metric: naira(48_350_000),
    note: "collected of " + naira(71_200_000) + " this term (68%)",
    bar: 68,
  },
  "w.reconciliation": {
    metric: "14",
    note: "Paystack / bank transfers to match",
    warn: "2 over 48 h",
  },
  "w.defaulters": { metric: naira(22_850_000), note: "outstanding across 312 students" },
  "w.expense_approvals": { metric: "6", note: "expense claims awaiting approval" },
  "w.wallet_balance": { metric: naira(1_245_600), note: "school wallet (SMS, AI, top-ups)" },
  "w.payroll_run": {
    metric: "Nov",
    note: "payroll prepared · awaiting approval",
    warn: "Pay date 25 Nov",
  },
  "w.leave_requests": { metric: "4", note: "leave requests to review" },
  "w.staff_attendance": { metric: "86 / 92", note: "staff signed in today" },
  "w.admissions_funnel": {
    list: [
      ["Applied", "1,240"],
      ["Screened (Post-UTME)", "910"],
      ["Admitted", "620"],
      ["Accepted & paid", "402"],
    ],
    bar: 65,
  },
  "w.enrolment": { metric: "1,214", note: "students this session (+6%)" },
  "w.school_health": {
    list: [
      ["Attendance today", "94%"],
      ["Fees collected", "68%"],
      ["Results ready", "71%"],
      ["Staff present", "93%"],
    ],
    bar: 68,
  },
  "w.cashflow": { metric: naira(9_120_000), note: "net this month after payroll and expenses" },
  "w.governance": { metric: "2", note: "board actions and 1 audit finding open" },
  "w.library_loans": {
    list: [
      ["Overdue", "37 books"],
      ["Due this week", "112 books"],
    ],
  },
  "w.hostel_roll": {
    metric: "212 / 214",
    note: "boarders accounted for at last roll call",
    warn: "2 on exeat",
  },
  "w.hostel_beds": { metric: "18", note: "bed spaces free" },
  "w.sick_bay": { metric: "5", note: "students seen today · 1 referred" },
  "w.bus_live": {
    list: [
      ["Route 1 Ajah", "On time"],
      ["Route 3 Lekki Ph 1", "8 min late"],
      ["Route 5 VI", "Arrived"],
    ],
  },
  "w.my_trip": {
    metric: "Route 3",
    note: "Lekki Phase 1 → School · 23 pupils",
    list: [
      ["Next stop", "Admiralty Way"],
      ["Pick-ups left", "9"],
    ],
  },
  "w.gate_log": {
    list: [
      ["Visitors signed in", "27"],
      ["Pupils picked up early", "4"],
      ["Unknown pick-up attempts", "0"],
    ],
  },
  "w.incidents": { metric: "1", note: "open incident report" },
  "w.children_summary": {
    list: [
      ["Tolu · JSS2A", "Present · 72% avg"],
      ["Kemi · Primary 4", "Present · 81% avg"],
    ],
  },
  "w.child_fees": { metric: naira(185_000), note: "first-term balance, due 15 Nov" },
  "w.child_bus": { metric: "8 min", note: "Route 3 bus away from your stop" },
  "w.my_timetable": {
    list: [
      ["08:00 Mathematics", "Mr Nwosu"],
      ["09:20 English", "Mrs Lawal"],
      ["11:00 Basic Science", "Lab 1"],
    ],
  },
  "w.my_results": { metric: "72%", note: "average · 2nd term · position hidden by school policy" },
  "w.my_cbt": { metric: "2", note: "CBT tests this week" },
  "w.ai_tutor": {
    note: "Ask about any topic in your scheme of work. Works in English, Hausa, Yorùbá, Igbo and Pidgin.",
  },
  "w.ai_lesson_helper": { note: "Draft a lesson note from the NERDC scheme of work for Week 8." },
  "w.gov_overview": {
    list: [
      ["Schools reporting", "1,184 / 1,240"],
      ["Average attendance", "88%"],
      ["Teachers per class", "1.4"],
    ],
    bar: 95,
  },
  "w.gov_compliance": {
    list: [
      ["Inspections due", "42"],
      ["Unapproved schools flagged", "7"],
    ],
  },
  "w.announcements": {
    list: [
      ["Inter-house sports, Fri 14 Nov", "School"],
      ["PTA meeting, Sat 9:00", "PTA"],
    ],
  },
};
export function WidgetBody({
  item,
  sample,
  live,
  loading,
}: {
  item: ManifestItem;
  sample: boolean;
  live?: CardData;
  loading?: boolean;
}) {
  if (!sample && loading && !live)
    return <div className="sds-skel" style={{ height: 40 }} aria-hidden="true" />;
  if (live?.unavailable) return <p className="sds-metric-note">Open the page to see details.</p>;
  const b: Body | undefined = sample
    ? SAMPLE[item.key]
    : live
      ? {
          metric:
            live.metric === undefined
              ? undefined
              : live.money
                ? naira(Number(live.metric))
                : String(live.metric),
          note: live.note,
          list: live.list,
          bar: live.bar,
          warn: live.warn,
        }
      : undefined;
  if (!b) return <p className="sds-metric-note">{item.label}</p>;
  if (b.list && b.list.length === 0 && !b.metric)
    return <p className="sds-metric-note">Nothing scheduled yet.</p>;
  return (
    <>
      {b.metric && <div className="sds-metric">{b.metric}</div>}
      {b.note && <div className="sds-metric-note">{b.note}</div>}
      {b.bar !== undefined && (
        <div className="sds-bar" role="img" aria-label={`${b.bar}%`}>
          <span style={{ width: `${b.bar}%` }} />
        </div>
      )}
      {b.list && (
        <ul className="sds-list">
          {b.list.map(([a, v]) => (
            <li key={a}>
              <span>{a}</span>
              <span className="sds-muted">{v}</span>
            </li>
          ))}
        </ul>
      )}
      {b.warn && (
        <div>
          <span className="sds-pill-warn">{b.warn}</span>
        </div>
      )}
    </>
  );
}
