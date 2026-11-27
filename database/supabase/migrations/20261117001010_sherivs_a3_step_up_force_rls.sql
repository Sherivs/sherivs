-- A3 follow-up: the sensitive step-up table had row security enabled but not forced. Force it so the table owner
-- is also bound by policy (the release gate's security audit requires this for every table). No data or grant change.
ALTER TABLE public.wf_sensitive_step_up FORCE ROW LEVEL SECURITY;
