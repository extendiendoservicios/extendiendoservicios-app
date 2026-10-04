-- pgTAP de la migración 0030_p18_6_permisos_y_rendimiento.sql (P18.6): una prueba por defecto
-- corregido (DEF-01, DEF-03, DEF-P01, P03 a P13, SEG-02, SEG-03) más el contrapeso de lo que NO
-- tiene que dejar de funcionar (la propia fila, el nombre de los compañeros, las supervisiones).
--
-- Convención (supabase/tests/README.md): una sola transacción que termina en `rollback`; las
-- personas, el cliente, la sede y los turnos se crean acá con el prefijo 'e3000000-...'; no
-- depende del seed ni de otros tests.

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

select plan(91);

-- ---------------------------------------------------------------------------------------------
-- 0. Estructura nueva -----------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

select has_function('app', 'people_basic', 'existe app.people_basic()');
select has_function('app', 'clients_basic', 'existe app.clients_basic()');
select has_function('app', 'shift_peers', 'existe app.shift_peers()');
select has_function('app', 'my_shift_ids', 'existe app.my_shift_ids()');
select has_view('public', 'v_clients_basic', 'existe v_clients_basic');
select has_view('public', 'v_shift_peers', 'existe v_shift_peers');
select ok(
  (select bool_and('security_invoker=true' = any(c.reloptions))
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('v_people_basic', 'v_clients_basic', 'v_shift_peers', 'v_my_day', 'v_my_supervisions')),
  'las vistas recortadas y v_my_day / v_my_supervisions son security_invoker = true'
);
select hasnt_column('public', 'v_clients_basic', 'cuit', 'v_clients_basic no expone cuit');
select hasnt_column('public', 'v_clients_basic', 'notes', 'v_clients_basic no expone notes');
select hasnt_column('public', 'v_shift_peers', 'notes', 'v_shift_peers no expone la observación');
select hasnt_column('public', 'v_people_basic', 'phone', 'v_people_basic no expone teléfono');
select has_trigger('public', 'profiles', 'trg_enforce_profile_admin_update_rules', 'profiles tiene la regla de quién edita a quién');
select has_trigger('public', 'company_settings', 'trg_enforce_company_settings_columns', 'company_settings tiene la regla de columnas');
select ok(
  exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'security_event_type' and e.enumlabel = 'admin_action_rejected'
  ),
  'SEG-03: security_event_type tiene admin_action_rejected'
);
select ok(
  not has_function_privilege('anon', 'app.people_basic()', 'execute')
    and has_function_privilege('authenticated', 'app.people_basic()', 'execute'),
  'las funciones de conjuntos: execute solo para authenticated, no para anon'
);

-- ---------------------------------------------------------------------------------------------
-- Fixtures ------------------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('e3000000-0000-0000-0000-000000000001', 'test-db030-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Treinta')),
  ('e3000000-0000-0000-0000-000000000002', 'test-db030-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCapacidades')),
  ('e3000000-0000-0000-0000-000000000003', 'test-db030-admin-full@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConManageUsers')),
  ('e3000000-0000-0000-0000-000000000004', 'test-db030-sup@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Uno')),
  ('e3000000-0000-0000-0000-000000000005', 'test-db030-emp1@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Uno')),
  ('e3000000-0000-0000-0000-000000000006', 'test-db030-emp2@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Dos')),
  ('e3000000-0000-0000-0000-000000000007', 'test-db030-emp3@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Tres')),
  ('e3000000-0000-0000-0000-000000000008', 'test-db030-emp-baja@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Baja')),
  ('e3000000-0000-0000-0000-000000000009', 'test-db030-admin-otro@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Otro')),
  ('e3000000-0000-0000-0000-00000000000a', 'test-db030-owner2@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Segundo'));

insert into public.user_roles (profile_id, role) values
  ('e3000000-0000-0000-0000-000000000001', 'owner'),
  ('e3000000-0000-0000-0000-000000000002', 'admin'),
  ('e3000000-0000-0000-0000-000000000003', 'admin'),
  ('e3000000-0000-0000-0000-000000000004', 'supervisor'),
  ('e3000000-0000-0000-0000-000000000005', 'employee'),
  ('e3000000-0000-0000-0000-000000000006', 'employee'),
  ('e3000000-0000-0000-0000-000000000007', 'employee'),
  ('e3000000-0000-0000-0000-000000000008', 'employee'),
  ('e3000000-0000-0000-0000-000000000009', 'admin'),
  ('e3000000-0000-0000-0000-00000000000a', 'owner');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e3000000-0000-0000-0000-000000000003', 'manage_users', true);

