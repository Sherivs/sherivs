#!/usr/bin/env node
/**
 * CoreGrid — live workforce-substrate verification (20260907000000/0100/0300).
 *
 * Proves against the real project that the workforce substrate is applied and
 * that the seeded database catalog cannot drift from the typed runtime catalog
 * (`runtime/scholar-workforce.ts`), using the service-role client. Pure data
 * only — no writes, no cleanup needed. Run AFTER:
 *   supabase db push --workdir database/supabase
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
    contents: `import {
  SCHOLAR_RUNTIME_REF,
  SCHOLAR_WORKFORCE_KINDS,
  SCHOLAR_WORKFORCE_CODE_SET,
} from "@/lib/runtime/scholar-workforce";
export const scholarRuntimeRef = SCHOLAR_RUNTIME_REF;
export const scholarKinds = SCHOLAR_WORKFORCE_KINDS;
export const scholarCodeSet = SCHOLAR_WORKFORCE_CODE_SET;`,
    resolveDir: ROOT,
    sourcefile: "workforce-verify-entry.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  alias: { "@": join(ROOT, "frontend", "src") },
});
const tmpBundle = join(ROOT, "scripts", ".tmp-workforce-verify.mjs");
writeFileSync(tmpBundle, built.outputFiles[0].text);
const { scholarRuntimeRef, scholarKinds, scholarCodeSet } = await import(
  pathToFileURL(tmpBundle).href + `?t=${Date.now()}`
);
rmSync(tmpBundle, { force: true });

const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
let failed = false;
const check = (name, ok, detail) => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

// 1. Control-plane probe: Phase 02 universal identity migration already live?
const identityProbe = await svc.from("cg_identity").select("id").limit(1).maybeSingle();
check(
  "cg_identity reachable (P02 migration applied)",
  !identityProbe.error,
  identityProbe.error?.message ?? "ok",
);

// 2. Domain-runtime registry row that the catalog seed depends on.
const runtimeProbe = await svc
  .from("cg_domain_runtime")
  .select("id, status, version")
  .eq("id", "runtime:scholar")
  .maybeSingle();
check(
  "cg_domain_runtime holds runtime:scholar (FK target seeded)",
  !runtimeProbe.error && !!runtimeProbe.data,
  runtimeProbe.error?.message ?? `${runtimeProbe.data?.status} ${runtimeProbe.data?.version ?? ""}`,
);

// 3. Seeded catalog parity with the typed catalog (row count + code set).
const catalogProbe = await svc
  .from("cg_workforce_kind")
  .select("kind_code, title")
  .eq("runtime_ref", scholarRuntimeRef)
  .limit(1000);
if (catalogProbe.error) {
  check(
    "cg_workforce_kind reachable (substrate 20260907000000 applied)",
    false,
    catalogProbe.error.message,
  );
} else {
  const rows = (catalogProbe.data ?? []).filter((r) => typeof r.kind_code === "string");
  const dbCodes = new Set(rows.map((r) => r.kind_code));
  check(
    "seeded catalog row count == typed catalog",
    rows.length === scholarKinds.length,
    `db=${rows.length} typed=${scholarKinds.length}`,
  );
  check(
    "seeded catalog codes == typed catalog codes",
    dbCodes.size === scholarCodeSet.size && [...dbCodes].every((c) => scholarCodeSet.has(c)),
    `db=${dbCodes.size} typed=${scholarCodeSet.size}`,
  );
  check(
    "catalog covers the African staff breadth (>= 30 kinds)",
    rows.length >= 30,
    `${rows.length} staff kinds installed`,
  );
}

// 4. Position registry reachable (substrate table created).
const positionProbe = await svc.from("cg_workforce_position").select("id").limit(1);
check(
  "cg_workforce_position reachable (RLS deny-by-default)",
  !positionProbe.error,
  positionProbe.error?.message ?? "ok (no rows yet expected)",
);

// 5. Org-admin RPC surface is callable without error via service role (the
//    security-definer gate simply returns no rows when auth.uid() is absent).
const rpcProbe = await svc.rpc("list_workforce_positions", {
  p_tenant: "00000000-0000-4000-8000-000000000000",
});
check(
  "list_workforce_positions callable (RPC migration 20260907000300 applied)",
  !rpcProbe.error,
  rpcProbe.error?.message ?? "ok",
);

// 6. Self-scoped position RPC (20260907000400): callable, returns no rows for
//    the service role (no auth.uid()), proving zero data exposure.
const selfProbe = await svc.rpc("get_my_primary_workforce_position");
check(
  "get_my_primary_workforce_position callable (20260907000400 applied)",
  !selfProbe.error && Array.isArray(selfProbe.data) && selfProbe.data.length === 0,
  selfProbe.error?.message ?? "ok (service role has no uid)",
);

console.log(failed ? "RESULT: FAILURES PRESENT" : "RESULT: ALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
