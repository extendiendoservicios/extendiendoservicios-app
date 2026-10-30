-- pgTAP de la migración 0069_p25_1_enums.sql (P25.1, módulo E «Insumos y control de stock», 26 oct 2026).
--   Enumeraciones nuevas y valores agregados: admin_capability (manage_stock), stock_movement_kind,
--   stock_adjustment_reason, supply_shortage_status y los dos eventos de security_event_type.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'e2500000-...'. Los usuarios, turnos, clientes y artículos de la prueba los crea
-- este mismo archivo; no depende del seed ni del orden de ejecución. Los turnos usan fechas
-- relativas a app.today() (no hay instantes armados con «ahora ± horas» salvo donde el caso lo pide:
-- el control a una hora pasada, que se mide contra now() y no contra el reloj del día).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0069;
grant usage on schema tests_0069 to authenticated, anon;

create or replace function tests_0069.as_user(p_email text)
returns void
language plpgsql
as $$
declare
  v_user_id uuid;
  v_claims jsonb;
begin
  perform set_config('role', 'postgres', true);
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'tests_0069.as_user: no existe auth.users.email = %', p_email;
  end if;
  v_claims := (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', v_user_id::text,
        'claims', jsonb_build_object('sub', v_user_id::text, 'email', p_email, 'role', 'authenticated')
      )
    )
  ) -> 'claims';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', v_claims::text, true);
end;
$$;

grant execute on function tests_0069.as_user(text) to authenticated, anon;

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests_0069.err_hint(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlstate);
end;
$$;

grant execute on function tests_0069.err_hint(text) to authenticated, anon;

-- Devuelve el mensaje del error; null si anduvo.
create or replace function tests_0069.err_msg(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

grant execute on function tests_0069.err_msg(text) to authenticated, anon;

select plan(7);

set local role postgres;

select enum_has_labels(
  'public', 'admin_capability',
  array[
    'manage_users', 'cancel_shifts', 'edit_ratings', 'edit_checklists',
    'manage_attendance', 'generate_shifts', 'manage_supervisions', 'manage_stock'
  ],
  'admin_capability tiene los valores exactos y en orden (manage_stock agregado en 0069, P25.1)'
);

select enum_has_labels(
  'public', 'stock_movement_kind',
  array['entry', 'return', 'withdrawal', 'adjustment', 'count', 'reversal'],
  'stock_movement_kind tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'stock_adjustment_reason',
  array['count', 'breakage', 'expired', 'data_error', 'other'],
  'stock_adjustment_reason tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'supply_shortage_status',
  array['open', 'resolved'],
  'supply_shortage_status tiene los valores exactos y en orden'
);

select ok(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'security_event_type') @> array['stock_movement_voided', 'supply_price_changed'],
  'security_event_type suma stock_movement_voided y supply_price_changed'
);

select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'security_event_type')[(select count(*) - 3 from pg_enum e2 join pg_type t2 on t2.oid = e2.enumtypid where t2.typname = 'security_event_type'):],
  array['stock_movement_voided', 'supply_price_changed', 'credentials_viewed', 'password_changed_by_user'],
  'los dos eventos nuevos van a continuación de los anteriores (y antes de los de 0075, P26.1)'
);

select ok(
  obj_description('public.admin_capability'::regtype, 'pg_type') like '%Gestionar stock%',
  'el comentario de admin_capability menciona «Gestionar stock»'
);

select * from finish();

rollback;
