-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- CD-02 (ADR-132): ANY active legal hold on an organisation blocks every workflow purge for it.
-- WF-12 only looked at tenant and category holds; a subject or record hold did not stop a purge, and a
-- missing hold table was read as "no hold". Founder default, 26 Nov 2026: fail closed on both.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.wf_retention_legal_hold(uuid)') IS NULL THEN
    RAISE EXCEPTION 'CD-02: WF-12 must be applied first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.wf_retention_legal_hold(p_org uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_hold boolean;
BEGIN
  -- The hold register is part of the platform; if it cannot be read the answer is "unknown", and unknown blocks.
  IF to_regclass('public.retention_legal_holds') IS NULL THEN
    RETURN true;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.retention_legal_holds h WHERE h.org_id = $1 AND h.active)'
     INTO v_hold USING p_org;
  RETURN coalesce(v_hold, true);
END
$$;

COMMENT ON FUNCTION public.wf_retention_legal_hold(uuid) IS
  'CD-02 / ADR-132: true when the organisation has ANY active hold (tenant, category, subject or record) or the register is unreadable.';

COMMIT;
