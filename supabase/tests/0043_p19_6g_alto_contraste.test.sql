-- pgTAP de la migración 0043_p19_6g_alto_contraste.sql (P19.6 paquete G, AJ2-02):
--   profiles.high_contrast (default false) y RPC set_my_high_contrast.
-- Transacción que termina en rollback; fixtures propios 'f4300000-...'.

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

select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f4300000-0000-0000-0000-000000000001', 'test-aj2g-uno@example.com', jsonb_build_object('first_name', 'Uno', 'last_name', 'Gé')),
  ('f4300000-0000-0000-0000-000000000002', 'test-aj2g-dos@example.com', jsonb_build_object('first_name', 'Dos', 'last_name', 'Gé'));

insert into public.user_roles (profile_id, role) values
  ('f4300000-0000-0000-0000-000000000001', 'employee'),
  ('f4300000-0000-0000-0000-000000000002', 'employee');

select has_column('public', 'profiles', 'high_contrast', 'profiles tiene high_contrast');
select col_default_is('public', 'profiles', 'high_contrast', 'false', 'default false');

select is(
  (select high_contrast from public.profiles where id = 'f4300000-0000-0000-0000-000000000001'),
  false, 'una persona nueva arranca con alto contraste apagado');

-- Persona 1 lo prende y lo apaga
select tests.as_user('test-aj2g-uno@example.com');
select lives_ok($$select public.set_my_high_contrast(true)$$, 'la persona lo prende');
select is(
  (select high_contrast from public.profiles where id = 'f4300000-0000-0000-0000-000000000001'),
  true, 'lo lee en su propia fila con el select de siempre');
select lives_ok($$select public.set_my_high_contrast(false)$$, 'la persona lo apaga');
select is(
  (select high_contrast from public.profiles where id = 'f4300000-0000-0000-0000-000000000001'),
  false, 'quedó apagado');

-- No toca el de otra persona
select lives_ok($$select public.set_my_high_contrast(true)$$, 'prende de nuevo el propio');
select set_config('role', 'postgres', true);
select is(
  (select high_contrast from public.profiles where id = 'f4300000-0000-0000-0000-000000000002'),
  false, 'el de la otra persona no cambió');

-- anon no puede ejecutarla
select set_config('role', 'anon', true);
select throws_ok($$select public.set_my_high_contrast(true)$$, '42501', null, 'anon no puede ejecutarla');

select * from finish();
rollback;
