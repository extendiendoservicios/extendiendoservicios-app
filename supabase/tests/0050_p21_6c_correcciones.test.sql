-- pgTAP de la migración 0050_p21_6c_correcciones.sql (P21.6c): service_role lee todas las vistas
-- (usage sobre app) y set_my_high_contrast rechaza con FORBIDDEN a una persona desactivada.
-- Transacción que termina en rollback; fixtures propios 'f5000000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.as_user(p_email text)
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
    raise exception 'tests.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests.as_user(text) to authenticated, anon;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f5000000-0000-0000-0000-000000000001', 'test-db050-activo@example.com', jsonb_build_object('first_name', 'Act', 'last_name', 'Ivo')),
  ('f5000000-0000-0000-0000-000000000002', 'test-db050-baja@example.com', jsonb_build_object('first_name', 'Ba', 'last_name', 'Ja'));
insert into public.user_roles (profile_id, role) values
  ('f5000000-0000-0000-0000-000000000001', 'employee'),
  ('f5000000-0000-0000-0000-000000000002', 'employee');

-- 1. service_role y las vistas
select ok(has_schema_privilege('service_role', 'app', 'usage'), 'service_role tiene usage sobre app');
select ok(not has_schema_privilege('anon', 'app', 'usage'), 'anon sigue sin usage sobre app');

select set_config('role', 'service_role', true);
select lives_ok(
  $$select app.capped_worked_minutes(now(), now() + interval '1 hour', now(), now() + interval '1 hour')$$,
  'service_role ejecuta app.capped_worked_minutes'
);
select lives_ok($$select worked_minutes from public.v_assignments_board limit 1$$, 'service_role lee v_assignments_board.worked_minutes');
select lives_ok($$select * from public.v_my_announcements limit 1$$, 'service_role lee v_my_announcements');

-- Todas las vistas de public son consultables por service_role (se recorre el catálogo).
do $$
declare
  v record;
  v_fallas text := '';
begin
  for v in select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' loop
    begin
      execute format('select * from public.%I limit 1', v.relname);
    exception when others then
      v_fallas := v_fallas || v.relname || ' (' || sqlerrm || '); ';
    end;
  end loop;
  perform set_config('tests.fallas_vistas', v_fallas, true);
end $$;
select is(current_setting('tests.fallas_vistas'), '', 'service_role consulta todas las vistas de public sin error');

-- 2. set_my_high_contrast y el perfil desactivado
select set_config('role', 'postgres', true);
update public.profiles set is_active = false where id = 'f5000000-0000-0000-0000-000000000002';

select tests.as_user('test-db050-baja@example.com');
select throws_ok($$select public.set_my_high_contrast(true)$$, 'P0001', 'No tenés permiso para hacer esto.', 'una persona desactivada recibe FORBIDDEN');

select tests.as_user('test-db050-activo@example.com');
select lives_ok($$select public.set_my_high_contrast(true)$$, 'una persona activa sigue pudiendo usarla');

select * from finish();
rollback;
