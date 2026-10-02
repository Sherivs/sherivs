-- =============================================================================
-- Rollback: 20261002000007_coregrid_v1_event_routing.sql (MISSION-R-63)
-- Status: AUTHORED, NOT APPLIED.
-- WARNING: destructive — removes the governed routing substrate. After
-- rollback, subscription declarations, undelivered gated queues, delivery
-- frontiers and the routing outcome audit are unrecoverable: the no-silent-
-- drop evidence trail (Constitution §35) is destroyed and in-flight
-- subscriptions revert to router-memory only. For retiring the schema, not
-- for draining individual queues (matches the memory-tier rollback
-- style).
--
-- Rollback order matters: queue and cursor rows reference subscriptions
-- (composite-FK CASCADE), so both are dropped BEFORE the subscription table.
-- The outcome audit is deliberately FK-free (it survives unsubscribe) and is
-- dropped first as an independent table. Nothing else in the substrate
-- references these tables; no RPC bodies need restoring (the migration is
-- table-authoring only, redefinition-free).
-- =============================================================================

DROP TABLE IF EXISTS public.cg_event_route_outcome;
DROP TABLE IF EXISTS public.cg_event_route_cursor;
DROP TABLE IF EXISTS public.cg_event_route_queue;
DROP TABLE IF EXISTS public.cg_event_route_subscription;