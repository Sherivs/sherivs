-- Rollback of 20261110000200_sherivs_engine02_conductor_observation_view.sql
-- Exact inverse: the migration creates one view, its comment and its grants; dropping the
-- view removes all three. The base table cg_hermes_observation is untouched.
-- Plan: (1) stop callers that read cg_conductor_observation, (2) run in one transaction,
-- (3) verify to_regclass('public.cg_conductor_observation') IS NULL.
DROP VIEW IF EXISTS public.cg_conductor_observation;
