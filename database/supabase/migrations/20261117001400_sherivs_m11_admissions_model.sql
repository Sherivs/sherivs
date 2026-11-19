-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- =============================================================================
-- M11 part A (mission E-014, ADR-115): the admissions data model and its rules.
--
-- Extends public.admission_applications; it does not replace it. Adds nine tables
-- (settings, cycles, programmes, forms, question bank, screenings, scores, offers,
-- documents), link and tertiary columns on admission_applications, a blind scoring
-- surface, a tertiary-field reader and a private storage bucket.
--
-- Safety statements (pinned by tests/unit/m11a-admissions-model-migration.test.ts):
--   * anon keeps exactly what it had: INSERT on admission_applications under the
--     unchanged "public can submit applications" policy, and nothing else. The new
--     columns must be NULL when anon (or a signed-in caller without
--     admissions.process) inserts; no new table or function is granted to anon.
--   * every new table: ENABLE and FORCE ROW LEVEL SECURITY, REVOKE ALL from PUBLIC,
--     anon, authenticated, explicit grants, explicit policies, scholar_audit trigger.
--   * staff act only inside their own organization (org_id = get_my_school_id())
--     and only with the permission code the policy names.
--   * applicants get no direct table access here; the applicant portal comes later
--     through server functions.
--   * no function added here takes an organization id or an amount from the caller.
--   * tenant integrity is structural: composite foreign keys (id, org_id) make a
--     link to another organization's row impossible.
--
-- Permission codes used by text: admissions.view, admissions.process, admissions.offer
-- (exist), admissions.configure, admissions.screen, admissions.score (must exist in
-- permission_catalog before this file is applied; another mission adds them).
--
-- Rollback: database/supabase/rollbacks/20261117001400_sherivs_m11_admissions_model.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. admission_applications must be addressable by (id, school_id) so that the
--    new tables can carry a composite foreign key to it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.admission_applications'::regclass
                    AND conname = 'admission_applications_id_school_id_key') THEN
    ALTER TABLE public.admission_applications
      ADD CONSTRAINT admission_applications_id_school_id_key UNIQUE (id, school_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Per-organization admissions settings (separation-of-duties switch).
--    No row means the default: the rule is ON.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES public.schools(id) ON DELETE CASCADE,
  score_offer_separation boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.admission_settings.score_offer_separation IS
  'When true (the default, also when no row exists) a person who scored an application cannot approve its offer.';

-- ---------------------------------------------------------------------------
-- 2. Admission cycles. One open cycle per organization and intake.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  session_label text NOT NULL CHECK (session_label ~ '^[0-9]{4}/[0-9]{4}$'),
  intake text NOT NULL DEFAULT 'main' CHECK (intake ~ '^[a-z][a-z0-9_]{1,31}$'),
  opens_at timestamptz NOT NULL,
  closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  application_fee_minor integer NOT NULL DEFAULT 0 CHECK (application_fee_minor >= 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_cycles_window_check CHECK (closes_at > opens_at),
  CONSTRAINT admission_cycles_id_org_id_key UNIQUE (id, org_id)
);
COMMENT ON COLUMN public.admission_cycles.application_fee_minor IS 'Minor units (kobo for NGN). Integer only.';
CREATE UNIQUE INDEX IF NOT EXISTS admission_cycles_one_open_per_intake
  ON public.admission_cycles (org_id, intake) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS admission_cycles_org_idx ON public.admission_cycles (org_id, status);

-- ---------------------------------------------------------------------------
-- 3. Programmes (a class entry or a tertiary programme) inside a cycle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  cycle_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  entry_level text NOT NULL CHECK (length(btrim(entry_level)) BETWEEN 1 AND 80),
  mode text NOT NULL DEFAULT 'full_time' CHECK (mode ~ '^[a-z][a-z_]{1,31}$'),
  quota integer CHECK (quota IS NULL OR quota >= 0),
  entry_requirements jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(entry_requirements) = 'object'),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rules) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_programmes_cycle_fkey FOREIGN KEY (cycle_id, org_id)
    REFERENCES public.admission_cycles (id, org_id) ON DELETE CASCADE,
  CONSTRAINT admission_programmes_code_key UNIQUE (cycle_id, code),
  CONSTRAINT admission_programmes_id_org_id_key UNIQUE (id, org_id),
  CONSTRAINT admission_programmes_id_cycle_org_key UNIQUE (id, cycle_id, org_id)
);
COMMENT ON COLUMN public.admission_programmes.rules IS
  'Selection rules: catchment, merit, state quota, cut-off mark, subject combinations. Interpreted by server code, never by the client.';

