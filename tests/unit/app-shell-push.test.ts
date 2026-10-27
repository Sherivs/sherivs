import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_SHELL_NOTIFICATIONS } from "../../frontend/src/lib/shell/paths";
import { PUSH_DEVICE_STEPS } from "../../frontend/src/lib/shell/auth-setup";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("VAPID web push for the application shell", () => {
  it("requires the public VAPID key before subscribing", () => {
    const client = read("frontend/src/lib/push-client.ts");
    expect(client).toContain("vapidPublicKey");
    expect(client).toContain("missing_vapid");
    expect(client).toContain("applicationServerKey: urlBase64ToUint8Array(vapid)");
    expect(client).not.toMatch(/\.\.\.\(vapid \? \{ applicationServerKey/);
  });

  it("deep-links the service worker to the shell inbox", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain(`payload.url || "${APP_SHELL_NOTIFICATIONS}"`);
    expect(sw).toContain(`|| "${APP_SHELL_NOTIFICATIONS}"`);
    expect(sw).not.toMatch(/payload\.url \|\| "\/notifications"/);
    expect(sw).toContain("sherivs-notification");
    expect(sw).not.toContain("vibeora-notification");
  });

  it("signs delivery as Sherivs and provisions the Vercel subject", () => {
    const server = read("frontend/src/lib/push.server.ts");
    expect(server).toContain('DEFAULT_VAPID_SUBJECT = "https://app.sherivs.com"');
    expect(server).toContain("process.env.VAPID_SUBJECT ?? DEFAULT_VAPID_SUBJECT");
    expect(server).not.toContain("vibeora.app");
    const provision = read("scripts/provision-vercel-env.mjs");
    expect(provision).toContain('key: "VAPID_SUBJECT"');
    expect(provision).toContain("https://app.sherivs.com");
    expect(provision).toContain("fallback");
  });

  it("wires enable, disable, test, and silent refresh through /home/notifications", () => {
    const screen = read("frontend/src/components/app-shell/account-screens.tsx");
    expect(screen).toContain("registerPushSubscription");
    expect(screen).toContain("unregisterPushToken");
    expect(screen).toContain("sendTestPush");
    expect(screen).toContain('data-testid="push-enable"');
    expect(PUSH_DEVICE_STEPS.length).toBeGreaterThanOrEqual(4);
    const chrome = read("frontend/src/components/app-shell/app-shell.tsx");
    expect(chrome).toContain("refreshPushTokenIfGranted");
    expect(APP_SHELL_NOTIFICATIONS).toBe("/home/notifications");
  });
});
