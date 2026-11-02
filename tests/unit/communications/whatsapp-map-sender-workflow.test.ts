import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../../.github/workflows/sv1-wa-map-sender.yml", import.meta.url),
  "utf8",
);
const yaml = createRequire(import.meta.url)("js-yaml") as {
  load: (source: string) => unknown;
};
const document = yaml.load(workflow) as Record<string, unknown>;
const triggers = (document.on ?? document[true as unknown as string]) as Record<string, unknown>;
const jobs = document.jobs as Record<
  string,
  { steps: { name?: string; run?: string; env?: Record<string, string> }[] }
>;
const steps = jobs["map-sender"].steps;

describe("production WhatsApp sender mapping workflow", () => {
  it("is manual-only, confirmation-gated, and restricted to master", () => {
    expect(Object.keys(triggers)).toEqual(["workflow_dispatch"]);
    const dispatch = triggers.workflow_dispatch as {
      inputs: { confirm: { required?: boolean } };
    };
    expect(dispatch.inputs.confirm.required).toBe(true);
    expect(steps[0].run).toContain('GITHUB_REF" = "refs/heads/master"');
    expect(steps[0].run).toContain('CONFIRM" = "MAP-1407639185765089"');
  });

  it("uses the production DB connection with bounded connection timeout", () => {
    expect(jobs["map-sender"]).toBeDefined();
    expect(workflow).toContain("secrets.PROD_DB_URL_BACKUP");
    expect(workflow).toContain('PGCONNECT_TIMEOUT: "20"');
    expect(workflow).toContain('psql "$DB_URL" -X');
    expect(workflow).toContain("-v ON_ERROR_STOP=1");
  });

  it("fails closed on an ambiguous or missing organization and maps only in a service-role transaction", () => {
    const lookup = steps.find((step) => step.name?.startsWith("Resolve Sherivs"));
    expect(lookup?.run).toContain("FROM public.cg_org_unit");
    expect(lookup?.run).toContain("profile->>'name' = 'Sherivs'");
    expect(lookup?.run).toContain('[ "${#matches[@]}" -eq 1 ]');

    const mapping = steps.find((step) => step.name === "Map WhatsApp sender");
    expect(mapping?.run).toContain("BEGIN;");
    expect(mapping?.run).toContain("SET LOCAL role service_role;");
    expect(mapping?.run).toContain("'request.jwt.claim.role', 'service_role'");
    expect(mapping?.run).toContain("public.cg_whatsapp_map_sender(");
    expect(mapping?.run).toContain("'1407639185765089',");
    expect(mapping?.run).toContain("'+2349015056201',");
    expect(mapping?.run).toContain("'env://WHATSAPP_ACCESS_TOKEN',");
    expect(mapping?.run).toContain("'workflow:sv1-wa-map-sender'");
    const mappedArguments = mapping?.run?.match(
      /SELECT public\.cg_whatsapp_map_sender\(([\s\S]*?)\);/,
    );
    expect(mappedArguments).not.toBeNull();
    expect(mappedArguments?.[1].split(",").map((argument) => argument.trim())).toHaveLength(6);
    expect(mapping?.run).toContain("ROLLBACK;");
    expect(mapping?.run).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it("prints only non-secret sender columns and does not perform other writes", () => {
    const verification = steps.find((step) => step.name === "Verify sender mapping");
    expect(verification?.run).toContain("public.cg_org_communication_sender");
    expect(verification?.run).toContain(
      "SELECT sender_ref, tenant_id, org_ref, channel, provider, from_number",
    );
    expect(verification?.run).not.toContain("credential_ref");
    expect(verification?.run).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });
});