-- ---------------------------------------------------------------------------
-- 4. Versioned application forms. Version numbers are unique within a cycle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  cycle_id uuid NOT NULL,
  programme_id uuid,
  version integer NOT NULL CHECK (version >= 1),
  schema jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(schema) = 'object'),
  ui_schema jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ui_schema) = 'object'),
  document_requirements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(document_requirements) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_forms_cycle_fkey FOREIGN KEY (cycle_id, org_id)
    REFERENCES public.admission_cycles (id, org_id) ON DELETE CASCADE,
  CONSTRAINT admission_forms_programme_fkey FOREIGN KEY (programme_id, cycle_id, org_id)
    REFERENCES public.admission_programmes (id, cycle_id, org_id) ON DELETE CASCADE,
  CONSTRAINT admission_forms_version_key UNIQUE (cycle_id, version),
  CONSTRAINT admission_forms_link_key UNIQUE (cycle_id, version, org_id),
  CONSTRAINT admission_forms_published_check CHECK ((status = 'published') = (published_at IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- 5. Question bank for screening and interviews.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('short_text', 'long_text', 'choice', 'number', 'date', 'file', 'rating', 'likert')),
  prompt text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 4000),
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  rubric jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rubric) = 'object'),
  difficulty smallint CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  tags text[] NOT NULL DEFAULT '{}'::text[],
  owner_id uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_question_bank_id_org_id_key UNIQUE (id, org_id)
);

-- ---------------------------------------------------------------------------
-- 6. Screenings (CBT, interview, panel) and append-only rubric scores.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cbt', 'interview', 'panel')),
  scheduled_at timestamptz,
  slot text CHECK (slot IS NULL OR length(slot) <= 80),
  interviewer_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_screenings_application_fkey FOREIGN KEY (application_id, org_id)
    REFERENCES public.admission_applications (id, school_id) ON DELETE CASCADE,
  CONSTRAINT admission_screenings_link_key UNIQUE (id, application_id, org_id)
);
CREATE INDEX IF NOT EXISTS admission_screenings_app_idx ON public.admission_screenings (application_id);

CREATE TABLE IF NOT EXISTS public.admission_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  screening_id uuid,
  criterion text NOT NULL CHECK (criterion ~ '^[a-z][a-z0-9_]{0,63}$'),
  weight numeric NOT NULL CHECK (weight > 0 AND weight <= 100),
  raw_score numeric NOT NULL CHECK (raw_score >= 0),
  max_score numeric NOT NULL DEFAULT 100 CHECK (max_score > 0),
  scorer_id uuid NOT NULL,
  scored_at timestamptz NOT NULL DEFAULT now(),
  corrects_score_id uuid,
  correction_reason text,
  CONSTRAINT admission_scores_application_fkey FOREIGN KEY (application_id, org_id)
    REFERENCES public.admission_applications (id, school_id) ON DELETE CASCADE,
  CONSTRAINT admission_scores_screening_fkey FOREIGN KEY (screening_id, application_id, org_id)
    REFERENCES public.admission_screenings (id, application_id, org_id),
  CONSTRAINT admission_scores_link_key UNIQUE (id, application_id, org_id),
  CONSTRAINT admission_scores_corrects_fkey FOREIGN KEY (corrects_score_id, application_id, org_id)
    REFERENCES public.admission_scores (id, application_id, org_id),
  CONSTRAINT admission_scores_range_check CHECK (raw_score <= max_score),
  CONSTRAINT admission_scores_correction_check CHECK (
    (corrects_score_id IS NULL AND correction_reason IS NULL)
    OR (corrects_score_id IS NOT NULL AND correction_reason IS NOT NULL AND length(btrim(correction_reason)) >= 5))
);
-- A score is corrected at most once; a correction can itself be corrected.
CREATE UNIQUE INDEX IF NOT EXISTS admission_scores_one_correction
  ON public.admission_scores (corrects_score_id) WHERE corrects_score_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS admission_scores_app_idx ON public.admission_scores (application_id, scorer_id);

