-- pgTAP de la migración 0042_p19_6e_avisos_y_anuncios.sql (P19.6 paquete E, AJ2-03 «Avisos y anuncios»):
--   tablas announcements / announcement_recipients / announcement_reads, RLS por rol, audiencias,
--   vigencia (ayer / hoy / mañana), archivado, RPC create/update/archive/acknowledge, vistas
--   v_my_announcements, v_announcements_admin y v_announcement_recipients (conteos de lectura).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f4200000-...'. Los títulos de prueba empiezan con 'T42' para no depender de
-- otros datos de la base.

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

select plan(88);

-- Estructura -----------------------------------------------------------------------------------

select has_table('public', 'announcements', 'existe public.announcements');
select has_table('public', 'announcement_recipients', 'existe public.announcement_recipients');
select has_table('public', 'announcement_reads', 'existe public.announcement_reads');
select has_view('public', 'v_my_announcements', 'existe v_my_announcements');
select has_view('public', 'v_announcements_admin', 'existe v_announcements_admin');
select has_view('public', 'v_announcement_recipients', 'existe v_announcement_recipients');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
   from pg_enum e where e.enumtypid = 'public.announcement_audience'::regtype),
  array['employees', 'supervisors', 'all', 'custom'],
  'announcement_audience: employees, supervisors, all, custom'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('public.announcements'::regclass, 'public.announcement_recipients'::regclass, 'public.announcement_reads'::regclass)),
  'las tres tablas tienen RLS habilitada'
);
select ok(
  not has_table_privilege('authenticated', 'public.announcements', 'insert')
    and not has_table_privilege('authenticated', 'public.announcements', 'update')
    and not has_table_privilege('authenticated', 'public.announcements', 'delete')
    and not has_table_privilege('authenticated', 'public.announcement_recipients', 'insert')
    and not has_table_privilege('authenticated', 'public.announcement_recipients', 'delete')
    and not has_table_privilege('authenticated', 'public.announcement_reads', 'insert')
    and not has_table_privilege('authenticated', 'public.announcement_reads', 'update')
    and not has_table_privilege('authenticated', 'public.announcement_reads', 'delete'),
  'authenticated: sin insert/update/delete en las tablas de anuncios (se escribe por RPC)'
);
select ok(
  not has_table_privilege('anon', 'public.announcements', 'select')
    and not has_table_privilege('anon', 'public.announcement_reads', 'select')
    and not has_table_privilege('anon', 'public.v_my_announcements', 'select')
    and not has_table_privilege('anon', 'public.v_announcements_admin', 'select'),
  'anon: sin select en anuncios ni en sus vistas'
);
select has_function('public', 'create_announcement', array['text', 'text', 'announcement_audience', 'date', 'uuid[]'], 'existe create_announcement');
select has_function('public', 'update_announcement', array['uuid', 'text', 'text', 'announcement_audience', 'date', 'uuid[]'], 'existe update_announcement');
select has_function('public', 'archive_announcement', array['uuid'], 'existe archive_announcement');
select has_function('public', 'acknowledge_announcement', array['uuid'], 'existe acknowledge_announcement');
select ok(
  not has_function_privilege('anon', 'public.create_announcement(text,text,announcement_audience,date,uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.acknowledge_announcement(uuid)', 'execute'),
  'anon: sin execute en las RPC de anuncios'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('f4200000-0000-0000-0000-000000000001', 'test-aj2e-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('f4200000-0000-0000-0000-000000000002', 'test-aj2e-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('f4200000-0000-0000-0000-000000000003', 'test-aj2e-supervisor@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Tres')),
  ('f4200000-0000-0000-0000-000000000004', 'test-aj2e-emp1@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Cuatro')),
  ('f4200000-0000-0000-0000-000000000005', 'test-aj2e-emp2@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Cinco')),
  ('f4200000-0000-0000-0000-000000000006', 'test-aj2e-dual@example.com', jsonb_build_object('first_name', 'Dual', 'last_name', 'Seis')),
  ('f4200000-0000-0000-0000-000000000007', 'test-aj2e-inactivo@example.com', jsonb_build_object('first_name', 'Inactivo', 'last_name', 'Siete'));

