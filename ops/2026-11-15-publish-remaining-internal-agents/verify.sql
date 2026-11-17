-- Read-only. Expect: published 31, platform_packs 25, tenant_packs 6, packs_without_role 0, privileged_roles 1, not_shadow 0, failures 0.
SELECT (SELECT count(*) FROM public.cg_role_pack WHERE status='published') AS published,
       (SELECT count(*) FROM public.cg_role_pack WHERE kind='platform_role') AS platform_packs,
       (SELECT count(*) FROM public.cg_role_pack WHERE kind='tenant_role') AS tenant_packs,
       (SELECT count(*) FROM public.cg_role_pack p WHERE p.kind='platform_role' AND p.code <> 'jarvis-executive' AND NOT EXISTS (SELECT 1 FROM public.platform_roles r WHERE r.code = p.applies_to[1])) AS packs_without_role,
       (SELECT count(*) FROM public.platform_roles WHERE is_privileged) AS privileged_roles,
       (SELECT count(*) FROM public.cg_role_pack WHERE definition->>'startsInShadow' <> 'true') AS not_shadow,
       (SELECT count(*) FROM public.audit_logs WHERE action='twin.provision.failed') AS failures;
