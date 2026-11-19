import { describe, expect, it } from "vitest";
import {
  BUILD_SHA_DEFINE,
  buildVersionDefine,
  normaliseSha,
} from "@/lib/observability/build-version";
import { readDatadogOtelConfig, serviceVersion } from "@/lib/observability/datadog-otel-config";

const sha = "ec43f55d20ad2893dc955343e6271dc5a4ed577e";

describe("OBS-DD-03 build-time version", () => {
  it("defines the SHA only for builds", () => {
    expect(buildVersionDefine({ command: "build", sha })).toEqual({
      [BUILD_SHA_DEFINE]: JSON.stringify(sha),
    });
    expect(buildVersionDefine({ command: "serve", sha })).toEqual({});
  });

  it("accepts only hex commit SHAs", () => {
    expect(normaliseSha(` ${sha.toUpperCase()} `)).toBe(sha);
    expect(normaliseSha("main")).toBe("");
    expect(normaliseSha('abc1234"; alert(1)')).toBe("");
    expect(normaliseSha(undefined)).toBe("");
    expect(buildVersionDefine({ command: "build", sha: "not a sha" })).toEqual({
      [BUILD_SHA_DEFINE]: '""',
    });
  });

  it("prefers runtime VERCEL_GIT_COMMIT_SHA, then the build SHA, then unknown", () => {
    expect(serviceVersion({ VERCEL_GIT_COMMIT_SHA: "abc123" }, sha)).toBe("abc123");
    expect(serviceVersion({}, sha)).toBe(sha);
    expect(serviceVersion({}, "")).toBe("unknown");
  });

  it("outside a build (vitest) the config still reports unknown without a runtime SHA", () => {
    const config = readDatadogOtelConfig({
      OBSERVABILITY_DATADOG_ENABLED: "true",
      DD_API_KEY: "k",
    });
    expect(config?.resourceAttributes["service.version"]).toBe("unknown");
  });
});
