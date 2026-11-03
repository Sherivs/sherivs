import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../../.github/workflows/sv1-create-root-tenant.yml", import.meta.url),
  "utf8",
);
const yaml = createRequire(import.meta.url)("js-yaml") as {
  load: (source: string) => unknown;
};
const document = yaml.load(workflow) as Record<string, unknown>;
const triggers = (document.on ?? document[true as unknown as string]) as Record<string, unknown>;
const jobs = document.jobs as Record<
  string,
  { environment: string; timeout: number; steps: { name?: string; run?: string }[] }
>;
const steps = jobs["create-root-tenant"].steps;

describe("production Sherivs root tenant workflow", () => {
  it("is manual-only, master-only, and guarded by the required confirmation", () => {
    expect(Object.keys(triggers)).toEqual(["workflow_dispatch"]);
    const dispatch = triggers.workflow_dispatch as {
      inputs: {
        confirm: { required?: boolean };
        dry_run: { default?: boolean; required?: boolean; type?: string };
      };
    };
    expect(dispatch.inputs.confirm.required).toBe(true);
    expect(dispatch.inputs.dry_run).toMatchObject({
      default: true,
      required: true,
      type: "boolean",
    });
    expect(jobs["create-root-tenant"].environment).toBe("Production");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("timeout-minutes: 10");
    expect(workflow).toContain("group: prod-sherivs-root-tenant");
    expect(steps[0].run).toContain('GITHUB_REF" = "refs/heads/master"');
    expect(steps[0].run).toContain('CONFIRM" = "CREATE-SHERIVS-ROOT-TENANT"');
  });

  it("uses one fail-closed production transaction with a dry-run rollback", () => {
    const transaction = steps.find((step) => step.name === "Create if absent and verify");
    expect(workflow).toContain("secrets.PROD_DB_URL_BACKUP");
    expect(transaction?.run).toContain('psql "$DB_URL" -X -v ON_ERROR_STOP=1');
    expect(transaction?.run).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE;");
    expect(transaction?.run).toContain("\\if :dry_run");
    expect(transaction?.run).toContain("ROLLBACK;");
    expect(transaction?.run).toContain("COMMIT;");
    expect(transaction?.run).toContain("duplicate or conflicting Sherivs tenant rows");
    expect(transaction?.run).toContain("Sherivs tenant conflicts with the expected active root");
    expect(transaction?.run).toContain("tenant_id");
  });

  it("creates only the fixed active root tenant and never provisions identity or permissions", () => {
    const transaction = steps.find((step) => step.name === "Create if absent and verify");
    expect(transaction?.run).toContain("INSERT INTO public.cg_tenant");
    expect(transaction?.run).toContain("'3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201'");
    expect(transaction?.run).toContain("'ACTIVE', NULL, 'production'");
    expect(transaction?.run).not.toMatch(
      /auth\.users|cg_org_membership|\bGRANT\b|\bPOLICY\b|INSERT INTO public\.cg_org_unit/i,
    );
    expect(transaction?.run).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\b/i);
    expect(workflow).not.toContain("tenant_id:");
  });
});