insert into public.employees (profile_id, dni, cuil, address, emergency_contact_phone) values
  ('e3000000-0000-0000-0000-000000000004', '93000004', '20930000004', 'Domicilio Sup 1', '1100000004'),
  ('e3000000-0000-0000-0000-000000000005', '93000005', '20930000005', 'Domicilio Emp 1', '1100000005'),
  ('e3000000-0000-0000-0000-000000000006', '93000006', '20930000006', 'Domicilio Emp 2', '1100000006'),
  ('e3000000-0000-0000-0000-000000000007', '93000007', '20930000007', 'Domicilio Emp 3', '1100000007'),
  ('e3000000-0000-0000-0000-000000000008', '93000008', '20930000008', 'Domicilio Emp Baja', '1100000008');

update public.profiles set phone = '1155000005', contact_email = 'emp1-contacto@example.com' where id = 'e3000000-0000-0000-0000-000000000005';
update public.profiles set phone = '1155000006', contact_email = 'emp2-contacto@example.com' where id = 'e3000000-0000-0000-0000-000000000006';
update public.profiles set last_seen_changes_at = now() - interval '1 hour'
  where id in ('e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000007');

insert into public.clients (id, legal_name, trade_name, cuit, admin_address, notes, status) values
  ('e3000000-0000-0000-0000-000000000101', 'Cliente P18.6 S.A.', 'Cliente Treinta', '30930001011', 'Domicilio administrativo secreto', 'Notas internas del cliente', 'active');
insert into public.sites (id, client_id, name, address, status) values
  ('e3000000-0000-0000-0000-000000000111', 'e3000000-0000-0000-0000-000000000101', 'Sede P18.6', 'Calle 30', 'active');

-- Turno A (mañana 10-11, dos personas) y turno C (mañana 12-13, la persona 1) para la prueba de
-- superposición; turno B (pasado mañana) lo cancela el dueño. created_at dos horas atrás: el
-- único cambio bajo prueba es el que se hace después.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, created_at) values
  ('e3000000-0000-0000-0000-000000000201', 'e3000000-0000-0000-0000-000000000101', 'e3000000-0000-0000-0000-000000000111', app.today() + 1, '10:00', '11:00', 2, 'assigned', now() - interval '2 hours'),
  ('e3000000-0000-0000-0000-000000000202', 'e3000000-0000-0000-0000-000000000101', 'e3000000-0000-0000-0000-000000000111', app.today() + 2, '10:00', '11:00', 1, 'assigned', now() - interval '2 hours'),
  ('e3000000-0000-0000-0000-000000000203', 'e3000000-0000-0000-0000-000000000101', 'e3000000-0000-0000-0000-000000000111', app.today() + 1, '12:00', '13:00', 1, 'assigned', now() - interval '2 hours');

insert into public.assignments (id, shift_id, employee_id, notes, created_at) values
  ('e3000000-0000-0000-0000-000000000301', 'e3000000-0000-0000-0000-000000000201', 'e3000000-0000-0000-0000-000000000005', 'Observación privada de Emp Uno', now() - interval '2 hours'),
  ('e3000000-0000-0000-0000-000000000302', 'e3000000-0000-0000-0000-000000000201', 'e3000000-0000-0000-0000-000000000006', 'Observación privada de Emp Dos', now() - interval '2 hours'),
  ('e3000000-0000-0000-0000-000000000303', 'e3000000-0000-0000-0000-000000000202', 'e3000000-0000-0000-0000-000000000007', null, now() - interval '2 hours'),
  ('e3000000-0000-0000-0000-000000000304', 'e3000000-0000-0000-0000-000000000203', 'e3000000-0000-0000-0000-000000000005', null, now() - interval '2 hours');

insert into public.shift_tasks (shift_id, position, title, is_required) values
  ('e3000000-0000-0000-0000-000000000201', 1, 'Tarea A1', true),
  ('e3000000-0000-0000-0000-000000000201', 2, 'Tarea A2', false),
  ('e3000000-0000-0000-0000-000000000202', 1, 'Tarea B1', true);

insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e3000000-0000-0000-0000-000000000401', 'e3000000-0000-0000-0000-000000000201', 'e3000000-0000-0000-0000-000000000004', 'assigned');

insert into public.company_settings (id, name, support_phone, location_consent_text)
values (1, 'Empresa de prueba', '+54 11 5555-0000', 'Texto de consentimiento')
on conflict (id) do update set name = excluded.name;

insert into public.holidays (id, holiday_date, name) values
  ('e3000000-0000-0000-0000-000000000501', date '2099-01-01', 'Feriado de prueba P18.6');

insert into storage.objects (bucket_id, name) values
  ('avatars', 'e3000000-0000-0000-0000-000000000005/avatar.jpg'),
  ('avatars', 'e3000000-0000-0000-0000-000000000006/avatar.jpg');

-- ---------------------------------------------------------------------------------------------
-- 1. DEF-01: el empleado ve el turno cancelado en Hoy (P-049, CB-03) -----------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db030-emp3@example.com');
select is(
  (select count(*)::int from public.v_my_day where assignment_id = 'e3000000-0000-0000-0000-000000000303'),
  1,
  'DEF-01: antes de cancelar, el turno aparece en Hoy'
);
select ok(
  not (select changed_since_last_seen from public.v_my_day where assignment_id = 'e3000000-0000-0000-0000-000000000303'),
  'DEF-01: sin cambios ajenos, el indicador de cambios está apagado'
);

select tests.as_user('test-db030-owner@example.com');
select lives_ok(
  $$select public.cancel_shift('e3000000-0000-0000-0000-000000000202', 'Cancelado por la prueba de P18.6')$$,
  'el dueño cancela el turno B'
);

select tests.as_user('test-db030-emp3@example.com');
select is(
  (select shift_status::text from public.v_my_day where assignment_id = 'e3000000-0000-0000-0000-000000000303'),
  'cancelled',
  'DEF-01: el turno cancelado SIGUE en Hoy, con shift_status = cancelled'
);
select ok(
  (select changed_since_last_seen from public.v_my_day where assignment_id = 'e3000000-0000-0000-0000-000000000303'),
  'DEF-01: la cancelación enciende "cambios desde tu última visita" (cambio ajeno)'
);
select is(
  (select client_legal_name from public.v_my_day where assignment_id = 'e3000000-0000-0000-0000-000000000303'),
  'Cliente P18.6 S.A.',
  'v_my_day sigue mostrando el nombre del cliente (ahora desde v_clients_basic)'
);

-- ---------------------------------------------------------------------------------------------
-- 2. DEF-03: el mensaje de superposición nombra al empleado (CB-10) -------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db030-admin-full@example.com');
prepare p30_overlap as select public.update_shift_time('e3000000-0000-0000-0000-000000000203', '10:30'::time, '13:00'::time);
select throws_ok(
  'p30_overlap',
  'P0001',
  'El empleado ya tiene otro turno en ese horario. Afecta a: Emp Uno.',
  'DEF-03: update_shift_time que pisa otro turno nombra al empleado afectado'
);
select is(
  (select start_time::text from public.shifts where id = 'e3000000-0000-0000-0000-000000000203'),
  '12:00:00',
  'DEF-03: el cambio rechazado no se aplicó'
);

-- ---------------------------------------------------------------------------------------------
-- 3. DEF-P13: quién puede desactivar o editar a quién ---------------------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db030-admin-sin@example.com');
prepare p30_sin_baja_emp as update public.profiles set is_active = false where id = 'e3000000-0000-0000-0000-000000000006';
select throws_ok('p30_sin_baja_emp', 'P0001', 'No tenés permiso para hacer esto.',
  'DEF-P13: un administrador sin manage_users no desactiva a un empleado');
prepare p30_sin_baja_owner as update public.profiles set is_active = false where id = 'e3000000-0000-0000-0000-000000000001';
select throws_ok('p30_sin_baja_owner', 'P0001', 'Solo el dueño puede modificar a un dueño o a un administrador.',
  'DEF-P13: un administrador no desactiva al dueño');
prepare p30_sin_baja_admin as update public.profiles set is_active = false where id = 'e3000000-0000-0000-0000-000000000009';
select throws_ok('p30_sin_baja_admin', 'P0001', 'Solo el dueño puede modificar a un dueño o a un administrador.',
  'DEF-P13: un administrador no desactiva a otro administrador');
