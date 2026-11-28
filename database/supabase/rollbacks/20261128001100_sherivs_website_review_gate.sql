-- Rollback WEB-REVIEW: restore website_publish without the pending-review refusal. Sites already published are unchanged.
BEGIN;
CREATE OR REPLACE FUNCTION public.website_publish(p_school uuid, p_note text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w record; v_next int;
BEGIN
  PERFORM public._website_guard(p_school);
  SELECT * INTO w FROM public.websites WHERE school_id = p_school FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'website: nothing to publish yet' USING ERRCODE = '22023'; END IF;
  PERFORM public._website_validate(w.draft);
  IF (SELECT count(*) FROM public.website_versions WHERE school_id = p_school AND created_at > now() - interval '1 hour') >= 60 THEN
    RAISE EXCEPTION 'website: publish limit reached (60 per hour)' USING ERRCODE = '54000'; END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM public.website_versions WHERE school_id = p_school;
  INSERT INTO public.website_versions (school_id, version, document, source, note, created_by)
  VALUES (p_school, v_next, w.draft, 'publish', left(p_note, 300), auth.uid());
  UPDATE public.websites SET published_version = v_next, updated_at = now() WHERE school_id = p_school;
  INSERT INTO public.website_audit (school_id, actor, action, detail) VALUES (p_school, auth.uid(), 'publish', jsonb_build_object('version', v_next));
  RETURN v_next;
END $$;
COMMIT;
