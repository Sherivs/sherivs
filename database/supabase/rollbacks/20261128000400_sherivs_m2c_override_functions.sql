-- Rollback for M2c: removes the four client functions. Overrides already created stay; they are history.
DROP FUNCTION IF EXISTS public.role_override_create(text, text, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.role_override_approve(uuid);
DROP FUNCTION IF EXISTS public.role_override_end(uuid);
DROP FUNCTION IF EXISTS public.role_override_epoch();
