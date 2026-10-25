import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cached, isNetworkError, saveOrQueue } from "@/lib/offline/save-or-queue";

const marks = [{ student_id: "s1", status: "present" }];
describe("SHERIVS-A07b teacher attendance works offline", () => {
  it("queues straight away when the device is offline", async () => {
    const q: unknown[] = []; let saved = 0;
    const r = await saveOrQueue({ online: false, marks, save: async () => { saved++; }, queue: (m) => q.push(...m) });
    expect(r).toEqual({ mode: "queued", queued: 1 }); expect(saved).toBe(0); expect(q).toHaveLength(1);
  });
  it("saves online when it can", async () => {
    const q: unknown[] = [];
    expect(await saveOrQueue({ online: true, marks, save: async () => ({ ok: true }), queue: (m) => q.push(...m) })).toEqual({ mode: "saved" });
    expect(q).toHaveLength(0);
  });
  it("falls back to the queue when the connection drops mid-save", async () => {
    const q: unknown[] = [];
    const r = await saveOrQueue({ online: true, marks, save: async () => { throw new TypeError("Failed to fetch"); }, queue: (m) => q.push(...m) });
    expect(r.mode).toBe("queued"); expect(q).toHaveLength(1);
  });
  it("never queues a server refusal", async () => {
    const q: unknown[] = [];
    await expect(saveOrQueue({ online: true, marks, save: async () => { throw new Error("not allowed"); }, queue: (m) => q.push(...m) })).rejects.toThrow("not allowed");
    expect(q).toHaveLength(0);
  });
  it("refuses an empty save", async () => {
    await expect(saveOrQueue({ online: false, marks: [], save: async () => 0, queue: () => {} })).rejects.toThrow(/at least one/);
  });
  it("recognises network errors and not others", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkError(new Error("date_out_of_range"))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
  it("caches the roster for offline reloads and tolerates broken storage", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const c = cached<{ id: string }[]>(st, "roster.c1"); c.set([{ id: "s1" }]);
    expect(cached<{ id: string }[]>(st, "roster.c1").get()).toEqual([{ id: "s1" }]);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(() => cached(broken, "x").set(1)).not.toThrow(); expect(cached(broken, "x").get()).toBeUndefined();
  });
  it("the teacher screen uses the v2 offline queue and shows sync state", () => {
    const src = readFileSync("frontend/src/routes/_authenticated/teacher/attendance.tsx", "utf8");
    expect(src).toContain("createAttendanceQueue");
    expect(src).toContain("offline_attendance_sync_v2");
    expect(src).toContain("saveOrQueue");
    expect(src).toMatch(/autoFlush\(window\)/);
  });
});
