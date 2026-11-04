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
    instructors: [
      {
        id: "instructor-1",
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
  const instructors = Array.from({ length: 5 }, (_, index) => ({
    id: `instructor-${index}`,
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
    instructors,
    rooms,
    teachingLoads: Array.from({ length: 3 }, (_, classIndex) =>
      subjects.map((subjectId) => ({
        classArmId: `class-${classIndex}`,
        subjectId,
        periodsPerWeek: 1 + Math.floor(random() * 2),
        instructorIds: instructors.filter(() => random() > 0.5).map((instructor) => instructor.id),
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
  const instructors = new Map(input.instructors.map((instructor) => [instructor.id, instructor]));
  const rooms = new Map(input.rooms.map((room) => [room.id, room]));
  const loads = new Map(
    input.teachingLoads.map((load) => [JSON.stringify([load.classArmId, load.subjectId]), load]),
  );
  const occupiedClasses = new Set<string>();
  const occupiedInstructors = new Set<string>();
  const occupiedRooms = new Set<string>();

  for (const placement of result.placements) {
    const period = periods.get(placement.periodId);
    const instructor = instructors.get(placement.instructorId);
    const room = rooms.get(placement.roomId);
    const load = loads.get(JSON.stringify([placement.classArmId, placement.subjectId]));
    if (!period || !instructor || !room || !load)
      throw new Error("solver emitted unknown references");
    const classKey = `${placement.classArmId}:${period.id}`;
    const instructorKey = `${placement.instructorId}:${period.id}`;
    const roomKey = `${placement.roomId}:${period.id}`;

    expect(occupiedClasses.has(classKey)).toBe(false);
    expect(occupiedInstructors.has(instructorKey)).toBe(false);
    expect(occupiedRooms.has(roomKey)).toBe(false);
    occupiedClasses.add(classKey);
    occupiedInstructors.add(instructorKey);
    occupiedRooms.add(roomKey);

    expect(instructor.qualifiedSubjectIds).toContain(placement.subjectId);
    if (load.instructorIds !== undefined)
      expect(load.instructorIds).toContain(placement.instructorId);
    expect(instructor.unavailablePeriodIds ?? []).not.toContain(period.id);
    if (instructor.availablePeriodIds !== undefined) {
      expect(instructor.availablePeriodIds).toContain(period.id);
    }
    expect(room.capacity).toBeGreaterThanOrEqual(
      classArms.get(placement.classArmId)?.learnerCount ?? 0,
    );
    if (load.requiredRoomType) expect(room.type).toBe(load.requiredRoomType);
    expect(room.unavailablePeriodIds ?? []).not.toContain(period.id);
    if (room.availablePeriodIds !== undefined) expect(room.availablePeriodIds).toContain(period.id);
    expect(placement.hardConstraints.length).toBeGreaterThan(0);
    expect(placement.explanation.length).toBeGreaterThan(0);
  }

  expect(
    new Set([...result.placements, ...result.unplaced].map((activity) => activity.activityId)).size,
  ).toBe(result.requestedActivityCount);
  expect(result.requestedActivityCount).toBe(result.placements.length + result.unplaced.length);
  expect(result.unplaced.every((activity) => activity.explanation.length > 0)).toBe(true);
  for (const load of input.teachingLoads) {
    const count = result.placements.filter(
      (placement) =>
        placement.classArmId === load.classArmId && placement.subjectId === load.subjectId,
    ).length;
    const unplacedCount = result.unplaced.filter(
      (activity) =>
        activity.classArmId === load.classArmId && activity.subjectId === load.subjectId,
    ).length;
    expect(count + unplacedCount).toBe(load.periodsPerWeek);
  }
  expect(result.qualityScore).toBeGreaterThanOrEqual(0);
  expect(result.qualityScore).toBeLessThanOrEqual(100);
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
      instructors: [
        {
          id: "instructor-1",
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

  it("rejects overlapping period definitions instead of allowing ambiguous bookings", () => {
    const input = makeSimpleInput({
      periods: [
        {
          id: "first",
          dayOfWeek: 1,
          periodNumber: 1,
          startMinute: 480,
          endMinute: 540,
        },
        {
          id: "overlap",
          dayOfWeek: 1,
          periodNumber: 2,
          startMinute: 530,
          endMinute: 570,
        },
      ],
    });

    expect(() => solveWeeklyTimetable(input)).toThrow(/periods must not overlap/i);
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

  it("honors instructor period preferences and minimizes daily gaps", () => {
    const input = makeSimpleInput({
      periods: makePeriods(1, 5),
      classArms: [
        { id: "jss1-a", learnerCount: 25 },
        { id: "jss1-b", learnerCount: 25 },
      ],
      instructors: [
        {
          id: "instructor-1",
          qualifiedSubjectIds: ["math", "science"],
          preferredPeriodIds: ["d1-p1"],
        },
      ],
      teachingLoads: [
        { classArmId: "jss1-a", subjectId: "math", periodsPerWeek: 1 },
        { classArmId: "jss1-b", subjectId: "science", periodsPerWeek: 1 },
      ],
    });
    const result = solveWeeklyTimetable(input);

    expect(result.placements.map((placement) => placement.periodId)).toEqual(["d1-p1", "d1-p2"]);
    expect(result.placements[0].explanation).toContain("Matches the instructor's preferred period");
    expectHardConstraints(input);
  });

  it("scores unavoidable back-to-back heavy activities without violating hard constraints", () => {
    const input = makeSimpleInput({
      periods: makePeriods(1, 2),
      teachingLoads: [
        { classArmId: "jss1-a", subjectId: "math", periodsPerWeek: 1, heavy: true },
        { classArmId: "jss1-a", subjectId: "english", periodsPerWeek: 1, heavy: true },
      ],
    });
    const result = solveWeeklyTimetable(input);

    expect(result.placements.map((placement) => placement.score)).toEqual([88, 100]);
    expect(
      result.placements.some((placement) =>
        placement.explanation.some((reason) => reason.includes("back-to-back")),
      ),
    ).toBe(true);
    expectHardConstraints(input);
  });

  it("never violates hard constraints across seeded random inputs", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const input = makeRandomInput(seed);
      expectHardConstraints(input);
      expect(solveWeeklyTimetable(input)).toEqual(solveWeeklyTimetable(input));
    }
  });

  it("solves a simulated 30-arm, 60-instructor JSS1–SS3 school within seconds", () => {
    const periods = makePeriods(5, 6);
    const subjects = Array.from({ length: 10 }, (_, index) => `subject-${index}`);
    const classArms = Array.from({ length: 30 }, (_, index) => ({
      id: `jss-${Math.floor(index / 10) + 1}-arm-${(index % 10) + 1}`,
      learnerCount: 35,
    }));
    const instructors = Array.from({ length: 60 }, (_, index) => ({
      id: `instructor-${index}`,
      qualifiedSubjectIds: [subjects[Math.floor(index / 6)]],
    }));
    const input: SolveWeeklyTimetableInput = {
      seed: 2026,
      periods,
      classArms,
      instructors,
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
          instructorIds: instructors
            .filter((instructor) => instructor.qualifiedSubjectIds.includes(subjectId))
            .map((instructor) => instructor.id),
          heavy: subjectId === "subject-0" || subjectId === "subject-1",
        })),
      ),
    };
    const startedAt = Date.now();
    const result = solveWeeklyTimetable(input);

    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(result.requestedActivityCount).toBe(900);
    expectHardConstraints(input);
  }, 10_000);
});
