REVOKE EXECUTE ON FUNCTION public.consent_set_for_actor(uuid,uuid,text,boolean,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consent_set_for_actor(uuid,uuid,text,boolean,uuid,text,text,text) TO service_role;
