/**
 * INFRA-01 — Sentry and PostHog initialise only for explicit staging.
 * Production and unset fail closed, and production defines do not carry keys.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sentryOptions } from "@/lib/observability/sentry-config";
import { readServerSentryEnv } from "@/lib/observability/sentry.server";
import {
  CLIENT_VENDOR_ENV_NAMES,
  clientVendorDefine,
  explicitAppEnv,
  sentrySourceMapUploadEnabled,
  serverVendorDefine,
  vendorBuildDefine,
  vendorTelemetryEnabled,
} from "@/lib/observability/vendor-telemetry";
import { stripVendorTelemetryEnvText } from "../../scripts/strip-vendor-telemetry-env.mjs";

vi.mock("@sentry/tanstackstart-react", () => ({
  init: vi.fn(),
  wrapFetchWithSentry: (entry: { fetch: unknown }) => entry,
  captureException: vi.fn(),
  tanstackRouterBrowserTracingIntegration: vi.fn(() => ({ name: "tracing" })),
}));

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DSN = "https://k@o1.ingest.de.sentry.io/1";
const POSTHOG_KEY = "phc_test_project_key";
const ENV_KEYS = [
  "APP_ENV",
  "VITE_APP_ENV",
  "VERCEL_ENV",
  "SENTRY_DSN",
  "SENTRY_AUTH_TOKEN",
  "VITE_SENTRY_DSN",
  "VITE_POSTHOG_KEY",
] as const;

const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearTelemetryEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
});

function readRepo(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

describe("vendor telemetry gate", () => {
  it("enables only when both names are exactly staging", () => {
    expect(vendorTelemetryEnabled({ appEnv: "staging", viteAppEnv: "staging" })).toBe(true);
    expect(explicitAppEnv({ appEnv: "staging", viteAppEnv: "staging" })).toBe("staging");
    expect(vendorTelemetryEnabled({ appEnv: "staging" })).toBe(false);
    expect(vendorTelemetryEnabled({ viteAppEnv: "staging" })).toBe(false);
    expect(explicitAppEnv({ appEnv: "staging" })).toBe("");
    expect(explicitAppEnv({ viteAppEnv: "staging" })).toBe("");
    expect(vendorTelemetryEnabled({ appEnv: "Staging", viteAppEnv: "Staging" })).toBe(false);
    expect(vendorTelemetryEnabled({ appEnv: "staging", viteAppEnv: "Staging" })).toBe(false);
    expect(explicitAppEnv({ appEnv: "Staging", viteAppEnv: "Staging" })).toBe("Staging");
    expect(vendorTelemetryEnabled({})).toBe(false);
    expect(vendorTelemetryEnabled({ appEnv: "production", viteAppEnv: "production" })).toBe(false);
    expect(vendorTelemetryEnabled({ appEnv: "development", viteAppEnv: "development" })).toBe(
      false,
    );
    expect(vendorTelemetryEnabled({ appEnv: "test", viteAppEnv: "test" })).toBe(false);
    expect(vendorTelemetryEnabled({ appEnv: "local", viteAppEnv: "local" })).toBe(false);
    expect(explicitAppEnv({ appEnv: "staging", viteAppEnv: "production" })).toBe("");
    expect(vendorTelemetryEnabled({ appEnv: "staging", viteAppEnv: "production" })).toBe(false);
    expect(
      vendorTelemetryEnabled({
        appEnv: "staging",
        viteAppEnv: "staging",
        vercelEnv: "production",
      }),
    ).toBe(false);
    expect(
      vendorTelemetryEnabled({
        appEnv: "staging",
        viteAppEnv: "staging",
        vercelEnv: "development",
      }),
    ).toBe(false);
    expect(
      vendorTelemetryEnabled({ appEnv: "staging", viteAppEnv: "staging", vercelEnv: "preview" }),
    ).toBe(true);
  });

  it("does not inline Sentry or PostHog keys into a production or unset build", () => {
    const secretDsn = "https://secret.ingest.sentry.io/99";
    const production = clientVendorDefine({
      appEnv: "production",
      viteAppEnv: "production",
      vercelEnv: "production",
      release: "abc",
    });
    for (const name of CLIENT_VENDOR_ENV_NAMES) {
      expect(production[`import.meta.env.${name}`]).toBe(JSON.stringify(""));
    }
    expect(production["import.meta.env.VITE_APP_ENV"]).toBe(JSON.stringify("production"));
    expect(production["import.meta.env.VITE_VERCEL_ENV"]).toBe(JSON.stringify("production"));
    expect(JSON.stringify(production)).not.toContain(secretDsn);
    expect(JSON.stringify(production)).not.toContain(POSTHOG_KEY);
    expect(serverVendorDefine({ appEnv: "production", vercelEnv: "production" })).toEqual({
      "process.env.SENTRY_DSN": JSON.stringify(""),
    });
    expect(
      sentrySourceMapUploadEnabled({
        appEnv: "production",
        vercelEnv: "production",
        authToken: "present",
        vitest: false,
      }),
    ).toBe(false);

    const unset = clientVendorDefine({});
    expect(unset["import.meta.env.VITE_SENTRY_DSN"]).toBe(JSON.stringify(""));
    expect(unset["import.meta.env.VITE_POSTHOG_KEY"]).toBe(JSON.stringify(""));
    expect(unset["import.meta.env.VITE_APP_ENV"]).toBe(JSON.stringify(""));
    expect(sentrySourceMapUploadEnabled({ authToken: "present", vitest: false })).toBe(false);

    const development = clientVendorDefine({ appEnv: "development", viteAppEnv: "development" });
    expect(development["import.meta.env.VITE_POSTHOG_KEY"]).toBe(JSON.stringify(""));
    expect(sentrySourceMapUploadEnabled({ appEnv: "development", authToken: "present" })).toBe(
      false,
    );
  });

  it("leaves client keys for Vite to inject only when staging", () => {
    const staging = clientVendorDefine({
      appEnv: "staging",
      viteAppEnv: "staging",
      vercelEnv: "preview",
      release: "sha",
    });
    expect(staging["import.meta.env.VITE_APP_ENV"]).toBe(JSON.stringify("staging"));
    expect(staging["import.meta.env.VITE_SENTRY_DSN"]).toBeUndefined();
    expect(staging["import.meta.env.VITE_POSTHOG_KEY"]).toBeUndefined();
    expect(staging["import.meta.env.VITE_SENTRY_ENVIRONMENT"]).toBe(JSON.stringify("staging"));
    expect(staging["import.meta.env.VITE_VERCEL_ENV"]).toBe(JSON.stringify("preview"));
    expect(serverVendorDefine({ appEnv: "staging", viteAppEnv: "staging" })).toEqual({});
    expect(
      sentrySourceMapUploadEnabled({
        appEnv: "staging",
        viteAppEnv: "staging",
        authToken: "present",
        vitest: false,
      }),
    ).toBe(true);
    expect(
      sentrySourceMapUploadEnabled({
        appEnv: "staging",
        viteAppEnv: "staging",
        authToken: "present",
        vitest: true,
      }),
    ).toBe(false);
    expect(
      sentrySourceMapUploadEnabled({
        appEnv: "staging",
        viteAppEnv: "staging",
        authToken: "  ",
        vitest: false,
      }),
    ).toBe(false);
  });

  it("sentryOptions fails closed for production, development, and unset", () => {
    const dsn = DSN;
    expect(sentryOptions({ dsn, appEnv: "production", viteAppEnv: "production" })).toBeNull();
    expect(sentryOptions({ dsn, appEnv: "development" })).toBeNull();
    expect(sentryOptions({ dsn })).toBeNull();
    expect(sentryOptions({ dsn, environment: "staging" })).toBeNull();
    expect(
      sentryOptions({ dsn, appEnv: "staging", viteAppEnv: "staging", vercelEnv: "production" }),
    ).toBeNull();
    const staging = sentryOptions({
      dsn,
      appEnv: "staging",
      viteAppEnv: "staging",
      vercelEnv: "preview",
      release: "sha",
    });
    expect(staging).not.toBeNull();
    expect(staging?.environment).toBe("staging");
    expect(staging?.dsn).toBe(dsn);
  });

  it("applies the vendor define only to a production build", () => {
    const blanked = vendorBuildDefine({
      command: "build",
      mode: "production",
      appEnv: "production",
      viteAppEnv: "production",
      vercelEnv: "production",
    });
    expect(blanked["import.meta.env.VITE_SENTRY_DSN"]).toBe(JSON.stringify(""));
    expect(blanked["import.meta.env.VITE_POSTHOG_KEY"]).toBe(JSON.stringify(""));
    expect(blanked["process.env.SENTRY_DSN"]).toBe(JSON.stringify(""));
    expect(vendorBuildDefine({ command: "serve", mode: "development" })).toEqual({});
    expect(
      vendorBuildDefine({
        command: "serve",
        mode: "production",
        appEnv: "production",
        viteAppEnv: "production",
      }),
    ).toEqual({});
    expect(
      vendorBuildDefine({
        command: "build",
        mode: "development",
        appEnv: "production",
        viteAppEnv: "production",
      }),
    ).toEqual({});
  });

  it("production define empties the DSN readServerSentryEnv passes to sentryOptions", () => {
    const define = serverVendorDefine({
      appEnv: "production",
      viteAppEnv: "production",
      vercelEnv: "production",
    });
    expect(define["process.env.SENTRY_DSN"]).toBe(JSON.stringify(""));
    const source = readRepo("frontend/src/lib/observability/sentry.server.ts");
    expect(source).toContain("dsn: process.env.SENTRY_DSN");
    expect(source).not.toMatch(/dsn:\s*env\.SENTRY_DSN/);
    const clientSource = readRepo("frontend/src/lib/observability/sentry-browser.ts");
    expect(clientSource).toContain("vercelEnv: import.meta.env.VITE_VERCEL_ENV");
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = JSON.parse(define["process.env.SENTRY_DSN"]) as string;
    try {
      const read = readServerSentryEnv({
        APP_ENV: "staging",
        VITE_APP_ENV: "staging",
        VERCEL_ENV: "preview",
        SENTRY_DSN: DSN,
      });
      expect(read.dsn).toBe("");
      expect(read.dsn).not.toBe(DSN);
      expect(sentryOptions(read)).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN;
      else process.env.SENTRY_DSN = previous;
    }
  });
});

describe("Sentry and PostHog initialisation", () => {
  it("does not call Sentry.init for production, development, or unset", async () => {
    for (const env of [
      { APP_ENV: "production", VITE_APP_ENV: "production", VERCEL_ENV: "production" },
      { APP_ENV: "development", VITE_APP_ENV: "development", VERCEL_ENV: "development" },
      {},
    ]) {
      clearTelemetryEnv();
      Object.assign(process.env, env, { SENTRY_DSN: DSN });
      vi.resetModules();
      const Sentry = await import("@sentry/tanstackstart-react");
      vi.mocked(Sentry.init).mockClear();
      const server = await import("@/lib/observability/sentry.server");
      expect(server.serverSentryEnabled).toBe(false);
      expect(Sentry.init).not.toHaveBeenCalled();
      const client = await import("@/lib/observability/sentry-browser");
      const init = vi.fn();
      const loaded = vi.fn(async () => ({
        init,
        tanstackRouterBrowserTracingIntegration: () => ({ name: "tracing" }),
      }));
      expect(
        client.initClientSentry(
          {},
          {
            dsn: DSN,
            appEnv: env.APP_ENV,
            viteAppEnv: env.VITE_APP_ENV,
            vercelEnv: env.VERCEL_ENV,
          },
          loaded,
        ),
      ).toBe(false);
      expect(loaded).not.toHaveBeenCalled();
      expect(init).not.toHaveBeenCalled();
    }
  });

  it("initialises Sentry and PostHog when the app env is staging", async () => {
    clearTelemetryEnv();
    process.env.APP_ENV = "staging";
    process.env.VITE_APP_ENV = "staging";
    process.env.SENTRY_DSN = DSN;
    vi.resetModules();
    const Sentry = await import("@sentry/tanstackstart-react");
    vi.mocked(Sentry.init).mockClear();
    const server = await import("@/lib/observability/sentry.server");
    expect(server.serverSentryEnabled).toBe(true);
    expect(Sentry.init).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.init).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ dsn: DSN, environment: "staging" }),
    );

    const clientInit = vi.fn();
    const client = await import("@/lib/observability/sentry-browser");
    client.initClientSentry(
      { id: "router" },
      { dsn: DSN, appEnv: "staging", viteAppEnv: "staging", vercelEnv: "preview" },
      async () => ({
        init: clientInit,
        tanstackRouterBrowserTracingIntegration: () => ({ name: "tracing" }),
      }),
    );
    await vi.waitFor(() => expect(clientInit).toHaveBeenCalledTimes(1));
    expect(clientInit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ dsn: DSN, environment: "staging" }),
    );

    const posthogInit = vi.fn();
    const loadPosthog = vi.fn(async () => ({ default: { init: posthogInit } }));
    const posthog = await import("@/lib/analytics/posthog");
    const started = await posthog.startPosthog(
      POSTHOG_KEY,
      "https://eu.i.posthog.com",
      {
        appEnv: "staging",
        viteAppEnv: "staging",
        vercelEnv: "preview",
      },
      loadPosthog,
    );
    expect(loadPosthog).toHaveBeenCalledTimes(1);
    expect(posthogInit).toHaveBeenCalledWith(
      POSTHOG_KEY,
      expect.objectContaining({
        api_host: "https://eu.i.posthog.com",
        disable_session_recording: true,
      }),
    );
    expect(started).toBeTruthy();
  });

  it("does not import PostHog for production, development, or unset", async () => {
    vi.resetModules();
    const posthog = await import("@/lib/analytics/posthog");
    const load = vi.fn(async () => ({ default: { init: vi.fn() } }));
    for (const env of [
      { appEnv: "production", viteAppEnv: "production", vercelEnv: "production" },
      { appEnv: "development", viteAppEnv: "development" },
      {},
      { appEnv: "staging", viteAppEnv: "production" },
    ]) {
      const started = await posthog.startPosthog(
        POSTHOG_KEY,
        "https://eu.i.posthog.com",
        env,
        load,
      );
      expect(started).toBeNull();
    }
    expect(load).not.toHaveBeenCalled();
  });
});

describe("build env files and CI", () => {
  it("strips vendor keys unless the file is explicit staging, and never echoes values", () => {
    const secret = "https://secret.ingest.sentry.io/99";
    const key = "phc_test_project_key";
    const token = "sntrys_test_token_value";
    const text = [
      "APP_ENV=production",
      "VITE_APP_ENV=production",
      `VITE_SENTRY_DSN=${secret}`,
      `SENTRY_DSN=${secret}`,
      `VITE_POSTHOG_KEY=${key}`,
      `SENTRY_AUTH_TOKEN=${token}`,
      "SUPABASE_URL=https://example.supabase.co",
    ].join("\n");
    const stripped = stripVendorTelemetryEnvText(text);
    expect(stripped.vendorTelemetry).toBe(false);
    expect(stripped.removed).toEqual([
      "VITE_SENTRY_DSN",
      "SENTRY_DSN",
      "VITE_POSTHOG_KEY",
      "SENTRY_AUTH_TOKEN",
    ]);
    expect(stripped.text).not.toContain(secret);
    expect(stripped.text).not.toContain(key);
    expect(stripped.text).not.toContain(token);
    expect(stripped.text).toContain("SUPABASE_URL=https://example.supabase.co");

    const unset = stripVendorTelemetryEnvText(`VITE_POSTHOG_KEY=${key}\nSENTRY_DSN=${secret}\n`);
    expect(unset.vendorTelemetry).toBe(false);
    expect(unset.text).not.toContain(key);
    expect(unset.text).not.toContain(secret);

    const staging = stripVendorTelemetryEnvText(
      `APP_ENV=staging\nVITE_APP_ENV=staging\nVITE_SENTRY_DSN=${secret}\n`,
    );
    expect(staging.vendorTelemetry).toBe(true);
    expect(staging.removed).toEqual([]);
    expect(staging.text).toContain(`VITE_SENTRY_DSN=${secret}`);

    const forced = stripVendorTelemetryEnvText(
      `APP_ENV=staging\nVITE_APP_ENV=staging\nVITE_SENTRY_DSN=${secret}\nVITE_POSTHOG_KEY=${key}\n`,
      { forceAppEnv: "production" },
    );
    expect(forced.vendorTelemetry).toBe(false);
    expect(forced.text).toContain("APP_ENV=production");
    expect(forced.text).toContain("VITE_APP_ENV=production");
    expect(forced.text).not.toContain(secret);
    expect(forced.text).not.toContain(key);
  });

  it("keeps required checks and shortens artifact retention without touching backups", () => {
    const verify = readRepo(".github/workflows/verify.yml");
    const role =
      verify.split("name: Role management UI screenshots")[1]?.split("repo-guards:")[0] ?? "";
    const workspace =
      verify.split("name: Workspace shell E2E + screenshots")[1]?.split("gitleaks:")[0] ?? "";
    expect(role).toContain("if: always()");
    expect(role).toContain("retention-days: 3");
    expect(workspace).toContain("if: failure()");
    expect(workspace).not.toContain("if: always()");
    expect(workspace).toContain("retention-days: 3");
    expect(verify).toContain("name: Secret scan (gitleaks)");
    expect(verify).toContain("name: Migration dry-run + sim smoke");
    expect(verify).toContain("strip-vendor-telemetry-env.mjs --force-app-env=production");
    expect(verify).toContain(
      "npm run verify:registry && npm run verify:drift && npm run verify:neutrality && npm run verify:secrets",
    );
    expect(readRepo(".github/workflows/nightly-db-backup.yml")).toContain("retention-days: 90");
    expect(readRepo(".github/workflows/infrastructure-plan-apply.yml")).toContain(
      "retention-days: 7",
    );
    expect(readRepo(".github/workflows/infrastructure-verify.yml")).toContain("retention-days: 7");
    expect(readRepo(".github/workflows/security-batteries.yml")).toContain("retention-days: 7");
    expect(readRepo("Dockerfile")).toContain("APP_ENV=production");
    expect(readRepo("Dockerfile")).toContain("VITE_APP_ENV=production");
  });
});
