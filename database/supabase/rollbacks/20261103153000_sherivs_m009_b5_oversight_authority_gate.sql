-- Rollback for M009 Stage B-5. Restores the flag on the two oversight templates to
-- its pre-B-5 value (false; no oversight role was flagged before this migration).
UPDATE public.role_catalog
   SET requires_verified_authority_link = false
 WHERE org_id IS NULL
   AND template_code IN ('regulator', 'regulator_inspector');
