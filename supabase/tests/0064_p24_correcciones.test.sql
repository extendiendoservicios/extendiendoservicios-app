-- pgTAP de la migración 0064_p24_correcciones.sql (correcciones de P24, 24 oct 2026).
--   DEF-P24-01: corregir el fin de una jornada cerrada sola con una supervisión «Sin cerrar».
--     A. Corregir el fin a las 18:00: el fin automático de la supervisión acompaña (evento y
--        check_out), con traza; horas netas y duración recalculadas; segunda corrección.
--     B. Cancelar la supervisión «Sin cerrar» y después corregir.
--     C. Caso borde: la hora nueva antes del inicio de la supervisión (END_BEFORE_SUPERVISION_START).
--     D. El supervision_end que registró el coordinador no se corrige ni se mueve.
--     E. Descartar (el coordinador) la supervisión «Sin cerrar» y después corregir.
--   DEF-P24-02: v_supervisor_today trae site_radius_m y max_accuracy_m.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f6400000-...'. Todas las jornadas son de AYER (app.today() - 1) y los instantes
-- se arman con app.local_ts: nada depende de la hora del día en que corre el test.

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

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests.err_hint(p_sql text)
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

grant execute on function tests.err_hint(text) to authenticated, anon;

select plan(61);

-- ---------------------------------------------------------------------------------------------
-- 1. Estructura y privilegios
-- ---------------------------------------------------------------------------------------------

select has_function('app', 'remove_supervision_workday_events', array['uuid'], 'app.remove_supervision_workday_events(uuid)');
select has_function('app', 'supervisor_today', 'app.supervisor_today()');
select has_view('public', 'v_supervisor_today', 'existe v_supervisor_today');
select col_type_is('public', 'v_supervisor_today', 'site_radius_m', 'smallint', 'v_supervisor_today.site_radius_m es smallint');
select col_type_is('public', 'v_supervisor_today', 'max_accuracy_m', 'smallint', 'v_supervisor_today.max_accuracy_m es smallint');
select ok(
  not has_function_privilege('authenticated', 'app.remove_supervision_workday_events(uuid)', 'execute')
  and not has_function_privilege('anon', 'app.remove_supervision_workday_events(uuid)', 'execute'),
  'app.remove_supervision_workday_events no la ejecuta ni authenticated ni anon'
);
select ok(
  not has_function_privilege('anon', 'public.admin_correct_workday_event(uuid, text, timestamptz, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_correct_workday_event(uuid, text, timestamptz, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.cancel_supervision(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.cancel_supervision(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.discard_supervision(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.discard_supervision(uuid)', 'execute'),
  'los grants de admin_correct_workday_event, cancel_supervision y discard_supervision no cambiaron'
);
select ok(
  not has_function_privilege('anon', 'app.supervisor_today()', 'execute')
  and has_function_privilege('authenticated', 'app.supervisor_today()', 'execute')
  and has_table_privilege('authenticated', 'public.v_supervisor_today', 'select')
  and not has_table_privilege('anon', 'public.v_supervisor_today', 'select'),
  'los grants de app.supervisor_today y v_supervisor_today se conservan'
);

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('f6400000-0000-0000-0000-000000000001', 'Cliente de correcciones uno', 'active'),
  ('f6400000-0000-0000-0000-000000000002', 'Cliente de correcciones dos', 'active');

insert into public.sites (id, client_id, name, address, latitude, longitude, status, geofence_radius_m) values
  ('f6400000-0000-0000-0000-000000000011', 'f6400000-0000-0000-0000-000000000001', 'Sede con radio propio', 'Dirección 1', -34.6, -58.4, 'active', 300),
  ('f6400000-0000-0000-0000-000000000012', 'f6400000-0000-0000-0000-000000000002', 'Sede con radio general', 'Dirección 2', -34.7, -58.5, 'active', null);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f6400000-0000-0000-0000-000000000081', 'test-db064-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Correcciones')),
  ('f6400000-0000-0000-0000-000000000082', 'test-db064-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCapacidad')),
  ('f6400000-0000-0000-0000-000000000091', 'test-db064-sa@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'CorrigeFin')),
  ('f6400000-0000-0000-0000-000000000092', 'test-db064-sb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Cancelada')),
  ('f6400000-0000-0000-0000-000000000093', 'test-db064-sc@example.com', jsonb_build_object('first_name', 'Carla', 'last_name', 'CasoBorde')),
  ('f6400000-0000-0000-0000-000000000094', 'test-db064-sd@example.com', jsonb_build_object('first_name', 'Dario', 'last_name', 'FinPropio')),
  ('f6400000-0000-0000-0000-000000000095', 'test-db064-se@example.com', jsonb_build_object('first_name', 'Elena', 'last_name', 'Descartada'));

