-- Read-only. Expect: 13 published packs (6 tenant_role, 7 platform_role), 1 staff row, 1 twin person,
-- 1 pending_pack platform context, 0 provision failures.
SELECT count(*) FILTER (WHERE status='published') AS published, count(*) FILTER (WHERE kind='tenant_role') AS tenant_role, count(*) FILTER (WHERE kind='platform_role') AS platform_role FROM public.cg_role_pack;
SELECT (SELECT count(*) FROM public.platform_staff) AS staff, (SELECT count(*) FROM public.cg_twin_person) AS twin_persons,
       (SELECT string_agg(status||':'||tenant_ref, ',') FROM public.cg_twin_context) AS contexts,
       (SELECT count(*) FROM public.audit_logs WHERE action='twin.provision.failed') AS provision_failures;