insert into public.user_roles (profile_id, role) values
  ('f4200000-0000-0000-0000-000000000001', 'owner'),
  ('f4200000-0000-0000-0000-000000000002', 'admin'),
  ('f4200000-0000-0000-0000-000000000003', 'supervisor'),
  ('f4200000-0000-0000-0000-000000000004', 'employee'),
  ('f4200000-0000-0000-0000-000000000005', 'employee'),
  ('f4200000-0000-0000-0000-000000000006', 'employee'),
  ('f4200000-0000-0000-0000-000000000006', 'supervisor'),
  ('f4200000-0000-0000-0000-000000000007', 'employee');

update public.profiles set is_active = false where id = 'f4200000-0000-0000-0000-000000000007';

-- Anuncios (ids a...N). Hoy = app.today().
insert into public.announcements (id, title, body, audience, visible_until, archived_at) values
  ('f4200000-0000-0000-0000-0000000000a1', 'T42 empleados', 'Texto', 'employees', null, null),
  ('f4200000-0000-0000-0000-0000000000a2', 'T42 supervisores', 'Texto', 'supervisors', null, null),
  ('f4200000-0000-0000-0000-0000000000a3', 'T42 todos', 'Texto', 'all', null, null),
  ('f4200000-0000-0000-0000-0000000000a4', 'T42 custom', 'Texto', 'custom', null, null),
  ('f4200000-0000-0000-0000-0000000000a5', 'T42 ayer', 'Texto', 'all', app.today() - 1, null),
  ('f4200000-0000-0000-0000-0000000000a6', 'T42 hoy', 'Texto', 'all', app.today(), null),
  ('f4200000-0000-0000-0000-0000000000a7', 'T42 manana', 'Texto', 'all', app.today() + 1, null),
  ('f4200000-0000-0000-0000-0000000000a8', 'T42 archivado', 'Texto', 'all', null, now());

insert into public.announcement_recipients (announcement_id, profile_id) values
  ('f4200000-0000-0000-0000-0000000000a4', 'f4200000-0000-0000-0000-000000000004'),
  ('f4200000-0000-0000-0000-0000000000a4', 'f4200000-0000-0000-0000-000000000003');

-- Como empleado 1: ve lo suyo ---------------------------------------------------------------------

select tests.as_user('test-aj2e-emp1@example.com');

