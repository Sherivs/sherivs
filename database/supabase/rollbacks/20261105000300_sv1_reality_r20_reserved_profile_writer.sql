-- Rollback for SV1-REALITY R20 (20261105000300). It restores the generic write path for reality.* keys.
-- Running it re-opens the direct-write path that R20 closed (audit finding R-20); the server code
-- that calls upsert_reality_profile must be rolled back first or it will fail.
DROP TRIGGER IF EXISTS trg_cg_org_profile_reserved_guard ON public.cg_org_profile;
DROP FUNCTION IF EXISTS public.cg_org_profile_reserved_guard();
DROP FUNCTION IF EXISTS public.upsert_reality_profile(uuid, uuid, text, text, jsonb, integer);
