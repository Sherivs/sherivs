-- Rollback SHERIVS-B05: drops staffing, postings, exports.
BEGIN;
DROP FUNCTION IF EXISTS public.gov_export(uuid, text);
DROP FUNCTION IF EXISTS public._gov_csv(text);
DROP FUNCTION IF EXISTS public.school_posting_ack(uuid);
DROP FUNCTION IF EXISTS public.school_postings_mine();
DROP FUNCTION IF EXISTS public.gov_postings_list(uuid);
DROP FUNCTION IF EXISTS public.gov_posting_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.gov_posting_decide(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.gov_posting_propose(uuid, text, text, uuid, uuid, date, text, text);
DROP FUNCTION IF EXISTS public._gov_public_sharing(uuid, uuid);
DROP TABLE IF EXISTS public.gov_teacher_postings;
DROP FUNCTION IF EXISTS public.gov_staffing(uuid, int);
COMMIT;