insert into public.user_roles (profile_id, role) values
  ('f6400000-0000-0000-0000-000000000081', 'owner'),
  ('f6400000-0000-0000-0000-000000000082', 'admin'),
  ('f6400000-0000-0000-0000-000000000091', 'supervisor'),
  ('f6400000-0000-0000-0000-000000000092', 'supervisor'),
  ('f6400000-0000-0000-0000-000000000093', 'supervisor'),
  ('f6400000-0000-0000-0000-000000000094', 'supervisor'),
  ('f6400000-0000-0000-0000-000000000095', 'supervisor');

insert into public.employees (profile_id, dni, status) values
  ('f6400000-0000-0000-0000-000000000091', '96400091', 'active'),
  ('f6400000-0000-0000-0000-000000000092', '96400092', 'active'),
  ('f6400000-0000-0000-0000-000000000093', '96400093', 'active'),
  ('f6400000-0000-0000-0000-000000000094', '96400094', 'active'),
  ('f6400000-0000-0000-0000-000000000095', '96400095', 'active');

-- Turnos: uno de ayer (donde se supervisa) y dos de hoy, en la sede con radio propio y en la
-- que usa el radio general (para v_supervisor_today).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f6400000-0000-0000-0000-000000000041', 'f6400000-0000-0000-0000-000000000001', 'f6400000-0000-0000-0000-000000000011', app.today() - 1, '08:00', '12:00', 1, 'in_progress'),
  ('f6400000-0000-0000-0000-000000000042', 'f6400000-0000-0000-0000-000000000001', 'f6400000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 1, 'in_progress'),
  ('f6400000-0000-0000-0000-000000000043', 'f6400000-0000-0000-0000-000000000002', 'f6400000-0000-0000-0000-000000000012', app.today(), '13:00', '17:00', 1, 'in_progress');

-- Jornadas de ayer. A, B, C y E quedan abiertas (las cierra el cierre automático); D la cerró el
-- propio coordinador (inicio 08:00, supervisión 10:00 a 11:00, fin 12:00).
insert into public.supervisor_workdays (id, supervisor_id, work_date, started_at, ended_at) values
  ('f6400000-0000-0000-0000-0000000000b1', 'f6400000-0000-0000-0000-000000000091', app.today() - 1, app.local_ts(app.today() - 1, '08:00'), null),
  ('f6400000-0000-0000-0000-0000000000b2', 'f6400000-0000-0000-0000-000000000092', app.today() - 1, app.local_ts(app.today() - 1, '08:00'), null),
  ('f6400000-0000-0000-0000-0000000000b3', 'f6400000-0000-0000-0000-000000000093', app.today() - 1, app.local_ts(app.today() - 1, '08:00'), null),
  ('f6400000-0000-0000-0000-0000000000b4', 'f6400000-0000-0000-0000-000000000094', app.today() - 1, app.local_ts(app.today() - 1, '08:00'), app.local_ts(app.today() - 1, '12:00')),
  ('f6400000-0000-0000-0000-0000000000b5', 'f6400000-0000-0000-0000-000000000095', app.today() - 1, app.local_ts(app.today() - 1, '08:00'), null);

insert into public.supervisor_workday_events (workday_id, kind, recorded_at, reason) values
  ('f6400000-0000-0000-0000-0000000000b1', 'start', app.local_ts(app.today() - 1, '08:00'), null),
  ('f6400000-0000-0000-0000-0000000000b2', 'start', app.local_ts(app.today() - 1, '08:00'), null),
  ('f6400000-0000-0000-0000-0000000000b3', 'start', app.local_ts(app.today() - 1, '08:00'), null),
  ('f6400000-0000-0000-0000-0000000000b4', 'start', app.local_ts(app.today() - 1, '08:00'), null),
  ('f6400000-0000-0000-0000-0000000000b5', 'start', app.local_ts(app.today() - 1, '08:00'), null);

insert into public.supervisions (id, shift_id, supervisor_id, status, workday_id) values
  ('f6400000-0000-0000-0000-0000000000c1', 'f6400000-0000-0000-0000-000000000041', 'f6400000-0000-0000-0000-000000000091', 'in_progress', 'f6400000-0000-0000-0000-0000000000b1'),
  ('f6400000-0000-0000-0000-0000000000c2', 'f6400000-0000-0000-0000-000000000041', 'f6400000-0000-0000-0000-000000000092', 'in_progress', 'f6400000-0000-0000-0000-0000000000b2'),
  ('f6400000-0000-0000-0000-0000000000c3', 'f6400000-0000-0000-0000-000000000041', 'f6400000-0000-0000-0000-000000000093', 'in_progress', 'f6400000-0000-0000-0000-0000000000b3'),
  ('f6400000-0000-0000-0000-0000000000c4', 'f6400000-0000-0000-0000-000000000041', 'f6400000-0000-0000-0000-000000000094', 'completed', 'f6400000-0000-0000-0000-0000000000b4'),
  ('f6400000-0000-0000-0000-0000000000c5', 'f6400000-0000-0000-0000-000000000041', 'f6400000-0000-0000-0000-000000000095', 'in_progress', 'f6400000-0000-0000-0000-0000000000b5');

insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('f6400000-0000-0000-0000-0000000000c1', 'check_in', app.local_ts(app.today() - 1, '10:00')),
  ('f6400000-0000-0000-0000-0000000000c2', 'check_in', app.local_ts(app.today() - 1, '10:00')),
  ('f6400000-0000-0000-0000-0000000000c3', 'check_in', app.local_ts(app.today() - 1, '10:00')),
  ('f6400000-0000-0000-0000-0000000000c4', 'check_in', app.local_ts(app.today() - 1, '10:00')),
  ('f6400000-0000-0000-0000-0000000000c4', 'check_out', app.local_ts(app.today() - 1, '11:00')),
  ('f6400000-0000-0000-0000-0000000000c5', 'check_in', app.local_ts(app.today() - 1, '10:00'));

insert into public.supervisor_workday_events (workday_id, kind, recorded_at, supervision_id) values
  ('f6400000-0000-0000-0000-0000000000b1', 'supervision_start', app.local_ts(app.today() - 1, '10:00'), 'f6400000-0000-0000-0000-0000000000c1'),
  ('f6400000-0000-0000-0000-0000000000b2', 'supervision_start', app.local_ts(app.today() - 1, '10:00'), 'f6400000-0000-0000-0000-0000000000c2'),
  ('f6400000-0000-0000-0000-0000000000b3', 'supervision_start', app.local_ts(app.today() - 1, '10:00'), 'f6400000-0000-0000-0000-0000000000c3'),
  ('f6400000-0000-0000-0000-0000000000b4', 'supervision_start', app.local_ts(app.today() - 1, '10:00'), 'f6400000-0000-0000-0000-0000000000c4'),
  ('f6400000-0000-0000-0000-0000000000b4', 'supervision_end', app.local_ts(app.today() - 1, '11:00'), 'f6400000-0000-0000-0000-0000000000c4'),
  ('f6400000-0000-0000-0000-0000000000b5', 'supervision_start', app.local_ts(app.today() - 1, '10:00'), 'f6400000-0000-0000-0000-0000000000c5');

insert into public.supervisor_workday_events (workday_id, kind, recorded_at, reason) values
  ('f6400000-0000-0000-0000-0000000000b4', 'end', app.local_ts(app.today() - 1, '12:00'), null);

-- Cierre automático de las jornadas abiertas de ayer: queda un supervision_end a las 23:55 en
-- cada una, con su supervisión «Sin cerrar».
select cmp_ok(
  app.auto_close_workdays(app.local_ts(app.today(), '00:30')), '>=', 4,
  'el cierre automático cierra las cuatro jornadas abiertas de ayer'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events
   where kind = 'supervision_end' and reason = 'Cierre automático'
     and workday_id in ('f6400000-0000-0000-0000-0000000000b1', 'f6400000-0000-0000-0000-0000000000b2',
                        'f6400000-0000-0000-0000-0000000000b3', 'f6400000-0000-0000-0000-0000000000b5')
     and recorded_at = app.local_ts(app.today() - 1, '23:55')),
  4,
  'cada jornada cerrada sola registró su supervision_end a las 23:55'
);

