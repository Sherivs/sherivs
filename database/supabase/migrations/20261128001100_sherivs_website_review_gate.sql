-- WEB-REVIEW: a site with generated standard texts that nobody has read cannot be published.
-- Creator: Claude Code agent, mission WEB-REVIEW (provenance id W-030); AI-generated.
-- The website generator can emit standard texts (school rules, policies, privacy and safeguarding notices). They are
-- boilerplate, not the school's answers, so they are marked review = 'pending' in the document and the school must
-- accept or remove each one. This replaces website_publish with the same signature and grants, adding one refusal:
-- if the draft still holds a block with review = 'pending', publishing fails with a message that says how many.
-- Drafts can still be saved with pending blocks. Existing documents have no review key and are unaffected.
-- Not applied anywhere. Rollback restores the previous body.
BEGIN;

CREATE OR REPLACE FUNCTION public.website_publish(p_school uuid, p_note text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w record; v_next int; v_pending int;
BEGIN
  PERFORM public._website_guard(p_school);
  SELECT * INTO w FROM public.websites WHERE school_id = p_school FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'website: nothing to publish yet' USING ERRCODE = '22023'; END IF;
  PERFORM public._website_validate(w.draft);
  SELECT count(*) INTO v_pending FROM jsonb_path_query(w.draft, '$.pages[*].sections[*].blocks[*] ? (@.review == "pending")');
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'website: % generated text(s) still need your review before publishing', v_pending USING ERRCODE = '22023';
  END IF;
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