-- ---------------------------------------------------------------------------
-- 7. Offers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  programme_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'issued', 'accepted', 'declined', 'expired', 'withdrawn')),
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conditions) = 'array'),
  expires_at timestamptz,
  acceptance_fee_minor integer NOT NULL DEFAULT 0 CHECK (acceptance_fee_minor >= 0),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  drafted_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  issued_by uuid,
  issued_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_offers_application_fkey FOREIGN KEY (application_id, org_id)
    REFERENCES public.admission_applications (id, school_id) ON DELETE CASCADE,
  CONSTRAINT admission_offers_programme_fkey FOREIGN KEY (programme_id, org_id)
    REFERENCES public.admission_programmes (id, org_id),
  CONSTRAINT admission_offers_issue_check CHECK (
    status IN ('draft', 'pending_approval', 'withdrawn')
    OR (approved_by IS NOT NULL AND approved_by <> drafted_by AND issued_at IS NOT NULL))
);
COMMENT ON COLUMN public.admission_offers.acceptance_fee_minor IS 'Minor units (kobo for NGN). Payment code is a later mission.';
CREATE UNIQUE INDEX IF NOT EXISTS admission_offers_one_live_per_application
  ON public.admission_offers (application_id) WHERE status IN ('draft', 'pending_approval', 'issued', 'accepted');

-- ---------------------------------------------------------------------------
-- 8. Documents (metadata; the bytes live in the private admission-documents bucket).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admission_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{1,47}$'),
  storage_bucket text NOT NULL DEFAULT 'admission-documents' CHECK (storage_bucket = 'admission-documents'),
  storage_path text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'rejected')),
  scanned_at timestamptz,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admission_documents_application_fkey FOREIGN KEY (application_id, org_id)
    REFERENCES public.admission_applications (id, school_id) ON DELETE CASCADE,
  -- the object path is scoped to the organization and the application
  CONSTRAINT admission_documents_path_check CHECK (
    storage_path LIKE org_id::text || '/' || application_id::text || '/%'
    AND storage_path !~ '(^|/)\.\.(/|$)'),
  CONSTRAINT admission_documents_scan_check CHECK ((scan_status = 'pending') = (scanned_at IS NULL))
);
CREATE INDEX IF NOT EXISTS admission_documents_app_idx ON public.admission_documents (application_id);

-- ---------------------------------------------------------------------------
-- 9. Link and tertiary columns on admission_applications (all nullable).
-- ---------------------------------------------------------------------------
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS cycle_id uuid;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS programme_id uuid;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS form_version integer;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS jamb_reg_no text;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS utme_score smallint;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS caps_status text;
ALTER TABLE public.admission_applications ADD COLUMN IF NOT EXISTS entry_mode text;

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('admission_applications_cycle_fkey',
     'FOREIGN KEY (cycle_id, school_id) REFERENCES public.admission_cycles (id, org_id)'),
    ('admission_applications_programme_fkey',
     'FOREIGN KEY (programme_id, cycle_id, school_id) REFERENCES public.admission_programmes (id, cycle_id, org_id)'),
    ('admission_applications_form_fkey',
     'FOREIGN KEY (cycle_id, form_version, school_id) REFERENCES public.admission_forms (cycle_id, version, org_id)'),
    ('admission_applications_link_check',
     'CHECK ((programme_id IS NULL AND form_version IS NULL) OR cycle_id IS NOT NULL)'),
    ('admission_applications_jamb_reg_no_check',
     'CHECK (jamb_reg_no IS NULL OR jamb_reg_no ~ ''^[0-9]{8,12}[A-Z]{2}$'')'),
    ('admission_applications_utme_score_check',
     'CHECK (utme_score IS NULL OR utme_score BETWEEN 0 AND 400)'),
    ('admission_applications_caps_status_check',
     'CHECK (caps_status IS NULL OR caps_status IN (''not_started'', ''in_progress'', ''admitted'', ''accepted'', ''rejected'', ''not_admitted''))'),
    ('admission_applications_entry_mode_check',
     'CHECK (entry_mode IS NULL OR entry_mode IN (''utme'', ''direct_entry'', ''transfer'', ''pre_degree'', ''remedial'', ''other''))')
  ) AS t(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.admission_applications'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE public.admission_applications ADD CONSTRAINT %I %s', c.name, c.def);
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS admission_applications_cycle_idx ON public.admission_applications (cycle_id) WHERE cycle_id IS NOT NULL;

