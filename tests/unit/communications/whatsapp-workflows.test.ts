import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const mapWorkflow = readFileSync(
  new URL("../../../.github/workflows/sv1-wa-map-sender.yml", import.meta.url),
  "utf8",
);
const rootWorkflow = readFileSync(
  new URL("../../../.github/workflows/sv1-wa-create-root-org.yml", import.meta.url),
  "utf8",
);
const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load: (source: string) => unknown };

function workflowParts(source: string) {
  const parsed = yaml.load(source) as Record<string, unknown>;
  const triggers = (parsed.on ?? parsed[true as unknown as string]) as Record<string, unknown>;
  return {
    triggers,
    job: (parsed.jobs as Record<string, { environment?: string; steps?: { run?: string }[] }>)[
      Object.keys(parsed.jobs as object)[0]
    ],
  };
}

describe("reviewed WhatsApp production workflows", () => {
  it("keeps sender mapping manual, master-only, confirmation-gated, and dry-run by default", () => {
    const { triggers, job } = workflowParts(mapWorkflow);
    const dispatch = triggers.workflow_dispatch as {
      inputs: { confirm: { required: boolean }; dry_run: { default: boolean; type: string } };
    };
    expect(Object.keys(triggers)).toEqual(["workflow_dispatch"]);
    expect(dispatch.inputs.confirm.required).toBe(true);
    expect(dispatch.inputs.dry_run).toMatchObject({ default: true, type: "boolean" });
    expect(job.environment).toBe("Production");
    expect(job.steps?.[0].run).toContain('GITHUB_REF" = "refs/heads/master"');
    expect(job.steps?.[0].run).toContain('CONFIRM" = "MAP-1407639185765089"');
    expect(mapWorkflow).toContain("secrets.PROD_DB_URL_BACKUP");
    expect(mapWorkflow).toContain("BEGIN;");
    expect(mapWorkflow).toContain("\\if :dry_run");
    expect(mapWorkflow).toContain("ROLLBACK;");
    expect(mapWorkflow).toContain("COMMIT;");
  });

  it("creates only a missing Sherivs root in a reviewed production transaction", () => {
    const { triggers, job } = workflowParts(rootWorkflow);
    const dispatch = triggers.workflow_dispatch as {
      inputs: {
        tenant_id: { required: boolean };
        confirm: { required: boolean };
        dry_run: { default: boolean };
      };
    };
    expect(Object.keys(triggers)).toEqual(["workflow_dispatch"]);
    expect(dispatch.inputs.tenant_id.required).toBe(true);
    expect(dispatch.inputs.confirm.required).toBe(true);
    expect(dispatch.inputs.dry_run.default).toBe(true);
    expect(job.environment).toBe("Production");
    expect(job.steps?.[0].run).toContain('GITHUB_REF" = "refs/heads/master"');
    expect(job.steps?.[0].run).toContain("CREATE-SHERIVS-ROOT");
    expect(rootWorkflow).toContain("public.cg_org_unit");
    expect(rootWorkflow).toContain("public.cg_tenant");
    expect(rootWorkflow).toContain("t.parent_tenant_id IS NULL AND t.status = 'ACTIVE'");
    expect(rootWorkflow).toContain("profile->>'name' = 'Sherivs'");
    expect(rootWorkflow).toContain("multiple Sherivs root organizations exist");
    expect(rootWorkflow).toContain("\\if :dry_run");
    expect(rootWorkflow).toContain("ROLLBACK;");
    expect(rootWorkflow).toContain("COMMIT;");
  });
});
