-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- M3 (ADR-106): every workspace card opens inside the application shell.
-- Origin: Claude Code agent, mission E-008 (M3 card registry and honest routing).
-- public.workspace_item_catalog.route still holds the paths of the removed portal pages. This file
-- moves every row to its shell route (/home for nav.home, /home/s/<key> for every other key) and
-- keeps the previous value in a new nullable column legacy_route, so the rollback restores it
-- exactly. The client keeps deduplicating cards and matching notification links on the legacy
-- destination (frontend/src/lib/shell/chrome.ts, catalogueProvenance).
-- No table, function, grant or policy is created or changed: legacy_route is a column of an
-- existing table and inherits its column privileges (authenticated reads through the existing
-- SELECT policy; writes stay with the table owner and service_role as before).
-- Idempotent: a second run changes nothing. If a later re-seed puts a portal path back in route,
-- running this file again records that path as legacy_route and moves the row to the shell again.
-- Rollback: database/supabase/rollbacks/20261117001200_sherivs_m3_workspace_item_routes.sql

ALTER TABLE public.workspace_item_catalog ADD COLUMN IF NOT EXISTS legacy_route text;

COMMENT ON COLUMN public.workspace_item_catalog.legacy_route IS
  'Route held before M3 (20261117001200) moved the row to the application shell; used by the rollback.';

UPDATE public.workspace_item_catalog c
   SET legacy_route = c.route,
       route = CASE WHEN c.key = 'nav.home' THEN '/home' ELSE '/home/s/' || c.key END
 WHERE c.route IS DISTINCT FROM (CASE WHEN c.key = 'nav.home' THEN '/home' ELSE '/home/s/' || c.key END);