-- ---------------------------------------------------------------------------------------------
-- 2. DEF-P24-01 A: corregir el fin a las 18:00 con la supervisión «Sin cerrar» (Ana)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db064-owner@example.com');

select is(
  (select unclosed from public.v_supervisions_admin where id = 'f6400000-0000-0000-0000-0000000000c1'),
  true,
  'A: antes de corregir, la supervisión de Ana está «Sin cerrar»'
);
select is(
  (select duration_minutes from public.v_supervisions_admin where id = 'f6400000-0000-0000-0000-0000000000c1'),
  835,
  'A: antes de corregir, dura 10:00 a 23:55 = 835 minutos'
);
select is(
  tests.err_hint(format(
    $$select public.admin_correct_workday_event(%L, 'Prueba', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b1' and kind = 'supervision_end'),
    app.local_ts(app.today() - 1, '18:00')
  )),
  'EVENT_NOT_CORRECTABLE',
  'A: el fin automático de la supervisión no se corrige directamente (EVENT_NOT_CORRECTABLE)'
);
select is(
  tests.err_hint(format(
    $$select public.admin_correct_workday_event(%L, '', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b1' and kind = 'end'),
    app.local_ts(app.today() - 1, '18:00')
  )),
  'REASON_REQUIRED',
  'A: el motivo sigue siendo obligatorio'
);
select lives_ok(
  format(
    $$select public.admin_correct_workday_event(%L, 'Salió a las 18', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b1' and kind = 'end'),
    app.local_ts(app.today() - 1, '18:00')
  ),
  'A: el dueño lleva el fin de la jornada cerrada sola a las 18:00 aunque haya una supervisión sin cerrar'
);

select is(
  (select ended_at from public.supervisor_workdays where id = 'f6400000-0000-0000-0000-0000000000b1'),
  app.local_ts(app.today() - 1, '18:00'),
  'A: la jornada termina a las 18:00'
);
select is(
  (select recorded_at from public.supervisor_workday_events
   where workday_id = 'f6400000-0000-0000-0000-0000000000b1' and kind = 'supervision_end' and removed_at is null),
  app.local_ts(app.today() - 1, '18:00'),
  'A: el supervision_end automático se movió a las 18:00'
);
select is(
  (select recorded_at from public.supervision_attendance
   where supervision_id = 'f6400000-0000-0000-0000-0000000000c1' and kind = 'check_out'),
  app.local_ts(app.today() - 1, '18:00'),
  'A: el check_out de la supervisión también'
);
select ok(
  (select corrected_from = app.local_ts(app.today() - 1, '23:55')
          and corrected_by = 'f6400000-0000-0000-0000-000000000081'
          and corrected_at is not null
          and correction_reason = 'Salió a las 18'
   from public.supervisor_workday_events
   where workday_id = 'f6400000-0000-0000-0000-0000000000b1' and kind = 'supervision_end' and removed_at is null),
  'A: el supervision_end ajustado queda trazado (hora anterior, quién, cuándo y motivo)'
);
select is(
  (select count(*)::integer from public.security_events
   where event_type = 'workday_corrected' and target_id = 'f6400000-0000-0000-0000-000000000091'
     and details ->> 'workday_id' = 'f6400000-0000-0000-0000-0000000000b1'
     and jsonb_array_length(details -> 'adjusted_supervision_event_ids') = 1),
  1,
  'A: security_events registra la corrección con el evento de supervisión ajustado'
);
select is(
  (select worked_minutes from public.v_supervisor_workdays_admin where id = 'f6400000-0000-0000-0000-0000000000b1'),
  600,
  'A: v_supervisor_workdays_admin: horas netas 08:00 a 18:00 = 600 minutos'
);
select ok(
  (select corrected and not auto_close_warning and auto_closed
   from public.v_supervisor_workdays_admin where id = 'f6400000-0000-0000-0000-0000000000b1'),
  'A: la jornada queda corregida, sigue marcada como cerrada sola y sin la advertencia'
);
select is(
  (select (supervisions -> 0 ->> 'duration_minutes')::integer
   from public.v_supervisor_workdays_admin where id = 'f6400000-0000-0000-0000-0000000000b1'),
  480,
  'A: la supervisión dentro de la jornada dura 10:00 a 18:00 = 480 minutos'
);
select ok(
  (select duration_minutes = 480 and unclosed
   from public.v_supervisions_admin where id = 'f6400000-0000-0000-0000-0000000000c1'),
  'A: v_supervisions_admin: 480 minutos y sigue «Sin cerrar» (hay que cerrarla o cancelarla)'
);
select is(
  (select status::text from public.supervisions where id = 'f6400000-0000-0000-0000-0000000000c1'),
  'in_progress',
  'A: la corrección no cambia el estado de la supervisión'
);

-- Segunda corrección (a las 17:00): sigue acompañando y conserva la hora original en corrected_from.
select lives_ok(
  format(
    $$select public.admin_correct_workday_event(%L, 'Era a las 17', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b1' and kind = 'end'),
    app.local_ts(app.today() - 1, '17:00')
  ),
  'A: se puede volver a corregir el fin (17:00)'
);
select ok(
  (select recorded_at = app.local_ts(app.today() - 1, '17:00')
          and corrected_from = app.local_ts(app.today() - 1, '23:55')
          and correction_reason = 'Era a las 17'
   from public.supervisor_workday_events
   where workday_id = 'f6400000-0000-0000-0000-0000000000b1' and kind = 'supervision_end' and removed_at is null),
  'A: el supervision_end sigue al fin (17:00) y conserva la hora original en corrected_from'
);
select is(
  (select recorded_at from public.supervision_attendance
   where supervision_id = 'f6400000-0000-0000-0000-0000000000c1' and kind = 'check_out'),
  app.local_ts(app.today() - 1, '17:00'),
  'A: el check_out también sigue al fin'
);
-- El fin se puede llevar a cualquier hora válida del día: también después de las 23:55.
select lives_ok(
  format(
    $$select public.admin_correct_workday_event(%L, 'Se quedó hasta tarde', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b1' and kind = 'end'),
    app.local_ts(app.today() - 1, '23:58')
  ),
  'A: el fin también se puede llevar después de las 23:55 (23:58)'
);

select tests.as_user('test-db064-admin-sin@example.com');
select is(
  tests.err_hint(format(
    $$select public.admin_correct_workday_event(%L, 'Prueba', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b2' and kind = 'end'),
    app.local_ts(app.today() - 1, '18:00')
  )),
  'FORBIDDEN',
  'un administrador sin manage_attendance sigue sin poder corregir (FORBIDDEN)'
);

-- ---------------------------------------------------------------------------------------------
-- 3. DEF-P24-01 B: cancelar la supervisión «Sin cerrar» y después corregir (Beto)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db064-owner@example.com');

select lives_ok(
  $$select public.cancel_supervision('f6400000-0000-0000-0000-0000000000c2', 'Se cargó por error')$$,
  'B: el dueño cancela la supervisión «Sin cerrar»'
);
select is(
  (select status::text from public.supervisions where id = 'f6400000-0000-0000-0000-0000000000c2'),
  'cancelled',
  'B: la supervisión queda cancelada'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events
   where supervision_id = 'f6400000-0000-0000-0000-0000000000c2' and removed_at is null),
  0,
  'B: sus eventos de jornada (inicio y fin automático) quedan dados de baja'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events
   where supervision_id = 'f6400000-0000-0000-0000-0000000000c2' and removed_at is not null and removed_by is not null),
  2,
  'B: la baja es lógica y deja quién la hizo'
);
select lives_ok(
  format(
    $$select public.admin_correct_workday_event(%L, 'Salió a las 18', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b2' and kind = 'end'),
    app.local_ts(app.today() - 1, '18:00')
  ),
  'B: después de cancelar, la corrección a las 18:00 ya no se traba'
);
select is(
  (select worked_minutes from public.v_supervisor_workdays_admin where id = 'f6400000-0000-0000-0000-0000000000b2'),
  600,
  'B: horas netas 08:00 a 18:00 = 600 minutos'
);
select is(
  (select supervisions_count from public.v_supervisor_workdays_admin where id = 'f6400000-0000-0000-0000-0000000000b2'),
  0::bigint,
  'B: la supervisión cancelada no cuenta en la jornada'
);

-- ---------------------------------------------------------------------------------------------
-- 4. DEF-P24-01 C: caso borde, la hora nueva antes del inicio de la supervisión (Carla)
-- ---------------------------------------------------------------------------------------------

select is(
  tests.err_hint(format(
    $$select public.admin_correct_workday_event(%L, 'Prueba', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b3' and kind = 'end'),
    app.local_ts(app.today() - 1, '09:30')
  )),
  'END_BEFORE_SUPERVISION_START',
  'C: llevar el fin a las 09:30, antes del inicio de la supervisión (10:00), da END_BEFORE_SUPERVISION_START'
);
select ok(
  (select w.ended_at = app.local_ts(app.today() - 1, '23:55') and not w.corrected
   from public.supervisor_workdays w where w.id = 'f6400000-0000-0000-0000-0000000000b3')
  and (select e.recorded_at = app.local_ts(app.today() - 1, '23:55') and e.corrected_from is null
       from public.supervisor_workday_events e
       where e.workday_id = 'f6400000-0000-0000-0000-0000000000b3' and e.kind = 'supervision_end'),
  'C: el rechazo no cambia nada (ni la jornada ni el fin automático)'
);
select lives_ok(
  format(
    $$select public.admin_correct_workday_event(%L, 'Justo al inicio', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b3' and kind = 'end'),
    app.local_ts(app.today() - 1, '10:00')
  ),
  'C: llevar el fin justo al inicio de la supervisión (10:00) se acepta'
);
select is(
  (select duration_minutes from public.v_supervisions_admin where id = 'f6400000-0000-0000-0000-0000000000c3'),
  0,
  'C: en ese caso la supervisión dura 0 minutos'
);
-- Y cancelando la supervisión antes, la hora de las 09:30 sí se acepta.
select lives_ok(
  $$select public.cancel_supervision('f6400000-0000-0000-0000-0000000000c3', 'Cancelada antes de corregir')$$,
  'C: se cancela la supervisión'
);
select lives_ok(
  format(
    $$select public.admin_correct_workday_event(%L, 'Salió temprano', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b3' and kind = 'end'),
    app.local_ts(app.today() - 1, '09:30')
  ),
  'C: cancelada la supervisión, el fin se puede llevar a las 09:30'
);

-- ---------------------------------------------------------------------------------------------
-- 5. DEF-P24-01 D: el fin que registró el coordinador no se corrige ni se mueve (Dario)
-- ---------------------------------------------------------------------------------------------

select is(
  tests.err_hint(format(
    $$select public.admin_correct_workday_event(%L, 'Prueba', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b4' and kind = 'supervision_end'),
    app.local_ts(app.today() - 1, '11:30')
  )),
  'EVENT_NOT_CORRECTABLE',
  'D: el supervision_end que registró el coordinador no se corrige (EVENT_NOT_CORRECTABLE)'
);
select is(
  tests.err_hint(format(
    $$select public.admin_correct_workday_event(%L, 'Prueba', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b4' and kind = 'supervision_start'),
    app.local_ts(app.today() - 1, '09:30')
  )),
  'EVENT_NOT_CORRECTABLE',
  'D: tampoco el supervision_start'
);
select is(
  tests.err_hint(format(
    $$select public.admin_correct_workday_event(%L, 'Prueba', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b4' and kind = 'end'),
    app.local_ts(app.today() - 1, '10:30')
  )),
  'INVALID_EVENT_ORDER',
  'D: el fin no puede quedar antes del fin de supervisión que registró el coordinador (INVALID_EVENT_ORDER)'
);
select lives_ok(
  format(
    $$select public.admin_correct_workday_event(%L, 'Salió a la 1', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b4' and kind = 'end'),
    app.local_ts(app.today() - 1, '13:00')
  ),
  'D: el fin se puede llevar a las 13:00'
);
select ok(
  (select e.recorded_at = app.local_ts(app.today() - 1, '11:00') and e.corrected_from is null and e.correction_reason is null
   from public.supervisor_workday_events e
   where e.workday_id = 'f6400000-0000-0000-0000-0000000000b4' and e.kind = 'supervision_end')
  and (select sa.recorded_at = app.local_ts(app.today() - 1, '11:00')
       from public.supervision_attendance sa
       where sa.supervision_id = 'f6400000-0000-0000-0000-0000000000c4' and sa.kind = 'check_out'),
  'D: el supervision_end del coordinador y su check_out quedan intactos'
);
select is(
  (select worked_minutes from public.v_supervisor_workdays_admin where id = 'f6400000-0000-0000-0000-0000000000b4'),
  300,
  'D: horas netas 08:00 a 13:00 = 300 minutos'
);

-- ---------------------------------------------------------------------------------------------
-- 6. DEF-P24-01 E: el coordinador descarta la supervisión «Sin cerrar» y después se corrige (Elena)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db064-se@example.com');
select lives_ok(
  $$select public.discard_supervision('f6400000-0000-0000-0000-0000000000c5')$$,
  'E: la coordinadora descarta su supervisión «Sin cerrar»'
);

select tests.as_user('test-db064-owner@example.com');
select is(
  (select count(*)::integer from public.supervisor_workday_events
   where supervision_id = 'f6400000-0000-0000-0000-0000000000c5' and removed_at is null),
  0,
  'E: descartar también da de baja el fin automático'
);
select lives_ok(
  format(
    $$select public.admin_correct_workday_event(%L, 'Salió a las 18', %L)$$,
    (select id from public.supervisor_workday_events
     where workday_id = 'f6400000-0000-0000-0000-0000000000b5' and kind = 'end'),
    app.local_ts(app.today() - 1, '18:00')
  ),
  'E: después de descartar, la corrección a las 18:00 funciona'
);

-- Un fin que no es de cierre automático no mueve eventos ajenos: un fin con otro motivo.
select is(
  (select count(*)::integer from public.supervisor_workday_events
   where workday_id in ('f6400000-0000-0000-0000-0000000000b1', 'f6400000-0000-0000-0000-0000000000b2')
     and kind = 'supervision_end' and removed_at is null),
  1,
  'solo queda vigente el supervision_end de la supervisión de Ana (la de Beto se canceló)'
);

-- ---------------------------------------------------------------------------------------------
-- 7. DEF-P24-02: v_supervisor_today trae site_radius_m y max_accuracy_m
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db064-sa@example.com');

select is(
  (select site_radius_m from public.v_supervisor_today where shift_id = 'f6400000-0000-0000-0000-000000000042'),
  300::smallint,
  'SUP-03: el turno de la sede con radio propio trae ese radio (300)'
);
select is(
  (select site_radius_m from public.v_supervisor_today where shift_id = 'f6400000-0000-0000-0000-000000000043'),
  (select geofence_radius_m from public.company_settings where id = 1),
  'SUP-03: el turno de la sede sin radio propio trae el radio general de la empresa'
);
select is(
  (select max_accuracy_m from public.v_supervisor_today where shift_id = 'f6400000-0000-0000-0000-000000000042'),
  (select geofence_max_accuracy_m from public.company_settings where id = 1),
  'SUP-03: max_accuracy_m es la precisión máxima de la empresa'
);
select is(
  (select max_accuracy_m from public.v_supervisor_today where shift_id = 'f6400000-0000-0000-0000-000000000043'),
  (select geofence_max_accuracy_m from public.company_settings where id = 1),
  'SUP-03: max_accuracy_m es el mismo en todos los turnos'
);
select is(
  (select count(*)::integer from public.v_supervisor_today where shift_id in ('f6400000-0000-0000-0000-000000000042', 'f6400000-0000-0000-0000-000000000043')),
  2,
  'SUP-03: el coordinador sigue viendo los turnos de hoy de todas las sedes'
);
select is(
  (select count(*)::integer from public.v_supervisor_today
   where site_radius_m is null or max_accuracy_m is null),
  0,
  'SUP-03: ningún turno de hoy viene sin radio ni precisión máxima'
);

select tests.as_user('test-db064-owner@example.com');
select is(
  (select count(*)::integer from public.v_supervisor_today),
  0,
  'el dueño (sin rol de coordinador) no ve filas en v_supervisor_today'
);

set local role postgres;
-- Un cambio en el ajuste general se refleja en la vista.
update public.company_settings set geofence_max_accuracy_m = 77 where id = 1;
select tests.as_user('test-db064-sa@example.com');
select is(
  (select max_accuracy_m from public.v_supervisor_today where shift_id = 'f6400000-0000-0000-0000-000000000043'),
  77::smallint,
  'SUP-03: si cambia la precisión máxima de la empresa, la vista lo refleja'
);

select * from finish();

rollback;
