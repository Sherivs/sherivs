-- Rollback for M3 (20261117001200): puts back every route the migration moved to the shell, from
-- legacy_route, then drops legacy_route. Rows the migration did not move (legacy_route NULL) are
-- left as they are. No grant or policy is touched.

UPDATE public.workspace_item_catalog c
   SET route = c.legacy_route
 WHERE c.legacy_route IS NOT NULL;

ALTER TABLE public.workspace_item_catalog DROP COLUMN IF EXISTS legacy_route;
