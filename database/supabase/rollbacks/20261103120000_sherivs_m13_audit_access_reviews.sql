-- Rollback for 20261103120000_sherivs_m13_audit_access_reviews.sql.
-- Immutable review audit events are retained; rollback removes only the workflow.
BEGIN;

REVOKE ALL ON FUNCTION public.workspace_access_review_campaign_create(uuid,text,timestamptz),
  public.workspace_access_review_decide(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.workspace_access_review_campaign_create(uuid,text,timestamptz);
DROP FUNCTION IF EXISTS public.workspace_access_review_decide(uuid,text);

DROP POLICY IF EXISTS role_access_review_campaigns_read ON public.role_access_review_campaigns;
DROP POLICY IF EXISTS role_access_review_items_read ON public.role_access_review_items;

DROP TABLE IF EXISTS public.role_access_review_items;
DROP TABLE IF EXISTS public.role_access_review_campaigns;

COMMIT;
