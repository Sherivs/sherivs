-- Track E (QA/Security): RLS + function-grant hardening. Local sim-lab verified; NOT applied to prod.
-- Findings: tools/sim-lab/results/security-audit-master.json (before) / security-audit-after-e.json (after).

-- 1) FORCE row level security on every public table, so a non-BYPASSRLS table owner is also policy-bound.
--    (Supabase `postgres`/`service_role` keep BYPASSRLS, so server-side jobs are unaffected.)
do $$
declare r record;
begin
  for r in select c.oid::regclass as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') and not c.relforcerowsecurity loop
    execute format('alter table %s enable row level security', r.t);
    execute format('alter table %s force row level security', r.t);
  end loop;
end $$;

-- 2) Trigger / event-trigger SECURITY DEFINER functions are never RPCs: drop EXECUTE from PUBLIC/anon/authenticated
--    so they disappear from the PostgREST surface (triggers still fire; the trigger mechanism does not check EXECUTE).
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype) loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.f);
  end loop;
end $$;

-- 3) Definer view over org_credentials: anon never needs it (the view self-filters to admins; belt and braces).
revoke all on public.org_credential_inventory from anon;
