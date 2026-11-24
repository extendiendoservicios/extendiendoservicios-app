-- pgTAP de la migración 0090_p32_1b_cerrar_en_camino.sql (P32.1b, D-09, OG-02):
-- el aviso «En camino» (onTheWay) se puede cerrar como los demás; los tipos viejos siguen igual.
-- Convención: transacción que termina en `rollback`. Prefijo de fixtures propio: 'f9000000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0090;
grant usage on schema tests_0090 to authenticated, anon;

create or replace function tests_0090.as_user(p_email text)
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
    raise exception 'tests_0090.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0090.as_user(text) to authenticated, anon;

create or replace function tests_0090.hint_of(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'sin error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(v_hint, sqlstate);
end;
$$;

grant execute on function tests_0090.hint_of(text) to authenticated, anon;

select plan(15);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f9000000-0000-0000-0000-000000000001', 'Cliente 0090 SA', 'C 0090', 'active', 3);

insert into public.sites (id, client_id, name, address, city, latitude, longitude, status) values
  ('f9000000-0000-0000-0000-000000000011', 'f9000000-0000-0000-0000-000000000001', 'Sede 0090', 'Dirección 0090', 'Rosario', -32.9, -60.6, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f9000000-0000-0000-0000-000000000081', 'test-db0090-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Noventa')),
  ('f9000000-0000-0000-0000-000000000082', 'test-db0090-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Noventa')),
  ('f9000000-0000-0000-0000-000000000091', 'test-db0090-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Noventa')),
  ('f9000000-0000-0000-0000-0000000000a1', 'test-db0090-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Noventa'));

insert into public.user_roles (profile_id, role) values
  ('f9000000-0000-0000-0000-000000000081', 'owner'),
  ('f9000000-0000-0000-0000-000000000082', 'admin'),
  ('f9000000-0000-0000-0000-000000000091', 'supervisor'),
  ('f9000000-0000-0000-0000-0000000000a1', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f9000000-0000-0000-0000-000000000091', '99009091', 'active'),
  ('f9000000-0000-0000-0000-0000000000a1', '99009101', 'active');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f9000000-0000-0000-0000-000000000031', 'f9000000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000011', app.today(), '08:00', '09:00', 1, 'assigned', false),
  ('f9000000-0000-0000-0000-000000000032', 'f9000000-0000-0000-0000-000000000001', 'f9000000-0000-0000-0000-000000000011', app.today(), '10:00', '11:00', 1, 'scheduled', false);

insert into public.assignments (id, shift_id, employee_id) values
  ('f9000000-0000-0000-0000-000000000101', 'f9000000-0000-0000-0000-000000000031', 'f9000000-0000-0000-0000-0000000000a1');

-- Estructura -----------------------------------------------------------------------------------

select ok(
  (select pg_get_constraintdef(oid) like '%onTheWay%' from pg_constraint where conname = 'attention_dismissals_kind_check'),
  'attention_dismissals_kind_check admite onTheWay'
);
select ok(
  (select pg_get_constraintdef(oid) like '%delayNotified%' from pg_constraint where conname = 'attention_dismissals_kind_check'),
  'attention_dismissals_kind_check conserva los tipos anteriores'
);

-- Cerrar onTheWay ------------------------------------------------------------------------------

select tests_0090.as_user('test-db0090-admin@example.com');
select is(
  (select kind from public.dismiss_attention('onTheWay', 'f9000000-0000-0000-0000-000000000031', 'f9000000-0000-0000-0000-000000000101')),
  'onTheWay',
  'dismiss_attention: el admin cierra «En camino» con asignación'
);
select is(
  (select assignment_id from public.attention_dismissals where kind = 'onTheWay' and shift_id = 'f9000000-0000-0000-0000-000000000031'),
  'f9000000-0000-0000-0000-000000000101'::uuid,
  'el cierre queda con la asignación'
);
select is(
  (select dismissed_by from public.attention_dismissals where kind = 'onTheWay' and shift_id = 'f9000000-0000-0000-0000-000000000031'),
  'f9000000-0000-0000-0000-000000000082'::uuid,
  'el cierre guarda quién lo cerró'
);
select is(
  (select id from public.dismiss_attention('onTheWay', 'f9000000-0000-0000-0000-000000000031', 'f9000000-0000-0000-0000-000000000101')),
  (select id from public.attention_dismissals where kind = 'onTheWay' and shift_id = 'f9000000-0000-0000-0000-000000000031'),
  'cerrar «En camino» es idempotente'
);
select is(tests_0090.hint_of($$select * from public.dismiss_attention('onTheWay', 'f9000000-0000-0000-0000-000000000031', null)$$), 'INVALID_ATTENTION_TARGET', 'onTheWay sin asignación falla');
select is(tests_0090.hint_of($$select * from public.dismiss_attention('onTheWay', 'f9000000-0000-0000-0000-000000000032', 'f9000000-0000-0000-0000-000000000101')$$), 'ASSIGNMENT_NOT_FOUND', 'onTheWay con asignación de otro turno falla');
select is(tests_0090.hint_of($$select * from public.dismiss_attention('enCamino', 'f9000000-0000-0000-0000-000000000031', 'f9000000-0000-0000-0000-000000000101')$$), 'INVALID_ATTENTION_KIND', 'un tipo inventado sigue fallando');

-- Tipos viejos ---------------------------------------------------------------------------------

select is(
  (select kind from public.dismiss_attention('late', 'f9000000-0000-0000-0000-000000000031', 'f9000000-0000-0000-0000-000000000101')),
  'late',
  'los tipos viejos siguen funcionando (late)'
);
select is(
  (select kind from public.dismiss_attention('uncovered', 'f9000000-0000-0000-0000-000000000032', null)),
  'uncovered',
  'los tipos viejos siguen funcionando (uncovered por turno)'
);

-- Permisos -------------------------------------------------------------------------------------

select tests_0090.as_user('test-db0090-owner@example.com');
select is(
  (select count(*)::int from public.attention_dismissals where shift_id = 'f9000000-0000-0000-0000-000000000031'),
  2,
  'el dueño lee los cierres de todos'
);
select is(
  (select kind from public.dismiss_attention('noRecord', 'f9000000-0000-0000-0000-000000000031', 'f9000000-0000-0000-0000-000000000101')),
  'noRecord',
  'el dueño también cierra avisos'
);
select tests_0090.as_user('test-db0090-sup@example.com');
select is(tests_0090.hint_of($$select * from public.dismiss_attention('onTheWay', 'f9000000-0000-0000-0000-000000000031', 'f9000000-0000-0000-0000-000000000101')$$), 'FORBIDDEN', 'coordinador FORBIDDEN');
select tests_0090.as_user('test-db0090-a1@example.com');
select is(tests_0090.hint_of($$select * from public.dismiss_attention('onTheWay', 'f9000000-0000-0000-0000-000000000031', 'f9000000-0000-0000-0000-000000000101')$$), 'FORBIDDEN', 'empleado FORBIDDEN');

select * from finish();
rollback;
