#!/usr/bin/env node
/**
 * CoreGrid — live Scholar config wiring verification (Phase 04 first vertical).
 *
 * Replicates the DB path of `scholar-institution-config.functions.ts` using
 * the REAL pure contracts (school-builder A3, blueprint A4, kernel
 * entity/event drafts) bundled by esbuild, then the service-role client:
 *   1. buildSchoolSpec + createBlueprint validate a fixture operating model
 *   2. entityDraft → insert cg_entity (scholar.institution.operating_model)
 *   3. version chain: second publish supersedes the first (state +
 *      superseded_by on the substrate row)
 *   4. eventDraft → cg_event audit record
 * Fixtures are always cleaned up.
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
    contents: `import { buildSchoolSpec } from "@/lib/scholar/school-builder";
import { createBlueprint } from "@/lib/scholar/blueprint";
import { entityDraft, eventDraft } from "@/lib/kernel/reality";
export const buildSchoolSpecFn = buildSchoolSpec;
export const createBlueprintFn = createBlueprint;
export const entityDraftFn = entityDraft;
export const eventDraftFn = eventDraft;`,
    resolveDir: ROOT,
    sourcefile: "scholar-config-verify-entry.ts",
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  alias: { "@": join(ROOT, "frontend", "src") },
});
const tmpBundle = join(ROOT, "scripts", ".tmp-scholar-config-verify.mjs");
writeFileSync(tmpBundle, built.outputFiles[0].text);
const { buildSchoolSpecFn, createBlueprintFn, entityDraftFn, eventDraftFn } = await import(
  pathToFileURL(tmpBundle).href + `?t=${Date.now()}`
);
rmSync(tmpBundle, { force: true });

const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const stamp = `${Date.now()}`.slice(-8);
const now = new Date().toISOString();
const ENTITY_TYPE = "scholar.institution.operating_model";
const EVENT_TYPE = "scholar.institution.operating_model.published";
const tenantId = `tenant:scholar-verify-${stamp}`;
const results = [];
const check = (name, ok, detail) => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const parts = {
  levels: [
    { name: "Lower Primary", code: "lower", sortOrder: 0 },
    { name: "Upper Primary", code: "upper", sortOrder: 1 },
  ],
  programmes: [{ name: "Basic Education", code: "basic", sortOrder: 0 }],
  campuses: [{ name: "Main Campus" }],
};

let firstId = null;
let secondId = null;
const eventIds = [];
try {
  const builtSpec = buildSchoolSpecFn(parts);
  if (!builtSpec.ok) throw new Error(`configuration invalid: ${builtSpec.issues.join("; ")}`);
  check(
    "A3 buildSchoolSpec validates fixture",
    builtSpec.ok,
    `${parts.levels.length} levels, ${parts.programmes.length} programmes`,
  );

  const makeBlueprint = (version) =>
    createBlueprintFn({
      spec: builtSpec.spec,
      blueprintId: `bp:verify:${version}`,
      author: "verify-script",
      reason: "live wiring verification",
      now,
      previous: version === 1 ? null : { version: version - 1 },
    });
  const bp1 = makeBlueprint(1);
  check(
    "A4 createBlueprint (v1)",
    bp1.ok,
    bp1.ok ? `version ${bp1.blueprint.header.version}` : bp1.issues.join("; "),
  );
  if (!bp1.ok) throw new Error("blueprint v1 failed");

  const entityRow1 = entityDraftFn(
    {
      entityType: ENTITY_TYPE,
      tenantId,
      state: "active",
      classification: "INTERNAL",
      attributes: {
        kind: "operating_model",
        blueprint: {
          blueprint_id: bp1.blueprint.header.blueprintId,
          version: bp1.blueprint.header.version,
          author: bp1.blueprint.header.author,
          reason: bp1.blueprint.header.reason,
          previous_version: bp1.blueprint.header.previousVersion,
          published_at: bp1.blueprint.header.timestamp,
        },
        spec: parts,
      },
      sourceType: "configuration",
      observedAt: now,
      validFrom: now,
    },
    now,
  );
  const ins1 = await svc
    .from("cg_entity")
    .insert(entityRow1)
    .select("id, entity_type, tenant_id")
    .single();
  if (ins1.error) throw new Error(`entity v1 insert: ${ins1.error.message}`);
  firstId = ins1.data.id;
  check(
    "kernel cg_entity insert (tenant-scoped, entity_type set)",
    ins1.data.entity_type === ENTITY_TYPE && ins1.data.tenant_id === tenantId,
    tenantId,
  );

  const bp2 = makeBlueprint(2);
  const entityRow2 = entityDraftFn(
    {
      entityType: ENTITY_TYPE,
      tenantId,
      state: "active",
      classification: "INTERNAL",
      attributes: {
        kind: "operating_model",
        blueprint: {
          blueprint_id: bp2.blueprint.header.blueprintId,
          version: bp2.blueprint.header.version,
          author: bp2.blueprint.header.author,
          reason: bp2.blueprint.header.reason,
          previous_version: bp2.blueprint.header.previousVersion,
          published_at: bp2.blueprint.header.timestamp,
        },
        spec: parts,
      },
      sourceType: "configuration",
      observedAt: now,
      validFrom: now,
    },
    now,
  );
  const ins2 = await svc.from("cg_entity").insert(entityRow2).select("id").single();
  if (ins2.error) throw new Error(`entity v2 insert: ${ins2.error.message}`);
  secondId = ins2.data.id;

  const sup = await svc
    .from("cg_entity")
    .update({ state: "superseded", superseded_by: secondId })
    .eq("id", firstId)
    .select("state, superseded_by")
    .single();
  if (sup.error) throw new Error(`supersede: ${sup.error.message}`);
  check(
    "version chain supersedes v1 via cg_entity.superseded_by",
    sup.data.state === "superseded" && sup.data.superseded_by === secondId,
    "v1 → v2",
  );

  const audit = eventDraftFn(
    {
      eventType: EVENT_TYPE,
      aggregateType: "cg_entity",
      aggregateId: secondId,
      actorIdentity: "verify-script",
      tenantId,
      idempotencyKey: `verify:${stamp}`,
      payload: { version: 2, superseded_previous: true },
      occurredAt: now,
    },
    now,
  );
  const evIns = await svc
    .from("cg_event")
    .insert(audit)
    .select("id, event_type, tenant_id")
    .single();
  if (evIns.error) throw new Error(`audit event insert: ${evIns.error.message}`);
  eventIds.push(evIns.data.id);
  check(
    "cg_event audit record written (tenant-scoped)",
    evIns.data.event_type === EVENT_TYPE && evIns.data.tenant_id === tenantId,
    evIns.data.id,
  );

  // Query surface: current-detail read returns the active (v2) model with its
  // full spec; version history returns the chain oldest-first.
  const detail = await svc
    .from("cg_entity")
    .select("attributes")
    .eq("tenant_id", tenantId)
    .eq("entity_type", ENTITY_TYPE)
    .eq("state", "active")
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (detail.error) throw new Error(`detail read: ${detail.error.message}`);
  const detailAttrs = detail.data?.attributes ?? {};
  const detailVersion = detailAttrs?.blueprint?.version;
  check(
    "current-detail read (active v2 + spec present)",
    detailVersion === 2 && Array.isArray(detailAttrs?.spec?.levels),
    `version ${detailVersion}, ${detailAttrs?.spec?.levels?.length} levels`,
  );

  const history = await svc
    .from("cg_entity")
    .select("state, attributes")
    .eq("tenant_id", tenantId)
    .eq("entity_type", ENTITY_TYPE)
    .order("valid_from", { ascending: true });
  if (history.error) throw new Error(`history read: ${history.error.message}`);
  const versions = (history.data ?? [])
    .map((row) => {
      const attributes = row?.attributes ?? {};
      return { state: row?.state, version: attributes?.blueprint?.version };
    })
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
  check(
    "version-history read (oldest-first, superseded then active)",
    versions.length === 2 &&
      versions[0].version === 1 &&
      versions[0].state === "superseded" &&
      versions[1].version === 2 &&
      versions[1].state === "active",
    JSON.stringify(versions),
  );
} catch (err) {
  check("Scholar config wiring execution", false, err.message);
} finally {
  if (firstId) await svc.from("cg_entity").delete().eq("id", firstId);
  if (secondId) await svc.from("cg_entity").delete().eq("id", secondId);
  for (const id of eventIds) await svc.from("cg_event").delete().eq("id", id);
}

const failed = results.filter((r) => !r.ok).length;
console.log(
  `\nScholar config wiring verification: ${results.length - failed}/${results.length} passed.`,
);
process.exit(failed === 0 ? 0 : 1);
