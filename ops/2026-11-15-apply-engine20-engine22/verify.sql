-- Read-only. Expect: 17, 5, 13, no rows, no rows, 2.
select
 (select count(*) from public.org_agent_catalog) as catalog_rows,
 (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace
    and c.relname in ('org_agent_catalog','org_agent_addon_events','org_agent_events','org_notification_outbox','org_weekly_reports')
    and c.relrowsecurity and c.relforcerowsecurity) as forced_rls_tables,
 (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('org_tier_rank','org_agent_state','change_org_agent','raise_org_agent_event','ack_org_agent_event',
      'enqueue_org_notification','claim_org_notifications','complete_org_notification','request_org_weekly_reports',
      'store_org_weekly_report','org_append_only','org_agent_events_guard','org_agent_holders')
    and p.proconfig @> array['search_path=""']) as pinned_functions,
 (select string_agg(p.proname, ',') from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('raise_org_agent_event','enqueue_org_notification','claim_org_notifications','complete_org_notification',
      'request_org_weekly_reports','store_org_weekly_report','org_append_only','org_agent_events_guard','org_tier_rank')
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) as client_callable_internals,
 (select string_agg(p.proname, ',') from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('change_org_agent','ack_org_agent_event','org_agent_state','org_agent_holders')
    and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_callable,
 (select count(*) from supabase_migrations.schema_migrations
    where name in ('20261110000400_sherivs_engine20_org_agent_addons_events_reports','20261110000500_sherivs_engine22_org_agent_role_holders')) as ledger_rows;