-- The new columns are staff-owned. anon, and any signed-in caller without
-- admissions.process in that organization, cannot set or change them. The function
-- is SECURITY INVOKER on purpose: current_user is the calling API role, so the
-- anonymous path is checked without granting anon anything new. Owner-run code
-- (the existing SECURITY DEFINER admission functions, service_role) is unaffected.
CREATE OR REPLACE FUNCTION public.admission_applications_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE touched boolean;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    touched := NEW.cycle_id IS NOT NULL OR NEW.programme_id IS NOT NULL OR NEW.form_version IS NOT NULL
      OR NEW.jamb_reg_no IS NOT NULL OR NEW.utme_score IS NOT NULL OR NEW.caps_status IS NOT NULL
      OR NEW.entry_mode IS NOT NULL;
  ELSE
    touched := NEW.cycle_id IS DISTINCT FROM OLD.cycle_id OR NEW.programme_id IS DISTINCT FROM OLD.programme_id
      OR NEW.form_version IS DISTINCT FROM OLD.form_version OR NEW.jamb_reg_no IS DISTINCT FROM OLD.jamb_reg_no
      OR NEW.utme_score IS DISTINCT FROM OLD.utme_score OR NEW.caps_status IS DISTINCT FROM OLD.caps_status
      OR NEW.entry_mode IS DISTINCT FROM OLD.entry_mode;
  END IF;
  IF NOT touched THEN RETURN NEW; END IF;
  IF current_user = 'authenticated' AND NEW.school_id = public.get_my_school_id()
     AND public.scholar_can(NEW.school_id, 'admissions.process') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'admission link and tertiary fields are set by admissions staff or the server only'
    USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.admission_applications_link_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_admission_applications_link_guard ON public.admission_applications;
CREATE TRIGGER trg_admission_applications_link_guard
  BEFORE INSERT OR UPDATE ON public.admission_applications
  FOR EACH ROW EXECUTE FUNCTION public.admission_applications_link_guard();

-- Tertiary fields are sensitive: signed-in callers lose column SELECT on them and read
-- them only through admission_application_tertiary() (admissions.view, own organization).
-- Every other column keeps the SELECT authenticated holds today (rows are still limited by
-- the unchanged "school admins read applications" policy). Callers must name columns;
-- "SELECT *" as authenticated is refused after this migration.
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
    FROM pg_attribute
   WHERE attrelid = 'public.admission_applications'::regclass AND attnum > 0 AND NOT attisdropped
     AND attname NOT IN ('jamb_reg_no', 'utme_score', 'caps_status', 'entry_mode');
  REVOKE SELECT ON TABLE public.admission_applications FROM authenticated;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.admission_applications TO authenticated', cols);
END $$;

-- ---------------------------------------------------------------------------
-- 10. Rule triggers.
-- ---------------------------------------------------------------------------

-- 10a. A cycle never returns to draft once it has left it (forms rely on this).
CREATE OR REPLACE FUNCTION public.admission_cycles_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'an admission cycle cannot return to draft' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
    RAISE EXCEPTION 'an archived admission cycle is final' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admission_cycles_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_admission_cycles_guard ON public.admission_cycles;
CREATE TRIGGER trg_admission_cycles_guard BEFORE UPDATE ON public.admission_cycles
  FOR EACH ROW EXECUTE FUNCTION public.admission_cycles_guard();

-- 10b. Forms: a published version is immutable (no UPDATE, for every role); nothing about
--      a cycle's forms changes once that cycle has left draft (no edit, no publish, no new
--      version). No client role holds DELETE on forms; the server may delete, which keeps
--      organization deletion (ON DELETE CASCADE) working.
CREATE OR REPLACE FUNCTION public.admission_forms_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE st text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' THEN
    RAISE EXCEPTION 'a published admission form version is immutable; create a new version' USING ERRCODE = '23514';
  END IF;
  SELECT c.status INTO st FROM public.admission_cycles c WHERE c.id = NEW.cycle_id;
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'admission forms cannot change once their cycle is %', st USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.cycle_id <> NEW.cycle_id THEN
    SELECT c.status INTO st FROM public.admission_cycles c WHERE c.id = OLD.cycle_id;
    IF st IS NOT NULL AND st <> 'draft' THEN
      RAISE EXCEPTION 'admission forms cannot change once their cycle is %', st USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN NEW.published_at := now(); END IF;
  IF NEW.status = 'draft' THEN NEW.published_at := NULL; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admission_forms_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_admission_forms_guard ON public.admission_forms;
CREATE TRIGGER trg_admission_forms_guard BEFORE INSERT OR UPDATE ON public.admission_forms
  FOR EACH ROW EXECUTE FUNCTION public.admission_forms_guard();

-- 10c. Screenings: every interviewer is a member of the same organization.
CREATE OR REPLACE FUNCTION public.admission_screenings_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE x uuid;
BEGIN
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN NEW.created_by := auth.uid(); END IF;
  IF TG_OP = 'UPDATE' THEN NEW.created_by := OLD.created_by; END IF;
  FOREACH x IN ARRAY coalesce(NEW.interviewer_ids, '{}'::uuid[]) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = x AND u.is_active IS TRUE AND u.school_id = NEW.org_id)
       AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m
                        WHERE m.user_id = x AND m.school_id = NEW.org_id AND m.is_active IS TRUE) THEN
      RAISE EXCEPTION 'interviewer % is not an active member of this organization', x USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admission_screenings_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_admission_screenings_guard ON public.admission_screenings;
