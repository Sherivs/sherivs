import { syncClassAttendance } from "@/lib/runtime/scholar/attendance.functions";
import {
  createAttendanceQueue,
  type ClassAttendanceMark,
  type QueuedMark,
} from "./attendance-queue";

type QueueOptions = Omit<Parameters<typeof createAttendanceQueue>[0], "sync">;

function isClassMark(mark: QueuedMark): mark is QueuedMark & ClassAttendanceMark {
  return Boolean(mark.class_id && mark.period_key && mark.shift_id !== undefined);
}

export function createClassAttendanceQueue(options: QueueOptions) {
  return createAttendanceQueue({
    ...options,
    sync: async (batch, items, clientNow) => {
      if (!items.every(isClassMark)) {
        throw new Error("Class, shift, and period are required for attendance sync");
      }
      return syncClassAttendance({
        data: { batch, items: items as (QueuedMark & ClassAttendanceMark)[], clientNow },
      });
    },
  });
}