select lives_ok(
  $$update public.profiles set phone = '1100000099' where id = 'e3000000-0000-0000-0000-000000000006'$$,
  'un administrador SIN capacidades sí edita el teléfono de un empleado (03 sección 6: editar datos de empleados)'
);
select lives_ok(
  $$update public.profiles set first_name = 'Emp', last_name = 'Dos' where id = 'e3000000-0000-0000-0000-000000000006'$$,
  'un administrador edita el nombre de un empleado'
);
prepare p30_sin_edita_admin as update public.profiles set phone = '1100000098' where id = 'e3000000-0000-0000-0000-000000000009';
select throws_ok('p30_sin_edita_admin', 'P0001', 'Solo el dueño puede modificar a un dueño o a un administrador.',
  'DEF-P13: un administrador no edita los datos de otro administrador');
prepare p30_sin_consent as update public.profiles set location_consent_at = now() where id = 'e3000000-0000-0000-0000-000000000006';
select throws_ok('p30_sin_consent', 'P0001', 'Ese dato lo edita solo la propia persona.',
  'DEF-P13: el consentimiento de ubicación de otra persona no se edita');
prepare p30_sin_propio as update public.profiles set is_active = false where id = 'e3000000-0000-0000-0000-000000000002';
select throws_ok('p30_sin_propio', 'P0001', 'No podés desactivar ni reactivar tu propia cuenta.',
  'DEF-P13: nadie se desactiva a sí mismo por esta vía');

select tests.as_user('test-db030-admin-full@example.com');
select lives_ok(
  $$update public.profiles set is_active = false, deleted_at = now() where id = 'e3000000-0000-0000-0000-000000000006'$$,
  'DEF-P13: un administrador CON manage_users desactiva a un empleado'
);
prepare p30_full_baja_admin as update public.profiles set is_active = false where id = 'e3000000-0000-0000-0000-000000000009';
select throws_ok('p30_full_baja_admin', 'P0001', 'Solo el dueño puede modificar a un dueño o a un administrador.',
  'DEF-P13: ni con manage_users desactiva a un administrador');
prepare p30_full_reactiva as update public.profiles set is_active = true, deleted_at = null where id = 'e3000000-0000-0000-0000-000000000006';
select throws_ok('p30_full_reactiva', 'P0001', 'Solo el dueño puede reactivar una cuenta.',
  'DEF-P13: reactivar una cuenta es solo del dueño');

select tests.as_user('test-db030-owner@example.com');
select lives_ok(
  $$update public.profiles set is_active = true, deleted_at = null where id = 'e3000000-0000-0000-0000-000000000006'$$,
  'DEF-P13: el dueño reactiva una cuenta'
);
select lives_ok(
  $$update public.profiles set is_active = false, deleted_at = now() where id = 'e3000000-0000-0000-0000-000000000009'$$,
  'DEF-P13: el dueño desactiva a un administrador'
);
select lives_ok(
  $$update public.profiles set is_active = false, deleted_at = now() where id = 'e3000000-0000-0000-0000-00000000000a'$$,
  'DEF-P13: el dueño desactiva a otro dueño mientras queda un dueño activo (él mismo)'
);
prepare p30_owner_propio as update public.profiles set is_active = false where id = 'e3000000-0000-0000-0000-000000000001';
select throws_ok('p30_owner_propio', 'P0001', 'No podés desactivar ni reactivar tu propia cuenta.',
  'DEF-P13: ni el dueño se desactiva a sí mismo por esta vía');

select tests.as_user('test-db030-emp1@example.com');
select lives_ok(
  $$update public.profiles set phone = '1155000077' where id = 'e3000000-0000-0000-0000-000000000005'$$,
  'la propia persona sigue editando su teléfono'
);

-- ---------------------------------------------------------------------------------------------
-- 4. DEF-P01: el administrador solo cambia el logo -------------------------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db030-admin-full@example.com');
select lives_ok(
  $$update public.company_settings set logo_path = 'logo.png', updated_by = 'e3000000-0000-0000-0000-000000000003' where id = 1$$,
  'DEF-P01: el administrador sube el logo'
);
prepare p30_cs_phone as update public.company_settings set support_phone = '+54 11 0000-0000' where id = 1;
select throws_ok('p30_cs_phone', 'P0001', 'Solo el dueño puede cambiar el nombre, el teléfono y el consentimiento. Podés cambiar el logo.',
  'DEF-P01: el administrador no cambia el teléfono de soporte');