CREATE TRIGGER trg_admission_screenings_guard BEFORE INSERT OR UPDATE ON public.admission_screenings
  FOR EACH ROW EXECUTE FUNCTION public.admission_screenings_guard();

-- 10d. Scores: the scorer is the caller (never a client-supplied id), a correction keeps
--      the criterion of the row it corrects, and rows are append-only.
CREATE OR REPLACE FUNCTION public.admission_scores_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE prev public.admission_scores;
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.scorer_id := auth.uid(); END IF;
  NEW.scored_at := now();
  IF NEW.corrects_score_id IS NOT NULL THEN
    SELECT * INTO prev FROM public.admission_scores WHERE id = NEW.corrects_score_id;
    IF prev.criterion IS DISTINCT FROM NEW.criterion THEN
      RAISE EXCEPTION 'a correction must keep the criterion of the score it corrects' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admission_scores_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_admission_scores_guard ON public.admission_scores;
CREATE TRIGGER trg_admission_scores_guard BEFORE INSERT ON public.admission_scores
  FOR EACH ROW EXECUTE FUNCTION public.admission_scores_guard();
DROP TRIGGER IF EXISTS trg_admission_scores_append_only ON public.admission_scores;
CREATE TRIGGER trg_admission_scores_append_only BEFORE UPDATE OR DELETE ON public.admission_scores
  FOR EACH ROW EXECUTE FUNCTION public.append_only_guard();

-- 10e. Offers: lifecycle, four eyes, score/approve separation, expiry.
CREATE OR REPLACE FUNCTION public.admission_offers_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me uuid := auth.uid();
  separation boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'an offer starts as a draft' USING ERRCODE = '23514';
    END IF;
    IF me IS NOT NULL THEN NEW.drafted_by := me; END IF;
    NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.issued_by := NULL; NEW.issued_at := NULL;
    NEW.responded_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE: identity and decision fields are never taken from the client.
  NEW.drafted_by := OLD.drafted_by;
  NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at;
  NEW.issued_by := OLD.issued_by; NEW.issued_at := OLD.issued_at;
  NEW.responded_at := OLD.responded_at;
  NEW.created_at := OLD.created_at;

  -- Content may change only while the offer is a draft.
  IF OLD.status <> 'draft' AND (
       NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.application_id IS DISTINCT FROM OLD.application_id
    OR NEW.programme_id IS DISTINCT FROM OLD.programme_id OR NEW.conditions IS DISTINCT FROM OLD.conditions
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.acceptance_fee_minor IS DISTINCT FROM OLD.acceptance_fee_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
    RAISE EXCEPTION 'offer terms are fixed once the offer leaves draft' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NOT (
       (OLD.status = 'draft' AND NEW.status IN ('pending_approval', 'withdrawn'))
    OR (OLD.status = 'pending_approval' AND NEW.status IN ('draft', 'issued', 'withdrawn'))
    OR (OLD.status = 'issued' AND NEW.status IN ('accepted', 'declined', 'expired', 'withdrawn'))) THEN
    RAISE EXCEPTION 'an offer cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'issued' THEN
    IF me IS NULL THEN
      RAISE EXCEPTION 'an offer is issued by a named approver, not by the server' USING ERRCODE = '42501';
    END IF;
    IF me = OLD.drafted_by THEN
      RAISE EXCEPTION 'the person who drafted an offer cannot approve it' USING ERRCODE = '42501';
    END IF;
    SELECT s.score_offer_separation INTO separation FROM public.admission_settings s WHERE s.org_id = OLD.org_id;
    IF coalesce(separation, true) AND EXISTS (
         SELECT 1 FROM public.admission_scores sc
          WHERE sc.application_id = OLD.application_id AND sc.org_id = OLD.org_id AND sc.scorer_id = me) THEN
      RAISE EXCEPTION 'a person who scored this application cannot approve its offer' USING ERRCODE = '42501';
    END IF;
    IF OLD.expires_at IS NOT NULL AND OLD.expires_at <= now() THEN
      RAISE EXCEPTION 'an offer cannot be issued after its expiry' USING ERRCODE = '23514';
    END IF;
    NEW.approved_by := me; NEW.approved_at := now();
    NEW.issued_by := me; NEW.issued_at := now();
  END IF;

  IF NEW.status = 'accepted' AND OLD.expires_at IS NOT NULL AND OLD.expires_at <= now() THEN
    RAISE EXCEPTION 'this offer has expired and cannot be accepted' USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('accepted', 'declined') THEN NEW.responded_at := now(); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admission_offers_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_admission_offers_guard ON public.admission_offers;
CREATE TRIGGER trg_admission_offers_guard BEFORE INSERT OR UPDATE ON public.admission_offers
  FOR EACH ROW EXECUTE FUNCTION public.admission_offers_guard();

-- 10f. Owner and creator columns come from the caller, not the client. TG_ARGV[0] names
--      the column; TG_ARGV[1] = 'every_write' records the latest writer instead of the first.
CREATE OR REPLACE FUNCTION public.admission_set_actor() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE col text := TG_ARGV[0]; every_write boolean := coalesce(TG_ARGV[1], '') = 'every_write';
BEGIN
  IF TG_OP = 'INSERT' OR every_write THEN
    IF auth.uid() IS NOT NULL THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(col, auth.uid()));
    END IF;
  ELSE
    NEW := jsonb_populate_record(NEW, jsonb_build_object(col, to_jsonb(OLD) -> col));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.admission_set_actor() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_admission_cycles_actor ON public.admission_cycles;
