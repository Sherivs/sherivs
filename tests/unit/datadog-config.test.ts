import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { lint, loadDashboards, loadMonitors, SERVICE_FILES } from "../../scripts/datadog/apply.mjs";

describe("Datadog monitors, dashboard and service catalog as code", () => {
  it("monitors pass local invariants and notify hello@sherivs.com", () => {
    const monitors = loadMonitors();
    expect(monitors.length).toBeGreaterThanOrEqual(5);
    expect(lint(monitors)).toEqual([]);
  });

  it("covers the required alert classes", () => {
    const ids = loadMonitors().map((m) => m.file.replace(/\.json$/, ""));
    expect(ids).toEqual(
      expect.arrayContaining([
        "web-5xx-rate",
        "web-error-spike",
        "web-latency-p95",
        "cron-wallet-failures",
        "cron-wallet-missing",
      ]),
    );
  });

  it("dashboard is a valid ordered layout", () => {
    const [dashboard] = loadDashboards();
    expect(dashboard.body.title).toBe("Sherivs overview");
    expect(dashboard.body.layout_type).toBe("ordered");
  });

  it("service definitions name each service and contain no secrets", () => {
    const text = SERVICE_FILES.map((f) => readFileSync(f, "utf8"));
    expect(text[0]).toContain("dd-service: sherivs-web");
    expect(text[1]).toContain("dd-service: sherivs-cron");
    for (const t of text) {
      expect(t).toContain("contact: hello@sherivs.com");
      expect(t).not.toMatch(/api[_-]?key|app[_-]?key|token|password/i);
    }
  });
});
