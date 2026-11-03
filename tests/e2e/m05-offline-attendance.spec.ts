import { expect, test } from "@playwright/test";

type E2eQueue = {
  markForClass: (mark: {
    class_id: string;
    student_id: string;
    shift_id: string | null;
    period_key: string;
    date: string;
    status: "present" | "absent" | "late" | "excused";
  }) => Promise<unknown>;
  pending: () => Promise<unknown[]>;
  flush: () => Promise<{ applied: number; remaining: number; error?: string }>;
};
type E2eWindow = Window & {
  __m05Queue?: E2eQueue;
  __m05Persisted?: Set<string>;
  __m05Scope?: { tenantId: string; userId: string; role: string };
};

test("class attendance queues offline, syncs after reconnect, and clears cached scope", async ({
  page,
  context,
}) => {
  await page.goto("/workspace-preview", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("workspace-preview")).toBeVisible();

  await page.evaluate(async () => {
    const moduleUrl = new URL("/frontend/src/lib/offline/attendance-queue.ts", location.origin)
      .href;
    const { createAttendanceQueue } = (await import(
      /* @vite-ignore */ moduleUrl
    )) as typeof import("../../frontend/src/lib/offline/attendance-queue");
    const persisted = new Set<string>();
    const scope = {
      tenantId: "m05-synthetic-tenant",
      userId: "m05-synthetic-teacher",
      role: "teacher",
    };
    const queue = createAttendanceQueue({
      scope,
      now: () => new Date("2026-11-03T08:00:00.000Z"),
      newId: () => "m05-e2e-mark-1",
      sync: async (_batch, items) => {
        if (!navigator.onLine) throw new TypeError("Failed to fetch");
        const duplicates = items.filter((item: { id: string }) => persisted.has(item.id)).length;
        items.forEach((item: { id: string }) => persisted.add(item.id));
        return { applied: items.length - duplicates, duplicates, conflicts: [] };
      },
    });
    const target = window as E2eWindow;
    target.__m05Queue = queue;
    target.__m05Persisted = persisted;
    target.__m05Scope = scope;
  });

  await context.setOffline(true);
  await page.evaluate(async () => {
    const target = window as E2eWindow;
    await target.__m05Queue?.markForClass({
      class_id: "55000000-0000-4000-8000-0000000000c1",
      student_id: "55000000-0000-4000-8000-0000000000d1",
      shift_id: "55000000-0000-4000-8000-0000000000e1",
      period_key: "period-1",
      date: "2026-11-03",
      status: "present",
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as E2eWindow).__m05Queue?.pending()))
    .toHaveLength(1);
  const offlineReport = await page.evaluate(async () => (window as E2eWindow).__m05Queue?.flush());
  expect(offlineReport?.error).toBe("Failed to fetch");
  await context.setOffline(false);

  const report = await page.evaluate(async () => (window as E2eWindow).__m05Queue?.flush());
  expect(report).toMatchObject({ applied: 1, remaining: 0 });
  expect(await page.evaluate(() => (window as E2eWindow).__m05Persisted?.size)).toBe(1);

  const cleared = await page.evaluate(async () => {
    const moduleUrl = new URL("/frontend/src/lib/offline/indexeddb-store.ts", location.origin).href;
    const { clearOfflineData, createOfflineStore } = (await import(
      /* @vite-ignore */ moduleUrl
    )) as typeof import("../../frontend/src/lib/offline/indexeddb-store");
    const scope = (window as E2eWindow).__m05Scope!;
    const store = createOfflineStore(scope, {
      now: () => new Date("2026-11-03T08:00:00.000Z"),
      newId: () => "m05-e2e-pending-mark",
    });
    await store.write("timetable", "assigned-class", ["synthetic-student"]);
    await store.enqueue("attendance", "class-a:student-a:daily", { status: "absent" });
    await clearOfflineData();
    return {
      roster: await store.read("timetable", "assigned-class"),
      pending: await store.pending("attendance"),
    };
  });
  expect(cleared).toEqual({ roster: undefined, pending: [] });
});
