/**
 * OBS-DD-01 — Sentry/PostHog kill switches default ON (today's behaviour),
 * Datadog defaults OFF. Switches can only turn a vendor off; INFRA-01's
 * staging-only gate still decides whether Sentry/PostHog run at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { sentryOptions } from "@/lib/observability/sentry-config";
import { readServerSentryEnv } from "@/lib/observability/sentry.server";
import {
  datadogSwitchOn,
  posthogSwitchOn,
  sentrySwitchOn,
} from "@/lib/observability/vendor-switches";
import {
  clientSwitchDefine,
  sentrySourceMapUploadEnabled,
  vendorBuildDefine,
} from "@/lib/observability/vendor-telemetry";

vi.mock("@sentry/tanstackstart-react", () => ({
  init: vi.fn(),
  wrapFetchWithSentry: (entry: { fetch: unknown }) => entry,
  captureException: vi.fn(),
}));

const DSN = "https://k@o1.ingest.de.sentry.io/1";
const STAGING = { appEnv: "staging", viteAppEnv: "staging", vercelEnv: "preview" };

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("posthog-js");
});

describe("OBS-DD-01 switch defaults", () => {
  it("Sentry and PostHog default on; only exact 'false' turns them off", () => {
    for (const on of [undefined, null, "", "true", "FALSE", "False", "0", "no"]) {
      expect(sentrySwitchOn(on)).toBe(true);
      expect(posthogSwitchOn(on)).toBe(true);
    }
    expect(sentrySwitchOn("false")).toBe(false);
    expect(posthogSwitchOn("false")).toBe(false);
  });

  it("Datadog defaults off; only exact 'true' turns it on", () => {
    for (const off of [undefined, null, "", "TRUE", "1", "yes", "false"]) {
      expect(datadogSwitchOn(off)).toBe(false);
    }
    expect(datadogSwitchOn("true")).toBe(true);
  });
});

describe("OBS-DD-01 Sentry switch", () => {
  it("unset switch keeps today's staging Sentry options", () => {
    const opts = sentryOptions({ dsn: DSN, ...STAGING });
    expect(opts?.dsn).toBe(DSN);
    expect(opts?.environment).toBe("staging");
  });

  it("'false' disables Sentry even on staging", () => {
    expect(sentryOptions({ dsn: DSN, ...STAGING, switchValue: "false" })).toBeNull();
  });

  it("'true' cannot enable Sentry outside staging", () => {
    expect(
      sentryOptions({
        dsn: DSN,
        appEnv: "production",
        viteAppEnv: "production",
        switchValue: "true",
      }),
    ).toBeNull();
  });

  it("server reads OBSERVABILITY_SENTRY_ENABLED", () => {
    expect(
      readServerSentryEnv({ OBSERVABILITY_SENTRY_ENABLED: "false" } as NodeJS.ProcessEnv)
        .switchValue,
    ).toBe("false");
    expect(readServerSentryEnv({} as NodeJS.ProcessEnv).switchValue).toBeUndefined();
  });

  it("source-map upload follows the switch", () => {
    const base = { ...STAGING, authToken: "present", vitest: false };
    expect(sentrySourceMapUploadEnabled(base)).toBe(true);
    expect(sentrySourceMapUploadEnabled({ ...base, sentrySwitch: "false" })).toBe(false);
  });
});

describe("OBS-DD-01 client build define", () => {
  it("unset switches add nothing, so today's bundle is unchanged", () => {
    expect(clientSwitchDefine({})).toEqual({});
    const prod = vendorBuildDefine({
      command: "build",
      mode: "production",
      appEnv: "production",
      viteAppEnv: "production",
      vercelEnv: "production",
    });
    expect(Object.keys(prod).some((k) => k.includes("OBSERVABILITY"))).toBe(false);
  });

  it("set switches are baked into the production client bundle only", () => {
    const input = { sentrySwitch: "false", posthogSwitch: "false" };
    const prod = vendorBuildDefine({ ...input, ...STAGING, command: "build", mode: "production" });
    expect(prod["import.meta.env.VITE_OBSERVABILITY_SENTRY_ENABLED"]).toBe(JSON.stringify("false"));
    expect(prod["import.meta.env.VITE_OBSERVABILITY_POSTHOG_ENABLED"]).toBe(
      JSON.stringify("false"),
    );
    expect(vendorBuildDefine({ ...input, command: "serve", mode: "development" })).toEqual({});
  });
});

describe("OBS-DD-01 PostHog switch", () => {
  function mockPosthog() {
    const init = vi.fn();
    vi.doMock("posthog-js", () => ({
      default: { init, opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn(), reset: vi.fn() },
    }));
    return init;
  }

  it("unset switch keeps today's staging PostHog start", async () => {
    const init = mockPosthog();
    const mod = await import("@/lib/analytics/posthog");
    const ph = await mod.startPosthog(
      "phc_test",
      "https://eu.i.posthog.com",
      STAGING,
      undefined,
      undefined,
    );
    expect(ph).not.toBeNull();
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("'false' never imports posthog-js", async () => {
    const load = vi.fn();
    const mod = await import("@/lib/analytics/posthog");
    const ph = await mod.startPosthog("phc_test", undefined, STAGING, load, "false");
    expect(ph).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
