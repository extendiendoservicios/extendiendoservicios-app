-- pgTAP de la migración 0019_security_events_sign_in.sql (AUTH-009): app.log_sign_in() y el
-- trigger trg_log_sign_in sobre auth.sessions -- registro de "sign_in" en security_events
-- (04 sección 2.6, P-104), con el camino de fallo protegido: un error al loguear el evento no
-- puede cortar el inicio de sesión (indicación central de la tarea, ver el comentario de
-- cabecera de la migración).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'd0190000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Existencia y forma ------------------------------------------------------------------------

select has_function('app', 'log_sign_in', array[]::text[], 'existe app.log_sign_in()');

select ok(
  (select prosecdef from pg_proc where pronamespace = 'app'::regnamespace and proname = 'log_sign_in'),
  'app.log_sign_in() es security definer (para insertar en security_events sin depender de qué rol dispare el trigger)'
);

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'sessions' and t.tgname = 'trg_log_sign_in'
  ),
  'auth.sessions tiene el trigger trg_log_sign_in'
);

-- Camino feliz: usuario con profile existente (lo crea app.handle_new_user() al insertar en
-- auth.users, 0003) --------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0190000-0000-0000-0000-000000000001', 'test-auth009-feliz@example.com', jsonb_build_object('first_name', 'Feliz', 'last_name', 'Uno'));

select lives_ok(
  $$insert into auth.sessions (id, user_id, ip, user_agent) values
    ('d0190000-0000-0000-0000-000000000002', 'd0190000-0000-0000-0000-000000000001', '203.0.113.10'::inet, 'pgtap-agente')$$,
  'insertar una sesión con actor válido (con profile) no falla'
);

select is(
  (select count(*)::int from public.security_events
    where event_type = 'sign_in' and actor_id = 'd0190000-0000-0000-0000-000000000001'),
  1,
  'camino feliz: se registró exactamente un evento sign_in'
);

select is(
  (select host(ip) from public.security_events
    where event_type = 'sign_in' and actor_id = 'd0190000-0000-0000-0000-000000000001'),
  '203.0.113.10',
  'camino feliz: el evento trae la ip de la sesión (host(), no ip::text -- este último conserva la máscara de red, "203.0.113.10/32", detectado corriendo el test)'
);

select is(
  (select (details ->> 'session_id')::uuid from public.security_events
    where event_type = 'sign_in' and actor_id = 'd0190000-0000-0000-0000-000000000001'),
  'd0190000-0000-0000-0000-000000000002'::uuid,
  'camino feliz: details trae el id de la sesión de auth.sessions'
);

-- Refresco de token: comprobado en vivo contra App_dev (ver el reporte de la tarea) que NO crea
-- una fila nueva en auth.sessions, actualiza la existente -- se simula acá con un UPDATE sobre
-- la misma fila. El trigger es AFTER INSERT, no debería disparar de nuevo -----------------------

update auth.sessions set refreshed_at = now(), updated_at = now()
  where id = 'd0190000-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.security_events
    where event_type = 'sign_in' and actor_id = 'd0190000-0000-0000-0000-000000000001'),
  1,
  'un UPDATE sobre la sesión (simula el refresco de token) no agrega un segundo evento sign_in'
);

-- Camino de fallo: la fila de profiles no existe para el usuario de la sesión (security_events.
-- actor_id referencia profiles(id)) -- el insert en auth.sessions NO puede fallar por esto, es
-- la indicación central de AUTH-009 ------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('d0190000-0000-0000-0000-000000000003', 'test-auth009-fallo@example.com', jsonb_build_object('first_name', 'Falla', 'last_name', 'Dos'));

delete from public.profiles where id = 'd0190000-0000-0000-0000-000000000003';

select lives_ok(
  $$insert into auth.sessions (id, user_id, ip, user_agent) values
    ('d0190000-0000-0000-0000-000000000004', 'd0190000-0000-0000-0000-000000000003', '203.0.113.20'::inet, 'pgtap-agente-fallo')$$,
  'camino de fallo: insertar una sesión sin profile para el actor NO revienta (el login sigue andando)'
);

select is(
  (select count(*)::int from auth.sessions where id = 'd0190000-0000-0000-0000-000000000004'),
  1,
  'camino de fallo: la sesión quedó creada de todos modos'
);

select is(
  (select count(*)::int from public.security_events where actor_id = 'd0190000-0000-0000-0000-000000000003'),
  0,
  'camino de fallo: no quedó ningún evento sign_in para ese actor (el error se atrapó adentro del trigger)'
);

-- Uso interno: nadie llama app.log_sign_in() directamente, ni siquiera postgres -- Postgres
-- rechaza estructuralmente invocar una función "returns trigger" fuera de un trigger real
-- (comprobado en vivo contra App_dev: error 0A000, "trigger functions can only be called as
-- triggers") --------------------------------------------------------------------------------

prepare log_sign_in_directo as select app.log_sign_in();

select throws_ok(
  'log_sign_in_directo',
  '0A000',
  null,
  'app.log_sign_in() no se puede invocar directamente, fuera de un trigger'
);

select * from finish();

rollback;
