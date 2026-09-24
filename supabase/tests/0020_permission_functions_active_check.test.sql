-- pgTAP de 0020_permission_functions_active_check.sql: la ventana de revocación (04 sección 7.1,
-- decisión de Mike del 23 sep 2026, P07.1) y el arreglo de `service_role` sobre `profiles`
-- (pendiente de P04.6/P04.7).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c2000000-...'.
--
-- Nota de método: para probar la ventana de revocación hay que simular un `access_token` YA
-- EMITIDO mientras la persona estaba activa, y desactivarla DESPUÉS -- si acá se usara
-- `tests.as_user` (que arma los claims llamando al hook en el momento de cada llamada), el hook
-- de `0016_hardening.sql` ya dejaría los claims vacíos para una persona inactiva y el test no
-- probaría nada nuevo (probaría el hook, no esta migración). Por eso este archivo arma los claims
-- a mano, una sola vez, con los roles "de cuando la persona todavía estaba activa", y después
-- cambia `profiles.is_active` sin volver a pasar por el hook -- así reproduce el caso real: un
-- token vigente por hasta `jwt_expiry` segundos después de que alguien deja de estar activo.
--
-- Segunda nota de método, que costó una corrida en rojo: `auth.uid()` lee el GUC de sesión
-- `request.jwt.claims`, no depende del rol de Postgres activo -- así que, si se vuelve a
-- `postgres` para arreglar el fixture (por ejemplo, para reactivar el perfil) sin limpiar ese
-- GUC, el trigger `app.enforce_profile_self_update_columns` (que se dispara para CUALQUIER rol,
-- no solo `authenticated`) sigue viendo `auth.uid() = old.id` en `true` y rechaza el `update` de
-- `is_active`. Por eso, cada vez que este archivo vuelve a `postgres` para tocar el fixture,
-- limpia el GUC (`'{}'`) antes.
--
-- Tercera nota, la que de verdad estaba mal en el primer intento: la fila de `admin_capabilities`
-- usada para medir "¿esta sesión ve la fila?" tiene que ser de OTRA persona, no de la propia
-- sesión -- `admin_capabilities_select_own` (0012) da acceso de fila a "propia" con un simple
-- `profile_id = auth.uid()`, sin pasar por `app.has_role`/`app.is_admin`, así que probar sobre la
-- propia fila del owner no prueba nada de esta migración (esa política de "propia" sigue viendo
-- la fila aunque el perfil esté inactivo, correcto según 04 sección 7.2: "A: propias" no dice
-- "propias y activo"). La fila de prueba es la de una segunda persona (admin), visible para el
-- owner solo por `admin_capabilities_select_owner` (`using (app.has_role('owner'))`), que sí
-- pasa por la función que esta migración cambia.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Fixture: un owner y una segunda persona con rol admin (cuya fila de admin_capabilities el
-- owner ve solo por `app.has_role('owner')`, nunca por "propia") ---------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2000000-0000-0000-0000-000000000001', 'test-db020-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Ventana')),
  ('c2000000-0000-0000-0000-000000000002', 'test-db020-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Ventana'));

-- app.handle_new_user() (0003) ya creó las filas de profiles al insertar en auth.users; se
-- confirma la premisa (is_active = true por defecto) antes de forzar el rol.
select ok(
  (select is_active from public.profiles where id = 'c2000000-0000-0000-0000-000000000001') is true,
  'fixture: el perfil nace activo (default de profiles.is_active)'
);

insert into public.user_roles (profile_id, role) values
  ('c2000000-0000-0000-0000-000000000001', 'owner'),
  ('c2000000-0000-0000-0000-000000000002', 'admin');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('c2000000-0000-0000-0000-000000000002', 'cancel_shifts', true);

-- Forja los claims "como si" un token ya se hubiese emitido mientras el owner estaba activo -----

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-0000-0000-000000000001","role":"authenticated","roles":["owner"],"capabilities":[]}', true);

select ok(
  app.has_role('owner'),
  'app.has_role: con el perfil activo y el claim "owner", da true (caso base, sin la ventana de revocación de por medio)'
);

select ok(
  app.is_admin(),
  'app.is_admin: ídem, true con el perfil activo'
);

select is(
  (select count(*)::int from public.admin_capabilities where profile_id = 'c2000000-0000-0000-0000-000000000002'),
  1,
  'admin_capabilities: con el owner activo, la política admin_capabilities_select_owner (app.has_role(''owner'')) deja ver la fila de otra persona'
);

-- Desactiva el perfil del owner, sin tocar los claims (simula el paso del tiempo con el mismo
-- token) ------------------------------------------------------------------------------------------

select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '{}', true);
update public.profiles set is_active = false where id = 'c2000000-0000-0000-0000-000000000001';

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-0000-0000-000000000001","role":"authenticated","roles":["owner"],"capabilities":[]}', true);

select ok(
  not app.has_role('owner'),
  'app.has_role: mismo claim "owner" que antes, pero con is_active = false -> da false (app.current_profile_active(), la ventana de revocación se cierra)'
);

select ok(
  not app.is_admin(),
  'app.is_admin: ídem, false con el perfil inactivo aunque el claim siga diciendo owner'
);

select is(
  (select count(*)::int from public.admin_capabilities where profile_id = 'c2000000-0000-0000-0000-000000000002'),
  0,
  'admin_capabilities: con el owner inactivo, la misma política ya no deja ver la fila de la otra persona (RLS real, no solo la función)'
);

prepare set_capability_while_inactive as
  select public.set_admin_capability('c2000000-0000-0000-0000-000000000002', 'edit_ratings'::public.admin_capability, true);

select throws_ok(
  'set_capability_while_inactive', 'P0001', 'No tenés permiso para hacer esto.',
  'set_admin_capability: el mismo token, ya inactivo el perfil, no puede escribir (FORBIDDEN vía app.require_role)'
);

-- Reactiva: el mismo token (sin renovarse) recupera el acceso -------------------------------------

select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '{}', true);
update public.profiles set is_active = true where id = 'c2000000-0000-0000-0000-000000000001';

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"c2000000-0000-0000-0000-000000000001","role":"authenticated","roles":["owner"],"capabilities":[]}', true);

select ok(
  app.has_role('owner'),
  'app.has_role: al reactivar el perfil, el mismo token vuelve a dar true (sin necesidad de un token nuevo)'
);

select is(
  (select count(*)::int from public.admin_capabilities where profile_id = 'c2000000-0000-0000-0000-000000000002'),
  1,
  'admin_capabilities: al reactivar, la política vuelve a dejar ver la fila de la otra persona'
);

select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '{}', true);

-- app.enforce_profile_self_update_columns ahora es security definer: service_role puede
-- actualizar profiles sin "permission denied for schema app" (pendiente de P04.6/P04.7) ----------

select is(
  (select provolatile::text || case when prosecdef then ' definer' else ' invoker' end
   from pg_proc where proname = 'enforce_profile_self_update_columns' and pronamespace = 'app'::regnamespace),
  'v definer',
  'app.enforce_profile_self_update_columns: security definer desde esta migración (antes: invoker)'
);

select set_config('role', 'service_role', true);

select lives_ok(
  $$ update public.profiles set contact_email = 'service-role-test@example.com' where id = 'c2000000-0000-0000-0000-000000000001' $$,
  'profiles: service_role puede actualizar la fila sin "permission denied for schema app" (arreglo de esta migración)'
);

select set_config('role', 'postgres', true);

select * from finish();

rollback;