select is(
  (select array_agg(title order by title) from public.announcements where title like 'T42%'),
  array['T42 custom', 'T42 empleados', 'T42 hoy', 'T42 manana', 'T42 todos'],
  'empleado 1: ve empleados, todos, su custom, hoy y mañana; no supervisores, ayer ni archivado'
);
select is(
  (select array_agg(title order by title) from public.v_my_announcements where title like 'T42%'),
  array['T42 custom', 'T42 empleados', 'T42 hoy', 'T42 manana', 'T42 todos'],
  'empleado 1: v_my_announcements trae los mismos'
);
select is(
  (select count(*)::int from public.v_my_announcements where title like 'T42%' and read_at is not null),
  0, 'empleado 1: todavía no leyó ninguno'
);
select is(
  (select count(*)::int from public.announcement_recipients), 1,
  'empleado 1: de la lista de destinatarios solo ve su propia fila'
);
select throws_ok(
  $$insert into public.announcements (title, body, audience) values ('T42 x', 'y', 'all')$$,
  '42501', null, 'empleado: no inserta anuncios directo'
);
select throws_ok(
  $$select public.create_announcement('T42 x', 'y', 'all')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'empleado: create_announcement da FORBIDDEN'
);
select throws_ok(
  $$select public.archive_announcement('f4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'empleado: archive_announcement da FORBIDDEN'
);
select throws_ok(
  $$select public.update_announcement('f4200000-0000-0000-0000-0000000000a1', 'a', 'b', 'all')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'empleado: update_announcement da FORBIDDEN'
);
select is(
  (select count(*)::int from public.v_announcements_admin) + (select count(*)::int from public.v_announcement_recipients),
  0, 'empleado: las vistas de administración salen vacías'
);

-- Entendido: idempotente
select is(
  (select announcement_id::text from public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a1')),
  'f4200000-0000-0000-0000-0000000000a1', 'empleado 1: acknowledge_announcement devuelve la lectura'
);
select is(
  (select read_at from public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a1')),
  (select read_at from public.announcement_reads
   where announcement_id = 'f4200000-0000-0000-0000-0000000000a1' and profile_id = 'f4200000-0000-0000-0000-000000000004'),
  'empleado 1: repetir «Entendido» conserva la lectura original (idempotente)'
);
select is(
  (select count(*)::int from public.announcement_reads), 1, 'empleado 1: una sola fila de lectura'
);
select isnt(
  (select read_at from public.v_my_announcements where id = 'f4200000-0000-0000-0000-0000000000a1'), null,
  'empleado 1: v_my_announcements trae read_at del leído'
);
select is(
  (select count(*)::int from public.v_my_announcements where title like 'T42%' and read_at is null), 4,
  'empleado 1: le quedan 4 sin leer'
);
select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a3');
select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a4');

select throws_ok(
  $$select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a2')$$,
  'P0001', 'Ese anuncio ya no está disponible para vos.', 'empleado 1: «Entendido» de un anuncio de supervisores se rechaza'
);
select throws_ok(
  $$select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a5')$$,
  'P0001', 'Ese anuncio ya no está disponible para vos.', 'empleado 1: «Entendido» de un anuncio vencido se rechaza'
);
select throws_ok(
  $$select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a8')$$,
  'P0001', 'Ese anuncio ya no está disponible para vos.', 'empleado 1: «Entendido» de un anuncio archivado se rechaza'
);
select throws_ok(
  $$select public.acknowledge_announcement('f4200000-0000-0000-0000-00000000dead')$$,
  'P0001', 'Ese anuncio ya no está disponible para vos.', 'empleado 1: «Entendido» de un anuncio inexistente se rechaza'
);

-- Como empleado 2: no es destinatario del custom ----------------------------------------------------

select tests.as_user('test-aj2e-emp2@example.com');

select is(
  (select array_agg(title order by title) from public.announcements where title like 'T42%'),
  array['T42 empleados', 'T42 hoy', 'T42 manana', 'T42 todos'],
  'empleado 2: no ve el custom ni supervisores, ayer ni archivado'
);
select is((select count(*)::int from public.announcement_recipients), 0, 'empleado 2: no ve filas de destinatarios');
select is((select count(*)::int from public.announcement_reads), 0, 'empleado 2: no ve lecturas ajenas');
select throws_ok(
  $$select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a4')$$,
  'P0001', 'Ese anuncio ya no está disponible para vos.', 'empleado 2: no puede dar «Entendido» a un custom que no es para él'
);
select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a3');

-- Como supervisor ------------------------------------------------------------------------------------

select tests.as_user('test-aj2e-supervisor@example.com');

select is(
  (select array_agg(title order by title) from public.v_my_announcements where title like 'T42%'),
  array['T42 custom', 'T42 hoy', 'T42 manana', 'T42 supervisores', 'T42 todos'],
  'supervisor: ve supervisores, todos, su custom, hoy y mañana; no empleados'
);
select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'Ese anuncio ya no está disponible para vos.', 'supervisor: no puede dar «Entendido» a uno de empleados'
);

-- Persona con ambos roles ----------------------------------------------------------------------------

select tests.as_user('test-aj2e-dual@example.com');

select is(
  (select array_agg(title order by title) from public.v_my_announcements where title like 'T42%'),
  array['T42 empleados', 'T42 hoy', 'T42 manana', 'T42 supervisores', 'T42 todos'],
  'empleado y supervisor a la vez: ve empleados y supervisores; el custom no (no está en la lista)'
);
select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a3');

-- Perfil inactivo --------------------------------------------------------------------------------------

select tests.as_user('test-aj2e-inactivo@example.com');

select is((select count(*)::int from public.announcements where title like 'T42%'), 0, 'perfil inactivo: no ve anuncios');
select throws_ok(
  $$select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'perfil inactivo: «Entendido» da FORBIDDEN'
);

-- Como administrador ----------------------------------------------------------------------------------

select tests.as_user('test-aj2e-admin@example.com');

select is(
  (select count(*)::int from public.announcements where title like 'T42%'), 8,
  'administrador: ve los 8 anuncios (también ayer y archivado)'
);
select is(
  (select count(*)::int from public.v_my_announcements where title like 'T42%'), 0,
  'administrador sin rol de empleado/supervisor: nada en su portada (v_my_announcements)'
);
select is((select count(*)::int from public.announcement_reads), 6, 'administrador: ve todas las lecturas');
select throws_ok(
  $$select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a1')$$,
  'P0001', 'Ese anuncio ya no está disponible para vos.', 'administrador: no es destinatario, «Entendido» se rechaza'
);

-- Conteos: destinatarios (personas activas) y lecturas
select results_eq(
  $$select title, recipient_count, read_count, status from public.v_announcements_admin where title like 'T42%' order by title$$,
  $$values
    ('T42 archivado'::text, 4, 0, 'archived'::text),
    ('T42 ayer', 4, 0, 'expired'),
    ('T42 custom', 2, 1, 'active'),
    ('T42 empleados', 3, 1, 'active'),
    ('T42 hoy', 4, 0, 'active'),
    ('T42 manana', 4, 0, 'active'),
    ('T42 supervisores', 2, 1, 'active'),
    ('T42 todos', 4, 3, 'active')$$,
  'v_announcements_admin: destinatarios (solo activos), lecturas y estado por anuncio'
);
select results_eq(
  $$select first_name, roles, read_at is not null from public.v_announcement_recipients
    where announcement_id = 'f4200000-0000-0000-0000-0000000000a3' order by first_name$$,
  $$values
    ('Dual'::text, array['employee', 'supervisor']::text[], true),
    ('Emp', array['employee']::text[], true),
    ('Emp', array['employee']::text[], true),
    ('Sup', array['supervisor']::text[], false)$$,
  'v_announcement_recipients: detalle por persona de «todos» (el inactivo no figura, el supervisor aún no leyó)'
);
select is(
  (select count(*)::int from public.v_announcement_recipients where announcement_id = 'f4200000-0000-0000-0000-0000000000a4'), 2,
  'v_announcement_recipients: custom lista solo a los elegidos'
);

-- Validaciones de create_announcement
select throws_ok($$select public.create_announcement('   ', 'b', 'all')$$, 'P0001', 'Escribí un título para el anuncio.', 'create: título vacío');
select throws_ok($$select public.create_announcement(repeat('x', 121), 'b', 'all')$$, 'P0001', 'El título puede tener hasta 120 caracteres.', 'create: título largo');
select throws_ok($$select public.create_announcement('t', '', 'all')$$, 'P0001', 'Escribí el texto del anuncio.', 'create: texto vacío');
select throws_ok($$select public.create_announcement('t', repeat('x', 2001), 'all')$$, 'P0001', 'El texto puede tener hasta 2000 caracteres.', 'create: texto largo');
select throws_ok($$select public.create_announcement('t', 'b', null)$$, 'P0001', 'Elegí a quién va dirigido el anuncio.', 'create: sin audiencia');
select throws_ok(
  $$select public.create_announcement('t', 'b', 'all', app.today() - 1)$$,
  'P0001', 'La fecha «hasta» no puede ser anterior a hoy.', 'create: fecha en el pasado'
);
select throws_ok($$select public.create_announcement('t', 'b', 'custom')$$, 'P0001', 'Elegí al menos una persona para el anuncio.', 'create: custom sin destinatarios');
select throws_ok(
  $$select public.create_announcement('t', 'b', 'custom', null, array[]::uuid[])$$,
  'P0001', 'Elegí al menos una persona para el anuncio.', 'create: custom con lista vacía'
);
select throws_ok(
  $$select public.create_announcement('t', 'b', 'custom', null, array['f4200000-0000-0000-0000-000000000007']::uuid[])$$,
  'P0001', 'Hay personas elegidas que no están activas o no son empleados ni supervisores.', 'create: custom con una persona inactiva'
);
select throws_ok(
  $$select public.create_announcement('t', 'b', 'custom', null, array['f4200000-0000-0000-0000-000000000001']::uuid[])$$,
  'P0001', 'Hay personas elegidas que no están activas o no son empleados ni supervisores.', 'create: custom con un dueño (sin rol de empleado ni supervisor)'
);
select is(
  (select count(*)::int from public.announcements where title = 't'), 0, 'create: los rechazos no dejan filas'
);

-- Altas correctas
select is(
  (select audience::text from public.create_announcement('  T42 rpc custom  ', ' Hola ', 'custom', app.today(),
     array['f4200000-0000-0000-0000-000000000005', 'f4200000-0000-0000-0000-000000000005', 'f4200000-0000-0000-0000-000000000006']::uuid[])),
  'custom', 'create: alta custom'
);
select results_eq(
  $$select a.title, a.body, a.created_by::text, (select count(*)::int from public.announcement_recipients r where r.announcement_id = a.id)
    from public.announcements a where a.title like 'T42 rpc custom%'$$,
  $$values ('T42 rpc custom'::text, 'Hola'::text, 'f4200000-0000-0000-0000-000000000002'::text, 2)$$,
  'create: recorta texto, registra autor y deduplica destinatarios'
);
select is(
  (select visible_until from public.create_announcement('T42 rpc hoy', 'b', 'employees', app.today(), array['f4200000-0000-0000-0000-000000000005']::uuid[])),
  app.today(), 'create: fecha «hasta» de hoy es válida'
);
select is(
  (select count(*)::int from public.announcement_recipients r join public.announcements a on a.id = r.announcement_id where a.title = 'T42 rpc hoy'),
  0, 'create: fuera de custom se ignoran los destinatarios'
);

-- update_announcement
select is(
  (select audience::text from public.update_announcement(
     (select id from public.announcements where title = 'T42 rpc hoy'), 'T42 rpc hoy', 'b', 'custom', null,
     array['f4200000-0000-0000-0000-000000000004']::uuid[])),
  'custom', 'update: employees pasa a custom'
);
select is(
  (select count(*)::int from public.announcement_recipients r join public.announcements a on a.id = r.announcement_id where a.title = 'T42 rpc hoy'),
  1, 'update: custom con 1 destinatario'
);
select is(
  (select audience::text from public.update_announcement(
     (select id from public.announcements where title = 'T42 rpc hoy'), 'T42 rpc hoy', 'b', 'all', null,
     array['f4200000-0000-0000-0000-000000000004']::uuid[])),
  'all', 'update: custom pasa a todos'
);
select is(
  (select count(*)::int from public.announcement_recipients r join public.announcements a on a.id = r.announcement_id where a.title = 'T42 rpc hoy'),
  0, 'update: al salir de custom se limpian los destinatarios'
);
select throws_ok(
  $$select public.update_announcement((select id from public.announcements where title = 'T42 rpc hoy'), 't', 'b', 'custom')$$,
  'P0001', 'Elegí al menos una persona para el anuncio.', 'update: custom sin destinatarios'
);
select throws_ok(
  $$select public.update_announcement((select id from public.announcements where title = 'T42 rpc hoy'), 't', 'b', 'all', app.today() - 1)$$,
  'P0001', 'La fecha «hasta» no puede ser anterior a hoy.', 'update: cambiar a una fecha pasada se rechaza'
);
select throws_ok(
  $$select public.update_announcement('f4200000-0000-0000-0000-00000000dead', 't', 'b', 'all')$$,
  'P0001', 'No encontramos ese anuncio.', 'update: anuncio inexistente'
);
select throws_ok(
  $$select public.update_announcement('f4200000-0000-0000-0000-0000000000a8', 't', 'b', 'all')$$,
  'P0001', 'El anuncio está archivado y no se puede editar.', 'update: anuncio archivado'
);
-- Se puede corregir un anuncio vencido sin tocar la fecha.
select is(
  (select title from public.update_announcement('f4200000-0000-0000-0000-0000000000a5', 'T42 ayer corregido', 'Texto', 'all', app.today() - 1)),
  'T42 ayer corregido', 'update: un anuncio vencido se corrige si no se cambia la fecha'
);

-- Editar sin cambiar el texto no reinicia las lecturas
select public.update_announcement('f4200000-0000-0000-0000-0000000000a1', 'T42 empleados', 'Texto', 'employees', app.today() + 5);
select is(
  (select count(*)::int from public.announcement_reads where announcement_id = 'f4200000-0000-0000-0000-0000000000a1'), 1,
  'update: cambiar solo la fecha deja la lectura'
);
select is(
  (select read_count from public.v_announcements_admin where id = 'f4200000-0000-0000-0000-0000000000a1'), 1,
  'update: cambiar solo la fecha mantiene el conteo de lecturas'
);

-- Editar el texto: las lecturas dejan de contar pero se conservan
select public.update_announcement('f4200000-0000-0000-0000-0000000000a1', 'T42 empleados', 'Texto corregido', 'employees', app.today() + 5);
select is(
  (select read_count from public.v_announcements_admin where id = 'f4200000-0000-0000-0000-0000000000a1'), 0,
  'update: cambiar el texto reinicia el conteo de lecturas'
);
select is(
  (select count(*)::int from public.announcement_reads where announcement_id = 'f4200000-0000-0000-0000-0000000000a1'), 1,
  'update: pero la fila de lectura anterior se conserva'
);

select tests.as_user('test-aj2e-emp1@example.com');
select is(
  (select read_at from public.v_my_announcements where id = 'f4200000-0000-0000-0000-0000000000a1'), null,
  'empleado 1: tras la corrección vuelve a figurar sin leer'
);
select is(
  (select was_edited from public.v_my_announcements where id = 'f4200000-0000-0000-0000-0000000000a1'), true,
  'empleado 1: was_edited avisa que se corrigió después de su lectura'
);
select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a1');
select is(
  (select was_edited from public.v_my_announcements where id = 'f4200000-0000-0000-0000-0000000000a1'), false,
  'empleado 1: al volver a dar «Entendido» queda al día'
);

-- Archivar
select tests.as_user('test-aj2e-owner@example.com');
select is(
  (select archived_at is not null from public.archive_announcement('f4200000-0000-0000-0000-0000000000a3')), true,
  'dueño: archiva un anuncio'
);
select is(
  (select archived_by::text from public.announcements where id = 'f4200000-0000-0000-0000-0000000000a3'),
  'f4200000-0000-0000-0000-000000000001', 'archive: registra quién lo archivó'
);
select lives_ok(
  $$select public.archive_announcement('f4200000-0000-0000-0000-0000000000a3')$$,
  'archive: es idempotente'
);
select throws_ok(
  $$select public.archive_announcement('f4200000-0000-0000-0000-00000000dead')$$,
  'P0001', 'No encontramos ese anuncio.', 'archive: anuncio inexistente'
);
select is(
  (select read_count from public.v_announcements_admin where id = 'f4200000-0000-0000-0000-0000000000a3'), 3,
  'archive: conserva las lecturas (se siguen contando para administración)'
);

select tests.as_user('test-aj2e-emp2@example.com');
select is(
  (select count(*)::int from public.v_my_announcements where id = 'f4200000-0000-0000-0000-0000000000a3'), 0,
  'archivado: deja de mostrarse a los destinatarios'
);
select throws_ok(
  $$select public.acknowledge_announcement('f4200000-0000-0000-0000-0000000000a3')$$,
  'P0001', 'Ese anuncio ya no está disponible para vos.', 'archivado: ya no se puede dar «Entendido»'
);

-- anon -------------------------------------------------------------------------------------------------

set local role anon;
select throws_ok($$select count(*) from public.announcements$$, '42501', null, 'anon: sin acceso a announcements');

select * from finish();

rollback;
