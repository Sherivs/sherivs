-- Rollback for M1 (20261117000200). Export institution_profile first if it holds rows.
-- It refuses to narrow the unit types while a unit of a new type exists.
DO $m1_rb$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspace_org_units WHERE unit_type NOT IN
       ('institution', 'group', 'campus', 'shift', 'faculty', 'department', 'class', 'subject')) THEN
    RAISE EXCEPTION 'M1 rollback: units of a new type exist; remove or retype them first';
  END IF;
END
$m1_rb$;
DROP FUNCTION IF EXISTS public.organization_root_gaps();
DROP TABLE IF EXISTS public.institution_profile;
ALTER TABLE public.workspace_org_units DROP CONSTRAINT IF EXISTS workspace_org_units_not_own_parent;
ALTER TABLE public.workspace_org_units DROP CONSTRAINT IF EXISTS workspace_org_units_unit_type_check;
ALTER TABLE public.workspace_org_units ADD CONSTRAINT workspace_org_units_unit_type_check
  CHECK (unit_type = ANY (ARRAY['institution', 'group', 'campus', 'shift', 'faculty', 'department', 'class', 'subject']));
DROP FUNCTION IF EXISTS public.get_my_organization_id();