prepare p30_cs_consent as update public.company_settings set location_consent_text = 'otro texto' where id = 1;
select throws_ok('p30_cs_consent', 'P0001', 'Solo el dueño puede cambiar el nombre, el teléfono y el consentimiento. Podés cambiar el logo.',
  'DEF-P01: el administrador no cambia el texto de consentimiento');
prepare p30_cs_name as update public.company_settings set name = 'Otro nombre' where id = 1;
select throws_ok('p30_cs_name', 'P0001', 'Solo el dueño puede cambiar el nombre, el teléfono y el consentimiento. Podés cambiar el logo.',
  'DEF-P01: el administrador no cambia el nombre de la empresa');

select tests.as_user('test-db030-owner@example.com');
select lives_ok(
  $$update public.company_settings set support_phone = '+54 11 1111-1111', location_consent_text = 'Texto nuevo', name = 'Empresa nueva' where id = 1$$,
  'DEF-P01: el dueño sí cambia teléfono, consentimiento y nombre'
);

-- ---------------------------------------------------------------------------------------------
-- 5. DEF-P03: teléfono y email de contacto de compañeros ----------------------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db030-emp1@example.com');
select is_empty(
  $$select phone, contact_email from public.profiles where id = 'e3000000-0000-0000-0000-000000000006'$$,
  'DEF-P03: el empleado no lee la fila de profiles de un compañero (teléfono y email)'
);
select is(
  (select count(*)::int from public.profiles where id = 'e3000000-0000-0000-0000-000000000005'),
  1,
  'el empleado sí lee su propia fila de profiles'
);
select is(
  (select first_name || ' ' || last_name from public.v_people_basic where profile_id = 'e3000000-0000-0000-0000-000000000006'),
  'Emp Dos',
  'DEF-P03: el nombre del compañero se lee por v_people_basic'
);
select is(
  (select array_agg(profile_id order by profile_id) from public.v_people_basic),
  array['e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000006']::uuid[],
  'v_people_basic del empleado: él y su compañero de turno, nadie más'
);

select tests.as_user('test-db030-sup@example.com');
select is_empty(
  $$select phone, contact_email from public.profiles where id = 'e3000000-0000-0000-0000-000000000005'$$,
  'DEF-P03: el supervisor no lee la fila de profiles de un empleado de su turno'
);
select is(
  (select array_agg(profile_id order by profile_id) from public.v_people_basic),
  array['e3000000-0000-0000-0000-000000000004', 'e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000006']::uuid[],
  'v_people_basic del supervisor: él y los empleados de su turno'
);
select is(
  (select jsonb_array_length(assigned_employees) from public.v_my_supervisions where id = 'e3000000-0000-0000-0000-000000000401'),
  2,
  'v_my_supervisions sigue listando a los dos empleados del turno supervisado'
);
select is(
  (select assigned_employees -> 0 ->> 'last_name' from public.v_my_supervisions where id = 'e3000000-0000-0000-0000-000000000401'),
  'Dos',
  'v_my_supervisions: el nombre de los empleados viene de v_people_basic'
);

select tests.as_user('test-db030-admin-sin@example.com');
select is(
  (select count(*)::int from public.v_people_basic where profile_id in (
    'e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000006', 'e3000000-0000-0000-0000-000000000007')),
  3,
  'el administrador ve a todos en v_people_basic'
);
select is(
  (select count(*)::int from public.profiles where id in (
    'e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000006', 'e3000000-0000-0000-0000-000000000007')),
  3,
  'el administrador sigue leyendo profiles completos'
);

-- ---------------------------------------------------------------------------------------------
-- 6. DEF-P04: el supervisor no lee datos personales del empleado ------------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db030-sup@example.com');
select is_empty(
  $$select dni, cuil, address, emergency_contact_phone from public.employees where profile_id = 'e3000000-0000-0000-0000-000000000005'$$,
  'DEF-P04: el supervisor no lee employees (DNI, CUIL, domicilio, contacto de emergencia)'
);
select is_empty(
  $$select dni, cuil, address, emergency_contact_phone from public.v_employees where profile_id = 'e3000000-0000-0000-0000-000000000005'$$,
  'DEF-P04: el supervisor no lee v_employees de un empleado'
);
select is(
  (select count(*)::int from public.employees where profile_id = 'e3000000-0000-0000-0000-000000000004'),
  1,
  'el supervisor sí lee su propia ficha de employees'
);

