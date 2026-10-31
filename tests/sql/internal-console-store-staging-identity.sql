select
  current_database() as db,
  current_user as usr,
  exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'platform_staff'
  ) as has_platform_staff,
  to_regclass('public.platform_workspace') is not null as has_workspace;
