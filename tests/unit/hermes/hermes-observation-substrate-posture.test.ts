/**
 * V1 wave team R4 (HERMES-PORT) — migration posture adjudication for the
 * Hermes observation substrate: cg_hermes_observation.
 *
 * Text-level posture verification (the h3-040 pattern): the AUTHORED, NOT
 * APPLIED migration must carry the deny-by-default signature of the repo's
 * substrate exemplars (RLS enabled, ZERO policies, anon/authenticated
 * revoked, service-role only), the §9/§12 canonical-truth and provenance
 * laws as database CHECKs, and append-only enforcement by trigger — and its
 * rollback must be the genuine inverse at the same basename. No database
 * access, no network, no secrets; the files are read, never modified.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const MIGRATION_PATH =
  "database/supabase/migrations/20261003000030_coregrid_hermes_observation_substrate.sql";
const ROLLBACK_PATH =
  "database/supabase/rollbacks/20261003000030_coregrid_hermes_observation_substrate.sql";

const MIGRATION = readFileSync(join(ROOT, MIGRATION_PATH), "utf8");
const ROLLBACK = readFileSync(join(ROOT, ROLLBACK_PATH), "utf8");

/* ── 1. Substrate definition ─────────────────────────────────── */

describe("cg_hermes_observation migration defines the append-only provenance substrate", () => {
  it("creates the cg_hermes_observation table", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.cg_hermes_observation (");
  });

  it("carries the §12 provenance columns (where from, who/what, when, AI flag)", () => {
    for (const column of [
      "source",
      "event_ref",
      "subject_ref",
      "observed_at",
      "recorded_at",
      "created_by",
      "generated_by_ai",
      "trace_id",
      "correlation_id",
      "declared_origin",
    ]) {
      expect(MIGRATION).toContain(column);
    }
  });

  it("enforces the §9 canonical-truth law at the database (intelligence-only CHECK)", () => {
    expect(MIGRATION).toContain(
      "CONSTRAINT cg_hermes_observation_intelligence_only CHECK (\n    generated_by_ai IS TRUE AND verified IS FALSE\n  )",
    );
  });

  it("enforces §12 event-source coherence (event-sourced observations cite their event)", () => {
    expect(MIGRATION).toContain(
      "CONSTRAINT cg_hermes_observation_event_source_coherence CHECK (\n    (source = 'event' AND event_ref IS NOT NULL) OR source = 'direct'\n  )",
    );
  });

  it("enforces append-only semantics by trigger (§9/§12: observations are never rewritten)", () => {
    expect(MIGRATION).toContain(
      "CREATE OR REPLACE FUNCTION public.cg_hermes_observation_append_only()",
    );
    expect(MIGRATION).toContain("BEFORE UPDATE OR DELETE ON public.cg_hermes_observation");
    expect(MIGRATION).toMatch(/RAISE EXCEPTION[\s\S]*append-only/);
  });

  it("authors the partial unique (tenant_id, event_ref) index — exactly-once event consumption", () => {
    expect(MIGRATION).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS cg_hermes_observation_tenant_event_idx\n  ON public.cg_hermes_observation (tenant_id, event_ref)\n  WHERE event_ref IS NOT NULL;",
    );
  });

  it("never authors an UPDATE or DELETE path in application SQL", () => {
    expect(MIGRATION).not.toMatch(/^\s*UPDATE\s+public\.cg_hermes_observation/m);
    expect(MIGRATION).not.toMatch(/^\s*DELETE\s+FROM\s+public\.cg_hermes_observation/m);
  });
});

/* ── 2. Deny-by-default posture (the exemplar signature) ─────── */

describe("cg_hermes_observation deny-by-default posture", () => {
  it("enables RLS on the substrate", () => {
    expect(MIGRATION).toContain(
      "ALTER TABLE public.cg_hermes_observation ENABLE ROW LEVEL SECURITY;",
    );
  });

  it("authors ZERO policies (no CREATE POLICY anywhere in the migration)", () => {
    expect(MIGRATION).toContain("ZERO policies");
    expect(MIGRATION).not.toMatch(/CREATE POLICY[^\n]*cg_hermes_observation/);
    expect(MIGRATION).not.toMatch(/^\s*CREATE POLICY/m);
  });

  it("revokes all client privileges and grants service-role only (deny-by-default strongest form)", () => {
    expect(MIGRATION).toContain(
      "REVOKE ALL ON public.cg_hermes_observation FROM anon, authenticated;",
    );
    expect(MIGRATION).toContain("GRANT ALL ON public.cg_hermes_observation TO service_role;");
  });

  it("declares itself AUTHORED, NOT APPLIED (no silent apply, governance law)", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
  });
});

/* ── 3. Genuine inverse (rollback at the same basename) ──────── */

describe("cg_hermes_observation rollback is the genuine inverse", () => {
  it("exists at the same basename as the migration", () => {
    expect(ROLLBACK_PATH).toBe("database/supabase/rollbacks/" + MIGRATION_PATH.split("/").pop());
  });

  it("drops the trigger, table and guard function", () => {
    expect(ROLLBACK).toContain(
      "DROP TRIGGER IF EXISTS cg_hermes_observation_no_rewrite ON public.cg_hermes_observation;",
    );
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_hermes_observation;");
    expect(ROLLBACK).toContain(
      "DROP FUNCTION IF EXISTS public.cg_hermes_observation_append_only();",
    );
  });

  it("restores the pre-migration privilege posture (the exemplar inverse pattern)", () => {
    expect(ROLLBACK).toContain(
      "GRANT ALL ON TABLE public.cg_hermes_observation TO anon, authenticated;",
    );
  });

  it("runs in one transaction with a rollback plan (Constitution §38)", () => {
    expect(ROLLBACK).toContain("BEGIN;");
    expect(ROLLBACK).toContain("COMMIT;");
    expect(ROLLBACK).toContain("ROLLBACK PLAN (Constitution §38)");
  });
});