CREATE TRIGGER trg_admission_cycles_actor BEFORE INSERT OR UPDATE ON public.admission_cycles
  FOR EACH ROW EXECUTE FUNCTION public.admission_set_actor('created_by');
DROP TRIGGER IF EXISTS trg_admission_forms_actor ON public.admission_forms;
CREATE TRIGGER trg_admission_forms_actor BEFORE INSERT OR UPDATE ON public.admission_forms
  FOR EACH ROW EXECUTE FUNCTION public.admission_set_actor('created_by');
DROP TRIGGER IF EXISTS trg_admission_question_bank_actor ON public.admission_question_bank;
CREATE TRIGGER trg_admission_question_bank_actor BEFORE INSERT OR UPDATE ON public.admission_question_bank
  FOR EACH ROW EXECUTE FUNCTION public.admission_set_actor('owner_id');
DROP TRIGGER IF EXISTS trg_admission_settings_actor ON public.admission_settings;
CREATE TRIGGER trg_admission_settings_actor BEFORE INSERT OR UPDATE ON public.admission_settings
  FOR EACH ROW EXECUTE FUNCTION public.admission_set_actor('updated_by', 'every_write');

-- ---------------------------------------------------------------------------
-- 11. Row-level security, grants, policies, audit and updated_at.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admission_settings', 'admission_cycles', 'admission_programmes', 'admission_forms',
                           'admission_question_bank', 'admission_screenings', 'admission_scores',
                           'admission_offers', 'admission_documents'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I '
                   'FOR EACH ROW EXECUTE FUNCTION public.scholar_audit()', t);
    IF t <> 'admission_scores' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_touch ON public.%1$I', t);
      EXECUTE format('CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON public.%1$I '
                     'FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.admission_settings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admission_cycles FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admission_programmes FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admission_forms FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admission_question_bank FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admission_screenings FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admission_scores FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admission_offers FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admission_documents FROM PUBLIC, anon, authenticated, service_role;

-- Signed-in staff (rows limited by the policies below). No DELETE anywhere.
GRANT SELECT ON TABLE public.admission_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admission_cycles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admission_programmes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admission_forms TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admission_question_bank TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admission_screenings TO authenticated;
GRANT SELECT, INSERT ON TABLE public.admission_scores TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.admission_offers TO authenticated;
GRANT SELECT ON TABLE public.admission_documents TO authenticated;
-- Server (service_role): writes settings (role pack installer), documents (upload and
-- scanner) and later the applicant portal. Scores stay append-only for it too.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admission_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admission_cycles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admission_programmes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admission_forms TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admission_question_bank TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admission_screenings TO service_role;
GRANT SELECT, INSERT ON TABLE public.admission_scores TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admission_offers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admission_documents TO service_role;

-- Policies. Pattern: own organization AND the named permission.
DROP POLICY IF EXISTS admission_settings_read ON public.admission_settings;
CREATE POLICY admission_settings_read ON public.admission_settings FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
         AND (public.scholar_can(org_id, 'admissions.view') OR public.scholar_can(org_id, 'admissions.configure')));
DROP POLICY IF EXISTS admission_settings_server ON public.admission_settings;
CREATE POLICY admission_settings_server ON public.admission_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admission_cycles_read ON public.admission_cycles;
CREATE POLICY admission_cycles_read ON public.admission_cycles FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
         AND (public.scholar_can(org_id, 'admissions.view') OR public.scholar_can(org_id, 'admissions.configure')));
