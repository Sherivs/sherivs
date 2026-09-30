#!/usr/bin/env node
/**
 * CoreGrid — live L2 registry verification (P02 cg_identity / P03 cg_tenant).
 *
 * Replicates the server-function DB path of `identity-registry.functions.ts`
 * and `tenant-registry.functions.ts` using the REAL pure draft builders
 * (esbuild-bundled) and the service-role client, then cleans up:
 *   - registerTenant path: tenantDraft → insert (slug idempotency handled)
 *   - registerIdentity path: identityDraft → insert (tenant-scoped row)
 *
 * Env (never hard-coded): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { createClient } from "@supabase/supabase-js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(2);
}

const built = buildSync({
  stdin: {
    contents: `import { tenantDraft } from "@/lib/tenant-registry";
import { identityDraft } from "@/lib/identity-registry";
export const tenant = tenantDraft;
export const identity = identityDraft;`,
    resolveDir: ROOT,
    sourcefile: "l2-verify-entry.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  alias: { "@": join(ROOT, "frontend", "src") },
});
const tmpBundle = join(ROOT, "scripts", ".tmp-l2-verify.mjs");
writeFileSync(tmpBundle, built.outputFiles[0].text);
const { tenant, identity } = await import(pathToFileURL(tmpBundle).href + `?t=${Date.now()}`);
rmSync(tmpBundle, { force: true });

const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const stamp = `${Date.now()}`.slice(-8);
const now = new Date().toISOString();
const results = [];
const check = (name, ok, detail) => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const tenantSlug = `l2-tenant-${stamp}`;
let tenantId = null;
let identityId = null;
try {
  const tRow = tenant({ tenantType: "platform", name: "L2 Tenant Fixture", slug: tenantSlug }, now);
  const tIns = await svc.from("cg_tenant").insert(tRow).select("id, slug").single();
  if (tIns.error) throw new Error(`tenant insert: ${tIns.error.message}`);
  tenantId = tIns.data.id;
  check(
    "registerTenant DB path (tenantDraft → insert)",
    tIns.data.slug === tenantSlug,
    tIns.data.slug,
  );

  const tDup = await svc.from("cg_tenant").select("id").eq("slug", tenantSlug).maybeSingle();
  check("tenant slug idempotency (existing returned)", !tDup.error && !!tDup.data, tDup.data?.id);

  const iRow = identity(
    {
      kind: "human",
      displayName: "L2 Identity Fixture",
      tenantId: `tenant:${tenantSlug}`,
      state: "active",
      verified: false,
    },
    now,
  );
  const iIns = await svc.from("cg_identity").insert(iRow).select("id, tenant_id, state").single();
  if (iIns.error) throw new Error(`identity insert: ${iIns.error.message}`);
  identityId = iIns.data.id;
  check(
    "registerIdentity DB path (identityDraft → insert, tenant-scoped)",
    iIns.data.tenant_id === `tenant:${tenantSlug}` && iIns.data.state === "active",
    iIns.data.tenant_id,
  );
} catch (err) {
  check("L2 registry execution", false, err.message);
} finally {
  if (identityId) await svc.from("cg_identity").delete().eq("id", identityId);
  if (tenantId) await svc.from("cg_tenant").delete().eq("id", tenantId);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nL2 registry verification: ${results.length - failed}/${results.length} passed.`);
process.exit(failed === 0 ? 0 : 1);
