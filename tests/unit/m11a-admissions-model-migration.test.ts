import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Pins the safety statements of the M11 part A migration (ADR-111). Behaviour is proved by
// tests/sql/m11-admissions-model.sql on a disposable Postgres; this test keeps the text honest.
const ROOT = join(__dirname, "..", "..");
const NAME = "20261117001400_sherivs_m11_admissions_model.sql";
const up = readFileSync(join(ROOT, "database", "supabase", "migrations", NAME), "utf8");
const down = readFileSync(join(ROOT, "database", "supabase", "rollbacks", NAME), "utf8");
const sqlTest = readFileSync(join(ROOT, "tests", "sql", "m11-admissions-model.sql"), "utf8");
const code = up.replace(/--.*$/gm, "");

const TABLES = [
  "admission_settings",
  "admission_cycles",
  "admission_programmes",
  "admission_forms",
  "admission_question_bank",
  "admission_screenings",
  "admission_scores",
  "admission_offers",
  "admission_documents",
];
const ADDED_COLUMNS = [
  "cycle_id",
  "programme_id",
  "form_version",
  "jamb_reg_no",
  "utme_score",
  "caps_status",
  "entry_mode",
];

describe("M11a admissions model migration (static)", () => {
  it("is marked not applied, has no transaction control and a paired rollback", () => {
    expect(up.split("\n")[0]).toBe(
      "-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.",
    );
    expect(code).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(down).toContain("NOT APPLIED");
  });

  it("creates every table with forced RLS, a full revoke, an audit trigger and no anon grant", () => {
    for (const t of TABLES) {
      expect(code).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`);
      expect(code).toContain(
        `REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated, service_role`,
      );
      expect(code).toMatch(new RegExp(`GRANT [A-Z, ]+ ON TABLE public\\.${t} TO authenticated`));
    }
    expect(code).toContain("ALTER TABLE public.%I FORCE ROW LEVEL SECURITY");
    expect(code).toContain("EXECUTE FUNCTION public.scholar_audit()");
    expect(code).not.toMatch(/GRANT[^;]*\bTO\s+(anon|PUBLIC)\b/i);
    expect(code).not.toMatch(/GRANT[^;]*(DELETE|TRUNCATE)[^;]*TO authenticated/);
    expect(code).not.toMatch(/GRANT ALL/);
  });

  it("leaves the anonymous insert path and its policy untouched", () => {
    expect(code).not.toContain('"public can submit applications"');
    expect(code).not.toMatch(/ON public\.admission_applications[^;]*TO anon/);
    expect(code).toContain(
      "IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;",
    );
  });

  it("keeps staff inside their own organization and names a permission in every client policy", () => {
    const policies = [
      ...code.matchAll(/CREATE POLICY (\w+) ON public\.(\w+) FOR \w+ TO authenticated([\s\S]*?);/g),
    ];
    expect(policies.length).toBeGreaterThanOrEqual(20);
    for (const [, name, , body] of policies) {
      expect(body, name).toContain("org_id = public.get_my_school_id()");
      expect(body, name).toMatch(/public\.scholar_can\(org_id, 'admissions\.[a-z]+'\)/);
    }
    for (const perm of ["configure", "screen", "score", "offer", "view"]) {
      expect(code).toContain(`'admissions.${perm}'`);
    }
  });

  it("enforces separation of duties, expiry and append-only scores in the database", () => {
    expect(code).toContain("the person who drafted an offer cannot approve it");
    expect(code).toContain("a person who scored this application cannot approve its offer");
    expect(code).toContain("coalesce(separation, true)");
    expect(code).toContain("score_offer_separation boolean NOT NULL DEFAULT true");
    expect(code).toContain("this offer has expired and cannot be accepted");
    expect(code).toContain("EXECUTE FUNCTION public.append_only_guard()");
    expect(code).toContain("a published admission form version is immutable");
    expect(code).toContain("ON public.admission_cycles (org_id, intake) WHERE status = 'open'");
  });

  it("uses composite keys for tenant integrity and a private bucket for documents", () => {
    expect(code).toContain("REFERENCES public.admission_cycles (id, org_id)");
    expect(code).toContain("REFERENCES public.admission_applications (id, school_id)");
    expect(code).toContain("REFERENCES public.admission_programmes (id, cycle_id, org_id)");
    expect(code).toMatch(/'admission-documents', 'admission-documents', false/);
    expect(code).toContain("scan_status = 'clean'");
  });

  it("hides protected attributes from the blind scoring surface and tertiary fields from the table", () => {
    const surface = code.slice(
      code.indexOf("FUNCTION public.admission_blind_applications"),
      code.indexOf("REVOKE ALL ON FUNCTION public.admission_blind_applications"),
    );
    for (const hidden of [
      "student_gender",
      "student_date_of_birth",
      "student_religion",
      "medical_conditions",
      "disabilities_or_special_needs",
      "parent_one_occupation",
      "student_first_name",
      "jamb_reg_no",
    ]) {
      expect(surface).not.toContain(hidden);
    }
    expect(code).toContain(
      "attname NOT IN ('jamb_reg_no', 'utme_score', 'caps_status', 'entry_mode')",
    );
    expect(code).toContain(
      "REVOKE SELECT ON TABLE public.admission_applications FROM authenticated",
    );
  });

  it("adds functions that derive the organization from the caller and never take an amount", () => {
    const fns = [...code.matchAll(/CREATE OR REPLACE FUNCTION (public\.\w+)\(([^)]*)\)/g)];
    for (const [, name, args] of fns) {
      expect(args, name).not.toMatch(/org|school|amount|fee|_minor/i);
    }
    for (const [, name] of fns) {
      const body = code.slice(code.indexOf(`FUNCTION ${name}(`));
      expect(body.slice(0, body.indexOf(" AS $$")), name).toContain("SET search_path = ''");
      expect(code, name).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION ${name.replace(".", "\\.")}\\([^)]*\\) FROM PUBLIC, anon`,
        ),
      );
    }
  });

  it("rolls back every added column and the SELECT change on admission_applications", () => {
    for (const c of ADDED_COLUMNS) {
      expect(down).toContain(
        `ALTER TABLE public.admission_applications DROP COLUMN IF EXISTS ${c};`,
      );
    }
    for (const t of TABLES) expect(down).toContain(`DROP TABLE IF EXISTS public.${t};`);
    expect(down).toContain("GRANT SELECT ON TABLE public.admission_applications TO authenticated;");
    expect(down).toContain("DROP CONSTRAINT IF EXISTS admission_applications_id_school_id_key");
    expect(sqlTest).toContain("M11A ADMISSIONS MODEL TESTS PASSED");
  });

  it("contains no secrets", () => {
    expect(up).not.toMatch(/password|secret|api[_-]?key|service_role_key|sk_live/i);
  });
});
