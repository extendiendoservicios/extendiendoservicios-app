-- pgTAP de la migración 0049_p21_6c_revokes.sql (P21.6c): ninguna función de `public` es ejecutable por
-- `anon` ni por PUBLIC, y las dos funciones de la Edge Function quedan solo para `service_role`.
--
-- Convención (supabase/tests/README.md): una sola transacción que termina en `rollback`.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- Excepciones: funciones de `public` que anon podría ejecutar. Hoy no hay ninguna (la vista pública
-- v_public_branding es una vista, no una función). Si algún día hace falta una, se agrega acá con su motivo.
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('anon', p.oid, 'execute')),
  '',
  'anon no puede ejecutar ninguna función de public'
);

select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.grantee = 0 and a.privilege_type = 'EXECUTE')),
  0,
  'PUBLIC no tiene execute sobre ninguna función de public'
);

select ok(
  not has_schema_privilege('anon', 'app', 'usage'),
  'anon no tiene usage sobre el esquema app (sus funciones no son alcanzables)'
);

select ok(
  not has_function_privilege('anon', 'public.admin_find_orphan_account(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_find_orphan_account(text)', 'execute'),
  'admin_find_orphan_account: ni anon ni authenticated'
);
select ok(
  has_function_privilege('service_role', 'public.admin_find_orphan_account(text)', 'execute'),
  'admin_find_orphan_account: service_role conserva execute'
);

select ok(
  not has_function_privilege('anon', 'public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)', 'execute'),
  'admin_create_user_records: ni anon ni authenticated'
);
select ok(
  has_function_privilege('service_role', 'public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)', 'execute'),
  'admin_create_user_records: service_role conserva execute'
);

-- Control de que la comprobación de anon es real: una función de authenticated sigue ejecutable por él.
select ok(
  has_function_privilege('authenticated', 'public.admin_record_attendance(uuid, public.attendance_kind, timestamptz, text)', 'execute'),
  'control: authenticated conserva execute en admin_record_attendance'
);

select * from finish();

rollback;
