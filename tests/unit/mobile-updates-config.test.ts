import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PROJECT_ID = "2e19ca55-cc79-4634-ae8a-bf8b551a6a20";
const UPDATE_URL = `https://u.expo.dev/${PROJECT_ID}`;

const app = JSON.parse(readFileSync(new URL("../../mobile/app.json", import.meta.url), "utf8")) as {
  expo: {
    owner: string;
    runtimeVersion: { policy: string };
    updates: { url: string; checkAutomatically: string; fallbackToCacheTimeout: number };
    plugins: Array<string | [string, Record<string, unknown>]>;
    extra: { eas: { projectId: string } };
  };
};

const eas = JSON.parse(readFileSync(new URL("../../mobile/eas.json", import.meta.url), "utf8")) as {
  cli: { appVersionSource: string };
  build: {
    development?: { channel?: string; environment?: string };
    preview?: { channel?: string; environment?: string };
    production?: { channel?: string; environment?: string };
  };
  submit: { production: Record<string, unknown> };
};

const workflow = readFileSync(
  new URL("../../.github/workflows/eas-update.yml", import.meta.url),
  "utf8",
);

function runScriptBodies(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const bodies: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(/^(\s*)run:\s*(.*)$/);
    if (!inline) continue;
    const indent = inline[1].length;
    const rest = inline[2].trim();
    if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
      const block: string[] = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const line = lines[cursor];
        if (line.trim() === "") {
          block.push(line);
          continue;
        }
        const lineIndent = line.match(/^ */)?.[0].length ?? 0;
        if (lineIndent <= indent) break;
        block.push(line);
      }
      bodies.push(block.join("\n"));
      continue;
    }
    bodies.push(rest);
  }
  return bodies;
}

describe("Mobile OTA update config", () => {
  it("uses the fingerprint runtime and the EAS Update URL for this project", () => {
    expect(app.expo.owner).toBe("sherivs");
    expect(app.expo.extra.eas.projectId).toBe(PROJECT_ID);
    expect(app.expo.runtimeVersion).toEqual({ policy: "fingerprint" });
    expect(app.expo.updates).toEqual({
      url: UPDATE_URL,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    });
  });

  it("includes the expo-updates plugin and maps preview and production channels", () => {
    expect(app.expo.plugins).toContain("expo-updates");
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.preview?.channel).toBe("preview");
    expect(eas.build.preview?.environment).toBe("preview");
    expect(eas.build.production?.channel).toBe("production");
    expect(eas.build.production?.environment).toBe("production");
    expect(eas.build.development?.channel).toBeUndefined();
    expect(eas.submit.production).toEqual({});
  });

  it("publishes only from a manual workflow and does not interpolate inputs into the shell", () => {
    const onBlock = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
    expect(onBlock).toContain("workflow_dispatch:");
    expect(onBlock).not.toMatch(/^\s*(push|pull_request|schedule|workflow_call):/m);
    expect(workflow).toContain("secrets.EXPO_TOKEN");
    expect(workflow).not.toMatch(/expo_[A-Za-z0-9]{8,}/);
    expect(workflow).toMatch(
      /uses: actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683(?:\s|$)/,
    );
    expect(workflow).toMatch(
      /uses: actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020(?:\s|$)/,
    );

    const bodies = runScriptBodies(workflow);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toMatch(/\$\{\{/);
    }
    expect(workflow).toContain("EAS_UPDATE_CHANNEL: ${{ inputs.channel }}");
    expect(workflow).toContain("EAS_UPDATE_PLATFORM: ${{ inputs.platform }}");
    expect(workflow).toContain("EAS_UPDATE_MESSAGE: ${{ inputs.message }}");
  });
});
