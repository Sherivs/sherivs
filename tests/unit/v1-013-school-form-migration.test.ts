/**
 * CoreGrid — V1-013: school-creation migration proof (team ONBOARDING).
 *
 * Proves the mechanical migration planned by V1-008: the super-admin Add
 * School form provisions through the platform onboarding engine
 * (`provisionOrganization`), and the legacy Scholar-specific creator
 * (`createSchoolWithAdmin`) with its derived `defaultAdminPassword` is gone.
 *
 * (a) FORM PATH — add-school-form.tsx resolves through the engine server fn
 *     and maps the form state onto the neutral request contract
 *     (`domainId: "scholar"`, one `school_admin` person with an auth
 *     account).
 * (b) CREDENTIAL CONTRACT — the generated-once initial password is surfaced
 *     only from the engine response (`memberships[0].initialPassword`) in a
 *     single display; it is never logged, audited, or persisted client-side.
 * (c) LEGACY CREATOR GONE — provisioning.functions.ts no longer exports
 *     `createSchoolWithAdmin` (nor its input/result types), and the
 *     partially predictable `defaultAdminPassword` derivation is retired;
 *     `resetSchoolAdminPassword` uses the engine's generated-once password.
 *
 * Static source analysis (the repository vitest environment is `node` — no
 * jsdom/RTL): the suite reads the migrated sources and asserts the
 * migration markers against them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

const FORM = "frontend/src/components/super-admin/add-school-form.tsx";
const LEGACY = "frontend/src/lib/runtime/scholar/provisioning.functions.ts";
const ENGINE_FN = "frontend/src/lib/onboarding/provision-organization.functions.ts";

/* ─────────────────────────────────────────────────────────────
 * (a) The form path resolves through the onboarding engine
 * ────────────────────────────────────────────────────────────*/

describe("(a) the Add School form resolves through provisionOrganization", () => {
  const source = read(FORM);

  it("binds useServerFn to the engine server function", () => {
    expect(source).toMatch(
      /import\s*\{[\s\S]*provisionOrganization,[\s\S]*type\s*ProvisionOrganizationResponse[\s\S]*\}\s*from\s*"@\/lib\/onboarding\/provision-organization\.functions"/,
    );
    expect(source).toMatch(/useServerFn\(provisionOrganization\)/);
    // No trace of the legacy caller wiring remains.
    expect(source).not.toMatch(/runtime\/scholar\/provisioning\.functions/);
    expect(source).not.toMatch(/createSchoolWithAdmin/);
    expect(source).not.toMatch(/CreateSchoolResult|CreateSchoolInput/);
  });

  it("maps the form state onto the neutral request contract for the Scholar domain", () => {
    expect(source).toMatch(/domainId:\s*"scholar"/);
    expect(source).toMatch(/role:\s*"school_admin"/);
    expect(source).toMatch(/createAuthAccount:\s*true/);
    expect(source).toMatch(/identity:\s*{/);
    expect(source).toMatch(/structure:\s*{/);
    expect(source).toMatch(/subscriptionTier:\s*tier/);
    expect(source).toMatch(/monthlyFee/);
  });

  it("narrows the engine outcome union before treating the result as provisioned", () => {
    expect(source).toMatch(/if\s*\(!r\.ok\)\s*{/);
    expect(source).toMatch(/r\.failedStep/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * (b) Generated-once credentials surfaced exactly once
 * ────────────────────────────────────────────────────────────*/

describe("(b) credentials follow the engine's generated-once contract", () => {
  const source = read(FORM);

  it("surfaces the admin's initial password only from the engine response", () => {
    expect(source).toMatch(/r\.memberships\[0\]/);
    expect(source).toMatch(/admin\.initialPassword/);
  });

  it("never logs or persists the credential client-side", () => {
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    // The credential lives only in component state for the single display.
    expect(source).toMatch(/initialPassword:\s*admin\.initialPassword/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * (c) The legacy creator is gone
 * ────────────────────────────────────────────────────────────*/

describe("(c) createSchoolWithAdmin and defaultAdminPassword are retired", () => {
  const legacySource = read(LEGACY);
  const engineFnSource = read(ENGINE_FN);

  it("provisioning.functions.ts no longer exports the legacy creator", () => {
    expect(legacySource).not.toMatch(/export const createSchoolWithAdmin/);
    expect(legacySource).not.toMatch(/export type CreateSchoolInput/);
    expect(legacySource).not.toMatch(/export type CreateSchoolResult/);
    expect(legacySource).not.toMatch(/createSchoolSchema/);
    expect(legacySource).not.toMatch(/defaultAdminPassword/);
    expect(legacySource).not.toMatch(/Admin@\$/);
  });

  it("resetSchoolAdminPassword issues generated-once passwords (no derived slug+year pattern)", () => {
    const block = legacySource.slice(legacySource.indexOf("export const resetSchoolAdminPassword"));
    expect(block).toMatch(/generateInitialPassword\(\)/);
    expect(block).not.toMatch(/new Date\(\)\.getFullYear\(\)/);
  });

  it("the engine server function remains the sanctioned provisioning entry point", () => {
    expect(engineFnSource).toMatch(/export const provisionOrganization = createServerFn/);
    expect(engineFnSource).toMatch(/requirePlatformSuperAdmin\(/);
    expect(engineFnSource).toMatch(/executeOrganizationProvisioning\(/);
  });
});