select tests.as_user('test-db030-emp1@example.com');
select is(
  (select count(*)::int from public.employees),
  1,
  'el empleado sigue leyendo solo su propia ficha'
);

select tests.as_user('test-db030-admin-sin@example.com');
select is(
  (select count(*)::int from public.employees where profile_id in (
    'e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000006')),
  2,
  'el administrador sigue leyendo employees completo'
);

-- ---------------------------------------------------------------------------------------------
-- 7. DEF-P05: el empleado lee solo el nombre del cliente ---------------------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db030-emp1@example.com');
select is_empty(
  $$select cuit, admin_address, notes from public.clients where id = 'e3000000-0000-0000-0000-000000000101'$$,
  'DEF-P05: el empleado no lee la tabla clients (CUIT, domicilio administrativo, notas)'
);
select is_empty(
  $$select cuit from public.v_clients where id = 'e3000000-0000-0000-0000-000000000101'$$,
  'DEF-P05: el empleado no lee v_clients'
);
select is(
  (select legal_name || ' / ' || trade_name from public.v_clients_basic where id = 'e3000000-0000-0000-0000-000000000101'),
  'Cliente P18.6 S.A. / Cliente Treinta',
  'DEF-P05: el empleado lee el nombre del cliente de su turno por v_clients_basic'
);
select is(
  (select count(*)::int from public.sites where id = 'e3000000-0000-0000-0000-000000000111'),
  1,
  'el empleado sigue leyendo la sede de su turno'
);

select tests.as_user('test-db030-sup@example.com');
select is(
  (select cuit from public.clients where id = 'e3000000-0000-0000-0000-000000000101'),
  '30930001011',
  'el supervisor sigue leyendo el cliente de su turno (03 sección 6)'
);

-- ---------------------------------------------------------------------------------------------
-- 8. DEF-P06: la observación de los compañeros ---------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db030-emp1@example.com');
select is_empty(
  $$select notes from public.assignments where id = 'e3000000-0000-0000-0000-000000000302'$$,
  'DEF-P06: el empleado no lee la asignación (observación) de un compañero'
);
select is(
  (select notes from public.assignments where id = 'e3000000-0000-0000-0000-000000000301'),
  'Observación privada de Emp Uno',
  'el empleado sí lee su propia asignación con su observación'
);
select is(
  (select count(*)::int from public.assignments),
  2,
  'el empleado ve sus dos asignaciones propias y ninguna ajena'
);
select is(
  (select array_agg(profile_id order by profile_id) from public.v_shift_peers where shift_id = 'e3000000-0000-0000-0000-000000000201'),
  array['e3000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000006']::uuid[],
  'v_shift_peers: los dos del turno A (él y su compañero)'
);
select is_empty(
  $$select 1 from public.v_shift_peers where shift_id = 'e3000000-0000-0000-0000-000000000202'$$,
  'v_shift_peers: nada de un turno que no comparte'
);

select tests.as_user('test-db030-sup@example.com');
select is(
  (select notes from public.assignments where id = 'e3000000-0000-0000-0000-000000000302'),
  'Observación privada de Emp Dos',
  'el supervisor del turno sí lee la observación (P-062)'
);

