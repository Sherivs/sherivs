/**
 * CoreGrid — school-media bucket migration posture test (post-R-wave
 * follow-up, team T-C / STORAGE-PROVISION).
 *
 * Text-level posture verification of the school-media storage-bucket
 * provisioning migration, in the pattern of
 * tests/unit/communications/delivery-evidence-migration-posture.test.ts and
 * tests/unit/h3-040-posture-adjudication.test.ts (read-only file assertions,
 * no database, no network):
 *   1. the migration provisions the bucket idempotently (no-op if present);
 *   2. the declared bucket id matches the consuming code ('school-media');
 *   3. the bucket posture is PRIVATE — the frontend uploads as the
 *      authenticated admin and renders via createSignedUrl;
 *   4. the bucket envelope is bounded (8 MB, image mime types — least
 *      privilege, mirroring the client contract);
 *   5. the migration authors ZERO new policies — the object policies are
 *      owned by the applied migration 20260707223958 and are only
 *      referenced, never widened (no permission expansion, AGENTS §8);
 *   6. the rollback is a genuine inverse.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const MIGRATION_PATH = "database/supabase/migrations/20261003000040_coregrid_school_media_bucket.sql";
const ROLLBACK_PATH = "database/supabase/rollbacks/20261003000040_coregrid_school_media_bucket.sql";

const MIGRATION = readFileSync(join(ROOT, MIGRATION_PATH), "utf8");
const ROLLBACK = readFileSync(join(ROOT, ROLLBACK_PATH), "utf8");

describe("school-media bucket migration — provisioning signature", () => {
  it("targets the exact storage.buckets substrate and is idempotent", () => {
    expect(MIGRATION).toContain("INSERT INTO storage.buckets");
    expect(MIGRATION).toContain("ON CONFLICT (id) DO NOTHING;");
  });

  it("declares the bucket id the frontend and e2e require", () => {
    expect(MIGRATION).toContain("  'school-media',\n  'school-media',");
  });

  it("declares the bucket PRIVATE (frontend renders via createSignedUrl, not a public URL)", () => {
    // The posture line: id, name, public = false.
    expect(MIGRATION).toMatch(/'school-media',\s*\n\s*'school-media',\s*\n\s*false,/);
    // And it must not declare a public bucket anywhere.
    expect(MIGRATION).not.toMatch(/\bpublic\s*=\s*true\b/);
    expect(MIGRATION).not.toContain("public: true");
  });

  it("bounds the bucket envelope (8 MB / image mime types — least privilege, §16)", () => {
    expect(MIGRATION).toContain("8388608");
    expect(MIGRATION).toMatch(/allowed_mime_types/);
    for (const mime of [
      "'image/png'",
      "'image/jpeg'",
      "'image/webp'",
      "'image/gif'",
      "'image/avif'",
    ]) {
      expect(MIGRATION).toContain(mime);
    }
    // No catch-all mime declaration.
    expect(MIGRATION).not.toContain("'*/*'");
  });

  it("authors ZERO new policies — grants nothing beyond the missing bucket row", () => {
    // Statement-level check: line-anchored so the migration's explanatory
    // COMMENTARY mentioning CREATE POLICY is not a false positive — only an
    // actual policy/grant statement would match.
    expect(MIGRATION).not.toMatch(/^\s*CREATE POLICY/im);
    expect(MIGRATION).not.toMatch(/^\s*GRANT /im);
    // The pre-existing policy owner is cited, not duplicated.
    expect(MIGRATION).toContain("20260707223958_421f2364-7989-4069-b78c-fd119f19daeb.sql");
    // Tenant-scoping decision is documented explicitly (AGENTS §13/§17).
    expect(MIGRATION).toContain("get_my_school_id()");
  });

  it("declares AUTHORED-NOT-APPLIED status and names its rollback (governance law)", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261003000040_coregrid_school_media_bucket.sql",
    );
  });
});

describe("school-media bucket rollback — genuine inverse", () => {
  it("removes exactly the one row the migration inserted", () => {
    expect(ROLLBACK).toContain("DELETE FROM storage.buckets WHERE id = 'school-media';");
    // Nothing else is dropped: policies belong to 20260707223958 and survive.
    expect(ROLLBACK).not.toMatch(/DROP POLICY|DROP TABLE|DROP FUNCTION/);
  });

  it("runs in one transaction", () => {
    expect(ROLLBACK).toContain("BEGIN;");
    expect(ROLLBACK).toContain("COMMIT;");
  });

  it("documents the data-loss surface (objects become unreachable after bucket delete)", () => {
    expect(ROLLBACK).toContain("DATA NOTE");
    expect(ROLLBACK).toContain("unreachable");
  });
});
