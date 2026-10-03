/**
 * CoreGrid — V1-001 PWA offline shell tests.
 *
 * The PWA assets (service worker, robots.txt, favicon) must ship from ONE
 * canonical public dir, the push client must register the service worker at
 * the URL that file is served from, the web app manifest's icon URLs must
 * resolve to real shipped files, and the service worker's offline shell
 * strategy must be exercised end-to-end in a sandbox (service workers cannot
 * run in jsdom, so `public/sw.js` is evaluated in a VM with mocked
 * `caches`/`fetch`/`self`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");

/* ── Canonical public dir / shipped assets ─────────────────────────────────── */

describe("canonical public dir", () => {
  it("ships the PWA assets from one public dir (no split frontend/public)", () => {
    expect(existsSync(join(PUBLIC_DIR, "sw.js"))).toBe(true);
    expect(existsSync(join(PUBLIC_DIR, "robots.txt"))).toBe(true);
    expect(existsSync(join(PUBLIC_DIR, "favicon.ico"))).toBe(true);
    expect(existsSync(join(ROOT, "frontend", "public"))).toBe(false);
  });

  it("ships a real ICO favicon (ICO header + embedded PNG)", () => {
    const bytes = readFileSync(join(PUBLIC_DIR, "favicon.ico"));
    // ICO container: reserved 0, type 1 (icon), 1 image.
    expect(bytes.subarray(0, 4).toString("hex")).toBe("00000100");
    expect(bytes.readUInt16LE(4)).toBe(1);
    expect(bytes[6]).toBe(32); // entry width
    expect(bytes[7]).toBe(32); // entry height
    // PNG-compressed image starts at the directory's declared offset.
    expect(bytes.readUInt32LE(18)).toBe(22);
    expect(bytes.subarray(22, 30).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("manifest icon URLs resolve to real shipped PNG files", () => {
    const engine = readFileSync(
      join(ROOT, "frontend/src/lib/scholar/pwa/manifest-engine.ts"),
      "utf8",
    );
    const iconSrcs = [...engine.matchAll(/src:\s*"(\/icons\/[^"]+)"/g)].map((m) => m[1]);
    expect(iconSrcs.length).toBeGreaterThanOrEqual(3);
    for (const src of iconSrcs) {
      expect(existsSync(join(PUBLIC_DIR, src.replace(/^\//, "")))).toBe(true);
    }
  });
});

/* ── Service worker registration path ─────────────────────────────────────── */

describe("service worker registration path", () => {
  it("registers /sw.js at scope / and reuses that exact registration", () => {
    const source = readFileSync(join(ROOT, "frontend/src/lib/push-client.ts"), "utf8");
    expect(source).toContain('navigator.serviceWorker.register("/sw.js", { scope: "/" })');
    expect(source).toContain('navigator.serviceWorker.getRegistration("/sw.js")');
  });

  it("the registered URL resolves to the shipped service worker file", () => {
    expect(existsSync(join(PUBLIC_DIR, "sw.js"))).toBe(true);
    const sw = readFileSync(join(PUBLIC_DIR, "sw.js"), "utf8");
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
  });
});

/* ── Offline shell strategy (sandboxed service worker) ────────────────────── */

interface SwEvent {
  waitUntil(promise: Promise<unknown>): void;
  respondWith?(promise: Promise<Response>): void;
  request?: { mode: string; method: string; url: string };
  data?: { json(): unknown; text?(): string };
  notification?: { data: { url?: string }; close(): void };
}

interface FakeCacheEntry {
  response: Response;
}

class FakeCache {
  readonly entries = new Map<string, FakeCacheEntry>();

  private key(request: string | { url: string }, ignoreSearch: boolean): string {
    const url = typeof request === "string" ? request : request.url;
    return ignoreSearch ? url.split("?")[0] : url;
  }

  async match(
    request: string | { url: string },
    options?: { ignoreSearch?: boolean },
  ): Promise<Response | undefined> {
    const entry = this.entries.get(this.key(request, options?.ignoreSearch ?? false));
    return entry ? entry.response.clone() : undefined;
  }

  async put(request: string | { url: string }, response: Response): Promise<void> {
    if (!response.ok) throw new Error(`cannot cache non-ok response (${response.status})`);
    this.entries.set(this.key(request, false), { response: response.clone() });
  }

  async add(url: string): Promise<void> {
    const response = await sandbox.fetch(url);
    if (!response.ok) throw new Error(`precache failed for ${url} (${response.status})`);
    await this.put(url, response);
  }
}

const cachesStore = new Map<string, FakeCache>();
const listeners = new Map<string, Array<(event: unknown) => void>>();
const notifications: Array<{ title: string; options: Record<string, unknown> }> = [];
const openedWindows: string[] = [];
let waitUntilPromises: Promise<unknown>[] = [];
let respondedPromises: Promise<Response>[] = [];
let fetchImpl: (input: string | { url: string }) => Promise<Response>;

const sandbox = {
  fetch: (input: string | { url: string }): Promise<Response> => fetchImpl(input),
  caches: {
    open(name: string): Promise<FakeCache> {
      let cache = cachesStore.get(name);
      if (!cache) {
        cache = new FakeCache();
        cachesStore.set(name, cache);
      }
      return Promise.resolve(cache);
    },
  },
  Response,
  console,
  self: {
    addEventListener(type: string, listener: (event: unknown) => void): void {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    skipWaiting(): void {},
    registration: {
      showNotification(title: string, options: Record<string, unknown>): Promise<void> {
        notifications.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim(): Promise<void> {
        return Promise.resolve();
      },
      matchAll(): Promise<unknown[]> {
        return Promise.resolve([]);
      },
      openWindow(url: string): Promise<void> {
        openedWindows.push(url);
        return Promise.resolve();
      },
    },
  },
};

function loadServiceWorker(): void {
  cachesStore.clear();
  listeners.clear();
  notifications.length = 0;
  openedWindows.length = 0;
  waitUntilPromises = [];
  respondedPromises = [];
  // A fresh contextified global per load: top-level `const` declarations in
  // sw.js would collide if the script re-ran in the same context.
  const context = vm.createContext({ ...sandbox });
  vm.runInContext(readFileSync(join(PUBLIC_DIR, "sw.js"), "utf8"), context);
}

function dispatch(type: string, event: Partial<SwEvent>): void {
  waitUntilPromises = [];
  respondedPromises = [];
  const full: SwEvent = {
    waitUntil(promise) {
      waitUntilPromises.push(promise);
    },
    respondWith(promise) {
      respondedPromises.push(promise);
    },
    ...event,
  };
  for (const listener of listeners.get(type) ?? []) listener(full);
}

async function drained(): Promise<void> {
  await Promise.all(waitUntilPromises.flat());
  await Promise.all(respondedPromises);
}

function firstResponse(): Promise<Response> {
  const promise = respondedPromises[0];
  if (!promise) throw new Error("no navigation response was offered");
  return promise;
}

describe("offline shell service worker", () => {
  it("keeps the push notification behaviour intact", async () => {
    loadServiceWorker();
    expect(listeners.get("push")).toHaveLength(1);
    expect(listeners.get("notificationclick")).toHaveLength(1);
    expect(listeners.get("install")).toHaveLength(1);
    expect(listeners.get("activate")).toHaveLength(1);

    dispatch("push", { data: { json: () => ({ title: "Maths", body: "Homework due" }) } });
    await drained();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("Maths");
    expect(notifications[0].options.body).toBe("Homework due");
    expect(notifications[0].options.icon).toBe("/favicon.ico");
    expect(notifications[0].options.data).toEqual({ url: "/notifications" });

    dispatch("notificationclick", {
      notification: { data: { url: "/timetable" }, close: () => {} },
    });
    await drained();
    expect(openedWindows).toEqual(["/timetable"]);
  });

  it("precaches the app shell at install", async () => {
    fetchImpl = (input) =>
      Promise.resolve(new Response("<html>shell</html>", { status: 200 }));
    loadServiceWorker();
    dispatch("install", {});
    await drained();
    const shell = cachesStore.get("coregrid-app-shell-v1");
    expect(shell).toBeDefined();
    expect(shell?.entries.has("/")).toBe(true);
  });

  it("caches successful navigations network-first", async () => {
    fetchImpl = (input) =>
      Promise.resolve(new Response("<html>page</html>", { status: 200 }));
    loadServiceWorker();
    dispatch("fetch", { request: { mode: "navigate", method: "GET", url: "/timetable" } });
    await drained();
    const shell = cachesStore.get("coregrid-app-shell-v1");
    expect(await shell?.entries.has("/timetable")).toBe(true);
    const response = await firstResponse();
    expect(response).toBeInstanceOf(Response);
  });

  it("never caches redirect or error navigation responses", async () => {
    fetchImpl = (input) => Promise.resolve(new Response(null, { status: 302 }));
    loadServiceWorker();
    dispatch("fetch", { request: { mode: "navigate", method: "GET", url: "/login" } });
    await drained();
    const shell = cachesStore.get("coregrid-app-shell-v1");
    expect(await shell?.entries.has("/login")).toBe(false);
  });

  it("falls back to the cached navigation when offline", async () => {
    loadServiceWorker();
    const shell = await sandbox.caches.open("coregrid-app-shell-v1");
    await shell.put({ url: "/timetable" }, new Response("<html>cached page</html>"));
    fetchImpl = () => Promise.reject(new TypeError("Failed to fetch"));

    dispatch("fetch", { request: { mode: "navigate", method: "GET", url: "/timetable" } });
    await drained();
    const response = await firstResponse();
    expect(await response.text()).toBe("<html>cached page</html>");
  });

  it("falls back to the precached shell for uncached navigations when offline", async () => {
    fetchImpl = (input) => Promise.resolve(new Response("<html>shell</html>", { status: 200 }));
    loadServiceWorker();
    dispatch("install", {});
    await drained();
    fetchImpl = () => Promise.reject(new TypeError("Failed to fetch"));

    dispatch("fetch", { request: { mode: "navigate", method: "GET", url: "/never-visited" } });
    await drained();
    const response = await firstResponse();
    expect(await response.text()).toBe("<html>shell</html>");
  });

  it("answers uncached offline navigations with 503 when nothing is cached", async () => {
    loadServiceWorker();
    fetchImpl = () => Promise.reject(new TypeError("Failed to fetch"));
    dispatch("fetch", { request: { mode: "navigate", method: "GET", url: "/anything" } });
    await drained();
    const response = await firstResponse();
    expect(response.status).toBe(503);
  });

  it("only intercepts GET navigation requests", () => {
    loadServiceWorker();
    for (const request of [
      { mode: "cors", method: "GET", url: "/api/health" },
      { mode: "navigate", method: "POST", url: "/login" },
    ]) {
      dispatch("fetch", { request });
      expect(respondedPromises).toHaveLength(0);
    }
  });
});