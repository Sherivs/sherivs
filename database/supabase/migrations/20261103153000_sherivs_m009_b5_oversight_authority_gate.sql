-- M009 Stage B-5: oversight roles are authority-dependent.
-- Roles on the two oversight templates become effective only while their evidence
-- names exactly one verified, effective, same-tenant authority link (the gate added
-- by M009 B-1). Nothing is created, seeded or granted; this only narrows eligibility.
-- Forward-only; the matching rollback restores the previous flag values.
DO $guard$
BEGIN
  IF to_regclass('public.role_catalog') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'role_catalog'
          AND column_name = 'requires_verified_authority_link'
     ) THEN
    RAISE EXCEPTION 'M009 B-5 requires the B-1 authority gate (role_catalog.requires_verified_authority_link)';
  END IF;
END
$guard$;

UPDATE public.role_catalog
   SET requires_verified_authority_link = true
 WHERE org_id IS NULL
   AND template_code IN ('regulator', 'regulator_inspector');
