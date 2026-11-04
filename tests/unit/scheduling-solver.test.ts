import { describe, expect, it } from "vitest";
import {
  solveWeeklyTimetable,
  type SolveWeeklyTimetableInput,
  type SolverPeriod,
} from "@/lib/scheduling-core";

function makePeriods(days = 5, perDay = 4): SolverPeriod[] {
  return Array.from({ length: days * perDay }, (_, index) => {
    const periodNumber = (index % perDay) + 1;
    const startMinute = 480 + (periodNumber - 1) * 50;
    return {
      id: `d${Math.floor(index / perDay) + 1}-p${periodNumber}`,
      dayOfWeek: Math.floor(index / perDay) + 1,
      periodNumber,
      startMinute,
      endMinute: startMinute + 40,
    };
  });
}

function makeSimpleInput(
  overrides: Partial<SolveWeeklyTimetableInput> = {},
): SolveWeeklyTimetableInput {
  const periods = makePeriods(2, 3);
  return {
    seed: 42,
    periods,
    classArms: [{ id: "jss1-a", learnerCount: 25 }],
    teachers: [
      {
        id: "teacher-1",
        qualifiedSubjectIds: ["math", "english"],
      },
    ],
    rooms: [{ id: "room-1", type: "classroom", capacity: 30 }],
    teachingLoads: [
      { classArmId: "jss1-a", subjectId: "math", periodsPerWeek: 2 },
      { classArmId: "jss1-a", subjectId: "english", periodsPerWeek: 1 },
    ],
    ...overrides,
  };
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function makeRandomInput(seed: number): SolveWeeklyTimetableInput {
  const random = makeRandom(seed);
  const periods = makePeriods(5, 4);
  const subjects = ["math", "english", "science", "history"];
  const teachers = Array.from({ length: 5 }, (_, index) => ({
    id: `teacher-${index}`,
    qualifiedSubjectIds: subjects.filter(() => random() > 0.35),
    unavailablePeriodIds: periods.filter(() => random() < 0.12).map((period) => period.id),
  }));
  const rooms = Array.from({ length: 4 }, (_, index) => ({
    id: `room-${index}`,
    type: index === 3 ? "laboratory" : "classroom",
    capacity: 20 + index * 5,
    unavailablePeriodIds: periods.filter(() => random() < 0.08).map((period) => period.id),
  }));

  return {
    seed,
    periods,
    classArms: Array.from({ length: 3 }, (_, index) => ({
      id: `class-${index}`,
      learnerCount: 18 + Math.floor(random() * 15),
    })),
    teachers,
    rooms,
    teachingLoads: Array.from({ length: 3 }, (_, classIndex) =>
      subjects.map((subjectId) => ({
        classArmId: `class-${classIndex}`,
        subjectId,
        periodsPerWeek: 1 + Math.floor(random() * 2),
        teacherIds: teachers.filter(() => random() > 0.5).map((teacher) => teacher.id),
        requiredRoomType: subjectId === "science" && random() > 0.5 ? "laboratory" : "classroom",
        heavy: subjectId === "math" || subjectId === "english" || subjectId === "science",
      })),
    ).flat(),
  };
}

function expectHardConstraints(input: SolveWeeklyTimetableInput): void {
  const result = solveWeeklyTimetable(input);
  const periods = new Map(input.periods.map((period) => [period.id, period]));
  const classArms = new Map(input.classArms.map((arm) => [arm.id, arm]));
  const teachers = new Map(input.teachers.map((teacher) => [teacher.id, teacher]));
  const rooms = new Map(input.rooms.map((room) => [room.id, room]));
  const loads = new Map(
    input.teachingLoads.map((load) => [JSON.stringify([load.classArmId, load.subjectId]), load]),
  );
  const occupiedClasses = new Set<string>();
  const occupiedTeachers = new Set<string>();
  const occupiedRooms = new Set<string>();

  for (const placement of result.placements) {
    const period = periods.get(placement.periodId);
    const teacher = teachers.get(placement.teacherId);
    const room = rooms.get(placement.roomId);
    const load = loads.get(JSON.stringify([placement.classArmId, placement.subjectId]));
    if (!period || !teacher || !room || !load) throw new Error("solver emitted unknown references");
    const classKey = `${placement.classArmId}:${period.id}`;
    const teacherKey = `${placement.teacherId}:${period.id}`;
    const roomKey = `${placement.roomId}:${period.id}`;

    expect(occupiedClasses.has(classKey)).toBe(false);
    expect(occupiedTeachers.has(teacherKey)).toBe(false);
    expect(occupiedRooms.has(roomKey)).toBe(false);
    occupiedClasses.add(classKey);
    occupiedTeachers.add(teacherKey);
    occupiedRooms.add(roomKey);

    expect(teacher.qualifiedSubjectIds).toContain(placement.subjectId);
    if (load.teacherIds !== undefined) expect(load.teacherIds).toContain(placement.teacherId);
    expect(teacher.unavailablePeriodIds ?? []).not.toContain(period.id);
    if (teacher.availablePeriodIds !== undefined) {
      expect(teacher.availablePeriodIds).toContain(period.id);
    }
    expect(room.capacity).toBeGreaterThanOrEqual(
      classArms.get(placement.classArmId)?.learnerCount ?? 0,
    );
    if (load.requiredRoomType) expect(room.type).toBe(load.requiredRoomType);
    expect(room.unavailablePeriodIds ?? []).not.toContain(period.id);
    expect(placement.hardConstraints.length).toBeGreaterThan(0);
    expect(placement.explanation.length).toBeGreaterThan(0);
  }

  expect(result.requestedLessonCount).toBe(result.placements.length + result.unplaced.length);
  expect(result.unplaced.every((lesson) => lesson.explanation.length > 0)).toBe(true);
  for (const load of input.teachingLoads) {
    const count = result.placements.filter(
      (placement) =>
        placement.classArmId === load.classArmId && placement.subjectId === load.subjectId,
    ).length;
    expect(count).toBeLessThanOrEqual(load.periodsPerWeek);
  }
}

describe("solveWeeklyTimetable", () => {
  it("places lessons only when all hard constraints are satisfied", () => {
    const result = solveWeeklyTimetable(makeSimpleInput());

    expect(result.placements).toHaveLength(3);
    expect(result.unplaced).toHaveLength(0);
    expectHardConstraints(makeSimpleInput());
  });

  it("returns an explanation for every unplaceable weekly lesson", () => {
    const input = makeSimpleInput({
      periods: makePeriods(1, 1),
      teachingLoads: [{ classArmId: "jss1-a", subjectId: "math", periodsPerWeek: 2 }],
    });
    const result = solveWeeklyTimetable(input);

    expect(result.placements).toHaveLength(1);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0].explanation.join(" ")).toMatch(/already scheduled|No feasible/);
    expectHardConstraints(input);
  });

  it("uses availability, capacity, and room type as hard constraints", () => {
    const input = makeSimpleInput({
      teachers: [
        {
          id: "teacher-1",
          qualifiedSubjectIds: ["math", "english"],
          availablePeriodIds: ["d2-p1"],
        },
      ],
      rooms: [
        { id: "small-room", type: "classroom", capacity: 10 },
        { id: "lab", type: "laboratory", capacity: 30 },
      ],
      teachingLoads: [
        {
          classArmId: "jss1-a",
          subjectId: "math",
          periodsPerWeek: 1,
          requiredRoomType: "laboratory",
        },
      ],
    });
    const result = solveWeeklyTimetable(input);

    expect(result.placements).toHaveLength(1);
    expect(result.placements[0].periodId).toBe("d2-p1");
    expect(result.placements[0].roomId).toBe("lab");
    expectHardConstraints(input);
  });

  it("spreads a subject when another day is feasible and is stable for the same seed", () => {
    const input = makeSimpleInput({
      seed: "repeatable",
      teachingLoads: [{ classArmId: "jss1-a", subjectId: "math", periodsPerWeek: 2 }],
    });
    const first = solveWeeklyTimetable(input);
    const second = solveWeeklyTimetable(input);

    expect(first).toEqual(second);
    expect(new Set(first.placements.map((placement) => placement.periodId.slice(0, 2))).size).toBe(
      2,
    );
    expectHardConstraints(input);
  });

  it("never violates hard constraints across seeded random inputs", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const input = makeRandomInput(seed);
      expectHardConstraints(input);
      expect(solveWeeklyTimetable(input)).toEqual(solveWeeklyTimetable(input));
    }
  });

  it("solves a simulated 30-arm, 60-teacher JSS1–SS3 school within seconds", () => {
    const periods = makePeriods(5, 6);
    const subjects = Array.from({ length: 10 }, (_, index) => `subject-${index}`);
    const classArms = Array.from({ length: 30 }, (_, index) => ({
      id: `jss-${Math.floor(index / 10) + 1}-arm-${(index % 10) + 1}`,
      learnerCount: 35,
    }));
    const teachers = Array.from({ length: 60 }, (_, index) => ({
      id: `teacher-${index}`,
      qualifiedSubjectIds: [subjects[Math.floor(index / 6)]],
    }));
    const input: SolveWeeklyTimetableInput = {
      seed: 2026,
      periods,
      classArms,
      teachers,
      rooms: Array.from({ length: 30 }, (_, index) => ({
        id: `room-${index}`,
        type: "classroom",
        capacity: 40,
      })),
      teachingLoads: classArms.flatMap((classArm) =>
        subjects.map((subjectId) => ({
          classArmId: classArm.id,
          subjectId,
          periodsPerWeek: 3,
          teacherIds: teachers
            .filter((teacher) => teacher.qualifiedSubjectIds.includes(subjectId))
            .map((teacher) => teacher.id),
          heavy: subjectId === "subject-0" || subjectId === "subject-1",
        })),
      ),
    };
    const startedAt = Date.now();
    const result = solveWeeklyTimetable(input);

    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(result.requestedLessonCount).toBe(900);
    expectHardConstraints(input);
  }, 10_000);
});
