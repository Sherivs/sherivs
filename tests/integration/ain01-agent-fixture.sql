-- AIN-01 fixture helper, included with \ir by the WF-03..WF-12 harnesses that run steps under a made-up agent.
-- Since AIN-01 every agent step needs a registered identity. This registers one throwaway platform agent
-- (ceiling T3, a huge daily budget, no model use) and grants it to an organization, inside the harness
-- transaction, so those harnesses keep testing what they tested. It touches no autonomy: the harness still
-- writes its own wf_agent_autonomy rows. Nothing here runs against a hosted database.
CREATE FUNCTION pg_temp.ain01_fixture_agent(p_org uuid, p_agent text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope)
  VALUES (p_agent, 'department', 'agent') ON CONFLICT DO NOTHING;
  INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version,
      max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
  VALUES (p_agent, 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0',
      'T3', 'internal', 100000, 0, 0) ON CONFLICT DO NOTHING;
  INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES (p_org, p_agent) ON CONFLICT DO NOTHING;
END $$;