-- ---------------------------------------------------------------------------------------------
-- 9. DEF-P02: rendimiento -- las políticas por turno devuelven lo mismo que antes -------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db030-emp1@example.com');
select is(
  (select count(*)::int from public.shift_tasks),
  2,
  'DEF-P02: el empleado lee las tareas de su turno (2) y de ningún otro'
);
select is(
  (select count(*)::int from public.shifts where id in (
    'e3000000-0000-0000-0000-000000000201', 'e3000000-0000-0000-0000-000000000202', 'e3000000-0000-0000-0000-000000000203')),
  2,
  'el empleado lee sus dos turnos (A y C) y no el B'
);
select tests.as_user('test-db030-sup@example.com');
select is(
  (select count(*)::int from public.shift_tasks),
  2,
  'DEF-P02: el supervisor lee las tareas del turno que supervisa'
);
select is(
  (select count(*)::int from public.shifts where id in (
    'e3000000-0000-0000-0000-000000000201', 'e3000000-0000-0000-0000-000000000202', 'e3000000-0000-0000-0000-000000000203')),
  1,
  'el supervisor lee solo el turno que supervisa'
);
select tests.as_user('test-db030-emp3@example.com');
select is(
  (select count(*)::int from public.shift_tasks),
  1,
  'el otro empleado lee solo las tareas de su turno'
);
select tests.as_user('test-db030-admin-sin@example.com');
select is(
  (select count(*)::int from public.shift_tasks where shift_id in (
    'e3000000-0000-0000-0000-000000000201', 'e3000000-0000-0000-0000-000000000202')),
  3,
  'el administrador lee todas las tareas'
);

-- ---------------------------------------------------------------------------------------------
-- 10. DEF-P07 y DEF-P10: Storage de avatars ---------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

set local role postgres;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars'),
  0,
  'DEF-P07: anon no lista el bucket avatars'
);

select tests.as_user('test-db030-emp2@example.com');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars' and name like 'e3000000-%'),
  1,
  'DEF-P07: un empleado lista solo su propia carpeta de avatars'
);
select tests.as_user('test-db030-admin-sin@example.com');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars' and name like 'e3000000-%'),
  2,
  'DEF-P07: el administrador lista todo avatars'
);

select tests.as_user('test-db030-emp1@example.com');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('avatars', 'e3000000-0000-0000-0000-000000000005/nueva.jpg')$$,
  'una persona activa sube a su carpeta de avatars'
);
prepare p30_av_ajena as insert into storage.objects (bucket_id, name) values ('avatars', 'e3000000-0000-0000-0000-000000000006/intrusa.jpg');
select throws_ok('p30_av_ajena', '42501', null, 'nadie sube a la carpeta de otra persona');

select tests.as_user('test-db030-owner@example.com');
select lives_ok(
  $$update public.profiles set is_active = false, deleted_at = now() where id = 'e3000000-0000-0000-0000-000000000008'$$,
  'el dueño desactiva a Emp Baja (preparación de DEF-P09/P10/P12)'
);

select tests.as_user('test-db030-emp-baja@example.com');
prepare p30_av_baja as insert into storage.objects (bucket_id, name) values ('avatars', 'e3000000-0000-0000-0000-000000000008/foto.jpg');
select throws_ok('p30_av_baja', '42501', null, 'DEF-P10: una cuenta desactivada no sube a su carpeta de avatars');

-- ---------------------------------------------------------------------------------------------
-- 11. DEF-P09 y DEF-P12: la cuenta desactivada con token vigente ------------------------------------------
-- ---------------------------------------------------------------------------------------------

select is(
  (select count(*)::int from public.holidays),
  0,
  'DEF-P09: la cuenta desactivada no lee feriados'
);
select is(
  (select count(*)::int from public.company_settings),
  0,
  'DEF-P09: la cuenta desactivada no lee la configuración de la empresa'
);
prepare p30_baja_seen as select public.mark_changes_seen();
select throws_ok('p30_baja_seen', 'P0001', 'No tenés permiso para hacer esto.',
  'DEF-P12: mark_changes_seen rechaza a una cuenta desactivada');

select tests.as_user('test-db030-emp1@example.com');
select is(
  (select count(*)::int from public.holidays where id = 'e3000000-0000-0000-0000-000000000501'),
  1,
  'una persona activa sigue leyendo los feriados'
);
select is(
  (select count(*)::int from public.company_settings),
  1,
  'una persona activa sigue leyendo la configuración de la empresa'
);
select lives_ok('select public.mark_changes_seen()', 'DEF-P12: una persona activa sigue marcando cambios vistos');

-- ---------------------------------------------------------------------------------------------
-- 12. DEF-P11 y SEG-02 -------------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

set local role postgres;
select ok(
  to_regprocedure('public.rls_auto_enable()') is null
    or not (
      has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')
      or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute')
    ),
  'DEF-P11: rls_auto_enable() no es ejecutable por anon ni authenticated'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'branding'),
  array['image/png', 'image/jpeg', 'image/webp'],
  'SEG-02: el bucket branding no acepta SVG'
);

select * from finish();

rollback;