DROP POLICY IF EXISTS admission_cycles_insert ON public.admission_cycles;
CREATE POLICY admission_cycles_insert ON public.admission_cycles FOR INSERT TO authenticated
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'));
DROP POLICY IF EXISTS admission_cycles_update ON public.admission_cycles;
CREATE POLICY admission_cycles_update ON public.admission_cycles FOR UPDATE TO authenticated
  USING (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'))
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'));
DROP POLICY IF EXISTS admission_cycles_server ON public.admission_cycles;
CREATE POLICY admission_cycles_server ON public.admission_cycles FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admission_programmes_read ON public.admission_programmes;
CREATE POLICY admission_programmes_read ON public.admission_programmes FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
         AND (public.scholar_can(org_id, 'admissions.view') OR public.scholar_can(org_id, 'admissions.configure')
              OR public.scholar_can(org_id, 'admissions.score')));
DROP POLICY IF EXISTS admission_programmes_insert ON public.admission_programmes;
CREATE POLICY admission_programmes_insert ON public.admission_programmes FOR INSERT TO authenticated
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'));
DROP POLICY IF EXISTS admission_programmes_update ON public.admission_programmes;
CREATE POLICY admission_programmes_update ON public.admission_programmes FOR UPDATE TO authenticated
  USING (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'))
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'));
DROP POLICY IF EXISTS admission_programmes_server ON public.admission_programmes;
CREATE POLICY admission_programmes_server ON public.admission_programmes FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admission_forms_read ON public.admission_forms;
CREATE POLICY admission_forms_read ON public.admission_forms FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
         AND (public.scholar_can(org_id, 'admissions.view') OR public.scholar_can(org_id, 'admissions.configure')));
DROP POLICY IF EXISTS admission_forms_insert ON public.admission_forms;
CREATE POLICY admission_forms_insert ON public.admission_forms FOR INSERT TO authenticated
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'));
DROP POLICY IF EXISTS admission_forms_update ON public.admission_forms;
CREATE POLICY admission_forms_update ON public.admission_forms FOR UPDATE TO authenticated
  USING (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'))
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'));
DROP POLICY IF EXISTS admission_forms_server ON public.admission_forms;
CREATE POLICY admission_forms_server ON public.admission_forms FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admission_question_bank_read ON public.admission_question_bank;
CREATE POLICY admission_question_bank_read ON public.admission_question_bank FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
         AND (public.scholar_can(org_id, 'admissions.configure') OR public.scholar_can(org_id, 'admissions.screen')
              OR public.scholar_can(org_id, 'admissions.score')));
DROP POLICY IF EXISTS admission_question_bank_insert ON public.admission_question_bank;
CREATE POLICY admission_question_bank_insert ON public.admission_question_bank FOR INSERT TO authenticated
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'));
DROP POLICY IF EXISTS admission_question_bank_update ON public.admission_question_bank;
CREATE POLICY admission_question_bank_update ON public.admission_question_bank FOR UPDATE TO authenticated
  USING (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'))
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.configure'));
DROP POLICY IF EXISTS admission_question_bank_server ON public.admission_question_bank;
CREATE POLICY admission_question_bank_server ON public.admission_question_bank FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admission_screenings_read ON public.admission_screenings;
CREATE POLICY admission_screenings_read ON public.admission_screenings FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
         AND (public.scholar_can(org_id, 'admissions.view') OR public.scholar_can(org_id, 'admissions.screen')
              OR public.scholar_can(org_id, 'admissions.score')));
DROP POLICY IF EXISTS admission_screenings_insert ON public.admission_screenings;
CREATE POLICY admission_screenings_insert ON public.admission_screenings FOR INSERT TO authenticated
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.screen'));
DROP POLICY IF EXISTS admission_screenings_update ON public.admission_screenings;
CREATE POLICY admission_screenings_update ON public.admission_screenings FOR UPDATE TO authenticated
  USING (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.screen'))
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.screen'));
DROP POLICY IF EXISTS admission_screenings_server ON public.admission_screenings;
CREATE POLICY admission_screenings_server ON public.admission_screenings FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admission_scores_read ON public.admission_scores;
CREATE POLICY admission_scores_read ON public.admission_scores FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
         AND (public.scholar_can(org_id, 'admissions.view') OR public.scholar_can(org_id, 'admissions.score')));
DROP POLICY IF EXISTS admission_scores_insert ON public.admission_scores;
CREATE POLICY admission_scores_insert ON public.admission_scores FOR INSERT TO authenticated
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.score'));
DROP POLICY IF EXISTS admission_scores_server ON public.admission_scores;
CREATE POLICY admission_scores_server ON public.admission_scores FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admission_offers_read ON public.admission_offers;
CREATE POLICY admission_offers_read ON public.admission_offers FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id()
         AND (public.scholar_can(org_id, 'admissions.view') OR public.scholar_can(org_id, 'admissions.offer')));
