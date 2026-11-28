-- M1c: the unit tree refuses cycles of any length and runaway depth.
-- M1 blocked only a unit being its own parent (workspace_org_units_not_own_parent). A longer loop
-- (A under B under C under A) passed every constraint. This trigger walks the ancestors of the new
-- parent and refuses the write if it meets the unit being written. Writes in one organization are
-- serialised by a transaction advisory lock so two concurrent re-parentings cannot jointly make a loop.
-- Existing rows are not rewritten; only inserts and parent changes are checked.
CREATE OR REPLACE FUNCTION public.workspace_org_units_cycle_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cur uuid;
  v_depth integer := 0;
  c_max_depth CONSTANT integer := 32;
BEGIN
  IF NEW.parent_unit_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_unit_id IS NOT DISTINCT FROM OLD.parent_unit_id THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('m1c:unit_tree:' || NEW.org_id::text, 7131));
  v_cur := NEW.parent_unit_id;
  WHILE v_cur IS NOT NULL LOOP
    IF v_cur = NEW.id THEN
      RAISE EXCEPTION 'm1:unit_cycle' USING ERRCODE = '23514';
    END IF;
    v_depth := v_depth + 1;
    IF v_depth > c_max_depth THEN
      RAISE EXCEPTION 'm1:unit_too_deep' USING ERRCODE = '23514';
    END IF;
    SELECT u.parent_unit_id INTO v_cur
      FROM public.workspace_org_units u WHERE u.id = v_cur AND u.org_id = NEW.org_id;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workspace_org_units_cycle_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspace_org_units_cycle_guard ON public.workspace_org_units;
CREATE TRIGGER trg_workspace_org_units_cycle_guard
  BEFORE INSERT OR UPDATE OF parent_unit_id ON public.workspace_org_units
  FOR EACH ROW EXECUTE FUNCTION public.workspace_org_units_cycle_guard();
