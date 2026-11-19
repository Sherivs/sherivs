/**
 * M7 (ADR-118) teaching screens: static renders with the data hook fed fixtures (no browser DOM
 * is installed, so interactions are covered by the logic and offline tests). Covers the screens
 * today-classes-screen, attendance-screen, gradebook-screen and lesson-notes-screen, their
 * registry entries, the visible offline state, 44 px targets and the "author cannot approve" UI.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  online: true,
  data: {} as Record<string, unknown>,
  source: "network" as "network" | "offline",
  me: "t1",
};

vi.mock("@/lib/runtime/scholar/teaching.functions", () => ({
  getMyClasses: vi.fn(),
  getMyPeriods: vi.fn(),
  getClassRoster: vi.fn(),
  getClassAttendance: vi.fn(),
  correctAttendance: vi.fn(),
  getGradebook: vi.fn(),
  getMyLessonNotes: vi.fn(),
  saveLessonNote: vi.fn(),
  submitLessonNote: vi.fn(),
  getPendingLessonNoteReviews: vi.fn(),
  reviewLessonNote: vi.fn(),
}));
vi.mock("@/lib/runtime/scholar/results.functions", () => ({ enterResultScores: vi.fn() }));
vi.mock("@/lib/offline/class-attendance-queue", () => ({
  createClassAttendanceQueue: () => ({
    pending: async () => [],
    autoFlush: () => () => undefined,
    markForClass: vi.fn(),
    flush: vi.fn(),
  }),
}));
vi.mock("@/contexts/app-context", () => ({ useApp: () => ({ profile: { id: state.me } }) }));
vi.mock("@/components/app-shell/offline-controls", () => ({
  useOfflineScope: () => ({ tenantId: "org-a", userId: state.me, role: "teacher" }),
  useDataSaver: () => [false, () => undefined],
}));
vi.mock("@/components/app-shell/teaching/teaching-common", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/components/app-shell/teaching/teaching-common")>();
  return {
    ...real,
    useOnline: () => state.online,
    useCachedRead: (_domain: string, key: string | null) => ({
      data: key ? state.data[key.split(":").slice(0, 2).join(":")] : undefined,
      source: key && state.data[key.split(":").slice(0, 2).join(":")] ? state.source : null,
      error: null,
      loading: false,
      reload: () => undefined,
    }),
  };
});

const { TodayClassesScreen } = await import("@/components/app-shell/teaching/today-classes-screen");
const { AttendanceScreen } = await import("@/components/app-shell/teaching/attendance-screen");
const { GradebookScreen } = await import("@/components/app-shell/teaching/gradebook-screen");
const { LessonNotesScreen } = await import("@/components/app-shell/teaching/lesson-notes-screen");
const { CARD_REGISTRY, resolveCard } = await import("@/lib/shell/card-registry");

const classes = [
  { class_id: "c1", class_name: "JSS1 A", is_form_class: true, subjects: ["Maths"] },
];

beforeEach(() => {
  state.online = true;
  state.source = "network";
  state.me = "t1";
  state.data = { "m7:classes": classes };
});

describe("Today's classes", () => {
  it("lists own periods with a 44 px link to the register", () => {
    state.data["m7:periods"] = [
      {
        slot_id: "p1",
        class_id: "c1",
        class_name: "JSS1 A",
        period_number: 1,
        start_time: "00:00:00",
        end_time: "00:01:00",
        subject: "Maths",
        room: "3",
      },
    ];
    const html = renderToStaticMarkup(<TodayClassesScreen />);
    expect(html).toContain('data-testid="today-classes-screen"');
    expect(html).toContain("Maths");
    expect(html).toContain('href="/home/s/nav.attendance?class=c1"');
    expect(html).toContain("JSS1 A · form class");
  });

  it("explains an empty day", () => {
    state.data["m7:periods"] = [];
    expect(renderToStaticMarkup(<TodayClassesScreen />)).toContain(
      "No periods on your timetable today",
    );
  });
});

describe("Attendance", () => {
  it("asks for a class first", () => {
    expect(renderToStaticMarkup(<AttendanceScreen />)).toContain("Choose one of your classes");
  });

  it("renders the register with pressed-state buttons per learner", () => {
    state.data["m7:roster"] = [
      { student_id: "s1", display_name: "Ada", admission_number: "A1" },
      { student_id: "s2", display_name: "Bayo", admission_number: null },
    ];
    state.data["m7:marks"] = [];
    const html = renderToStaticMarkup(<AttendanceScreen initialClassId="c1" />);
    expect(html).toContain('data-testid="attendance-screen"');
    expect(html).toContain("Mark everyone present");
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(8);
    expect(html).toContain('role="group" aria-labelledby="learner-s1"');
    expect(html).toContain("Save register");
  });

  it("shows the offline state and saves on the device when offline", () => {
    state.online = false;
    state.source = "offline";
    state.data["m7:roster"] = [{ student_id: "s1", display_name: "Ada", admission_number: null }];
    state.data["m7:marks"] = [];
    const html = renderToStaticMarkup(<AttendanceScreen initialClassId="c1" />);
    expect(html).toContain('data-testid="teaching-offline-notice"');
    expect(html).toContain("You are offline.");
    expect(html).toContain("Showing the copy saved on this device.");
    expect(html).toContain("Save on this device");
  });
});

describe("Gradebook", () => {
  it("renders the entry form without inventing a sheet", () => {
    const html = renderToStaticMarkup(<GradebookScreen />);
    expect(html).toContain('data-testid="gradebook-screen"');
    expect(html).toContain("Open sheet");
    expect(html).not.toContain("<table");
  });
});

describe("Lesson notes", () => {
  it("never offers approve or return on the author's own submission", () => {
    state.data["m7:lesson-notes"] = [
      {
        id: "lp1",
        title: "Fractions",
        subject: "Maths",
        class_id: null,
        topic: null,
        description: null,
        status: "submitted",
        review_notes: null,
        teacher_id: "t1",
      },
    ];
    state.data["m7:lesson-reviews"] = [
      {
        review_id: "r1",
        lesson_plan_id: "lp1",
        submitted_by: "t1",
        submitted_at: "",
        title: "Fractions",
        subject: "Maths",
        description: null,
      },
    ];
    const html = renderToStaticMarkup(<LessonNotesScreen />);
    expect(html).toContain("Waiting for review");
    expect(html).not.toContain(">Approve<");
    expect(html).not.toContain("Waiting for your review");
  });

  it("offers approve and return to a different reviewer", () => {
    state.me = "hod";
    state.data["m7:lesson-notes"] = [];
    state.data["m7:lesson-reviews"] = [
      {
        review_id: "r1",
        lesson_plan_id: "lp1",
        submitted_by: "t1",
        submitted_at: "",
        title: "Fractions",
        subject: "Maths",
        description: "Body",
      },
    ];
    const html = renderToStaticMarkup(<LessonNotesScreen />);
    expect(html).toContain("Waiting for your review");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Return<");
    expect(html).toContain("Comment (needed to return)");
  });

  it("shows a returned draft with the reviewer's comment and lets the author edit", () => {
    state.data["m7:lesson-notes"] = [
      {
        id: "lp1",
        title: "Fractions",
        subject: null,
        class_id: null,
        topic: null,
        description: null,
        status: "draft",
        review_notes: "Add a worked example",
        teacher_id: "t1",
      },
    ];
    state.data["m7:lesson-reviews"] = [];
    const html = renderToStaticMarkup(<LessonNotesScreen />);
    expect(html).toContain("Returned with comment");
    expect(html).toContain("Reviewer: Add a worked example");
    expect(html).toContain(">Edit<");
  });
});

describe("registry and accessibility contract", () => {
  const LIVE = {
    "w.today_classes": "today-classes-screen",
    "nav.my_classes": "today-classes-screen",
    "nav.attendance": "attendance-screen",
    "a.take_attendance": "attendance-screen",
    "w.attendance_todo": "attendance-screen",
    "nav.gradebook": "gradebook-screen",
    "a.enter_scores": "gradebook-screen",
    "w.grading_queue": "gradebook-screen",
    "nav.lesson_notes": "lesson-notes-screen",
    "a.submit_note": "lesson-notes-screen",
    "w.lesson_note_status": "lesson-notes-screen",
    "w.lesson_note_approvals": "lesson-notes-screen",
  };

  it("registers each teaching key as live on its screen, offline where the screen queues", () => {
    for (const [key, module] of Object.entries(LIVE)) {
      const entry = CARD_REGISTRY[key]!;
      expect(resolveCard(key).kind, key).toBe("live");
      expect(entry.screenModule, key).toBe(`frontend/src/components/app-shell/teaching/${module}`);
    }
    expect(CARD_REGISTRY["nav.attendance"]!.offline).toBe(true);
    expect(CARD_REGISTRY["nav.gradebook"]!.offline).toBe(true);
    expect(CARD_REGISTRY["nav.lesson_notes"]!.offline).toBe(false);
    expect(CARD_REGISTRY["nav.gradebook"]!.serverFns).toContain("rpc:m06_enter_result_scores");
  });

  it("keeps assignments and the learner timetable planned (no table, no claims)", () => {
    expect(resolveCard("assignments").kind).toBe("planned");
    expect(CARD_REGISTRY.assignments!.tables).toEqual([]);
    expect(resolveCard("w.my_timetable").kind).toBe("planned");
  });

  it("gives every control a 44 px minimum target", () => {
    const css = readFileSync("frontend/src/components/app-shell/teaching/teaching.css", "utf8");
    expect(css).toMatch(
      /\.teaching-button,\s*\n\.teaching-status button \{\s*\n\s*min-height: 44px;\s*\n\s*min-width: 44px;/,
    );
    expect(css).toContain(":focus-visible");
  });
});
