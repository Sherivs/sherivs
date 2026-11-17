-- Rollback for M5 part B (20261117001300, ADR-108). Removes the pre-tenant intake tables and functions.
-- This deletes every onboarding request and interview session. Export public.onboarding_requests
-- first if any request is still being handled: it holds the consent record for each contact.
-- The audit_logs rows the tables wrote stay (audit_logs is append-only).
DROP FUNCTION IF EXISTS public.onboarding_intake_purge_expired();
DROP FUNCTION IF EXISTS public.onboarding_intake_complete(text, integer);
DROP FUNCTION IF EXISTS public.onboarding_intake_save(text, integer, jsonb, integer);
DROP FUNCTION IF EXISTS public.onboarding_intake_load(text);
DROP FUNCTION IF EXISTS public.onboarding_intake_create(text, text, text, text, text, text, text, text, text, text, text, text, text);
DROP TABLE IF EXISTS public.reality_interview_sessions;
DROP TABLE IF EXISTS public.onboarding_requests;
DROP FUNCTION IF EXISTS public.onboarding_intake_audit();