DROP POLICY IF EXISTS admission_offers_insert ON public.admission_offers;
CREATE POLICY admission_offers_insert ON public.admission_offers FOR INSERT TO authenticated
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.offer'));
DROP POLICY IF EXISTS admission_offers_update ON public.admission_offers;
CREATE POLICY admission_offers_update ON public.admission_offers FOR UPDATE TO authenticated
  USING (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.offer'))
  WITH CHECK (org_id = public.get_my_school_id() AND public.scholar_can(org_id, 'admissions.offer'));
DROP POLICY IF EXISTS admission_offers_server ON public.admission_offers;
CREATE POLICY admission_offers_server ON public.admission_offers FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Staff see a document only after the scan marked it clean.
DROP POLICY IF EXISTS admission_documents_read ON public.admission_documents;
CREATE POLICY admission_documents_read ON public.admission_documents FOR SELECT TO authenticated
  USING (org_id = public.get_my_school_id() AND scan_status = 'clean'
         AND public.scholar_can(org_id, 'admissions.view'));
DROP POLICY IF EXISTS admission_documents_server ON public.admission_documents;
CREATE POLICY admission_documents_server ON public.admission_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 12. Read surfaces (organization derived from the caller; no amounts, no org ids in).
-- ---------------------------------------------------------------------------

-- 12a. Blind scoring surface: the application WITHOUT protected attributes. This is an
--      allowlist: names, sex, date of birth, religion, nationality, blood group, genotype,
--      address, disability, medical and allergy fields, parent and guardian details and
--      occupations, previous institution, discipline history, AI review fields and the
--      tertiary fields are never returned.
CREATE OR REPLACE FUNCTION public.admission_blind_applications(p_cycle_id uuid DEFAULT NULL)
RETURNS TABLE (
  application_id uuid,
  application_number text,
  cycle_id uuid,
  programme_id uuid,
  form_version integer,
  applying_for_class text,
  academic_year_applying text,
  stage text,
  submitted_at timestamptz,
  previous_class_completed text,
  year_completed text,
  academic_achievements text,
  entrance_exam_score numeric,
  interview_responses jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid := public.get_my_school_id();
BEGIN
  IF org IS NULL OR NOT public.scholar_can(org, 'admissions.score') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT a.id, a.application_number, a.cycle_id, a.programme_id, a.form_version, a.applying_for_class,
           a.academic_year_applying, a.stage, a.submitted_at, a.previous_class_completed, a.year_completed,
           a.academic_achievements, a.entrance_exam_score, a.interview_responses
      FROM public.admission_applications a
     WHERE a.school_id = org AND (p_cycle_id IS NULL OR a.cycle_id = p_cycle_id)
     ORDER BY a.submitted_at, a.id;
END $$;
REVOKE ALL ON FUNCTION public.admission_blind_applications(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admission_blind_applications(uuid) TO authenticated;

-- 12b. Tertiary fields: admissions.view in the caller's own organization only.
CREATE OR REPLACE FUNCTION public.admission_application_tertiary(p_application_id uuid)
RETURNS TABLE (application_id uuid, jamb_reg_no text, utme_score smallint, caps_status text, entry_mode text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid := public.get_my_school_id();
BEGIN
  IF org IS NULL OR NOT public.scholar_can(org, 'admissions.view') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT a.id, a.jamb_reg_no, a.utme_score, a.caps_status, a.entry_mode
      FROM public.admission_applications a
     WHERE a.id = p_application_id AND a.school_id = org;
END $$;
REVOKE ALL ON FUNCTION public.admission_application_tertiary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admission_application_tertiary(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 13. Private bucket for admission documents. Objects are written by the server only;
--     staff may download an object only when its admission_documents row is clean.
-- ---------------------------------------------------------------------------
DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'M11a: storage schema absent, bucket and storage policy skipped';
    RETURN;
  END IF;
  EXECUTE $b$
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('admission-documents', 'admission-documents', false, 10485760,
            ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
    ON CONFLICT (id) DO UPDATE SET public = false
  $b$;
  EXECUTE 'DROP POLICY IF EXISTS "admission documents clean read" ON storage.objects';
  EXECUTE $p$
    CREATE POLICY "admission documents clean read" ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'admission-documents'
        AND EXISTS (
          SELECT 1 FROM public.admission_documents d
           WHERE d.storage_path = objects.name
             AND d.scan_status = 'clean'
             AND d.org_id = public.get_my_school_id()
             AND public.scholar_can(d.org_id, 'admissions.view')))
  $p$;
END
$storage$;
