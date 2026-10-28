-- pgTAP de la migración 0077_p26_7b_fichar_como_empleado.sql (P26.7b, CR-16):
-- un dueño o administrador que también es empleado actúa COMO EMPLEADO sobre su propio turno, y sigue
-- operando como administración sobre el turno de otra persona.
--   1. notify_delay: origen employee_app sin manage_attendance sobre lo propio; origen admin sobre lo ajeno.
--   2. notify_absence: validaciones del empleado (motivo obligatorio, solo antes del inicio) sobre lo propio.
--   3. update_task_status: TASK_LOCKED fuera de la ventana propia; libre en turnos donde no es titular.
--   4. set_assignment_notes: SHIFT_COMPLETED sobre lo propio; libre sobre lo ajeno; FORBIDDEN para el empleado ajeno.
--   5. Lectura: v_my_day muestra solo los turnos propios del dueño (RLS de administración no los mezcla).
--
-- Convención (ver supabase/tests/README.md): una sola transacción que termina en `rollback`.
-- Prefijo de fixtures propio: 'c7700000-...'. Las fechas están lejos del presente (2199 y 2020) para
-- no depender de la hora del reloj.

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

-- Devuelve el hint (código estable) del error que produce la sentencia, o 'OK' si no falla.
create or replace function tests.hint_of(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), 'SQLSTATE ' || sqlstate);
end;
$$;
grant execute on function tests.hint_of(text) to authenticated, anon;

select plan(38);

-- Fixtures ------------------------------------------------------------------------------------
-- 01 dueño con employee (con ficha), 02 admin con employee SIN capacidades (con ficha),
-- 03 empleado común (con ficha), 04 admin con manage_attendance sin employee.

insert into auth.users (id, email, raw_user_meta_data) values
  ('c7700000-0000-0000-0000-000000000001', 'test-0077-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Empleado')),
  ('c7700000-0000-0000-0000-000000000002', 'test-0077-admin-emp@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Empleado')),
  ('c7700000-0000-0000-0000-000000000003', 'test-0077-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Comun')),
  ('c7700000-0000-0000-0000-000000000004', 'test-0077-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Puro'));

insert into public.user_roles (profile_id, role) values
  ('c7700000-0000-0000-0000-000000000001', 'owner'),
  ('c7700000-0000-0000-0000-000000000001', 'employee'),
  ('c7700000-0000-0000-0000-000000000002', 'admin'),
  ('c7700000-0000-0000-0000-000000000002', 'employee'),
  ('c7700000-0000-0000-0000-000000000003', 'employee'),
  ('c7700000-0000-0000-0000-000000000004', 'admin');

-- La 04 tiene manage_attendance; la 02 no tiene ninguna capacidad.
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('c7700000-0000-0000-0000-000000000004', 'manage_attendance', true);

insert into public.employees (profile_id, employee_number, dni) values
  ('c7700000-0000-0000-0000-000000000001', 90770001, '90770001'),
  ('c7700000-0000-0000-0000-000000000002', 90770002, '90770002'),
  ('c7700000-0000-0000-0000-000000000003', 90770003, '90770003');

insert into public.clients (id, legal_name) values ('c7700000-0000-0000-0000-0000000000c1', 'Cliente 0077');
insert into public.sites (id, client_id, name, address, status) values
  ('c7700000-0000-0000-0000-0000000000a1', 'c7700000-0000-0000-0000-0000000000c1', 'Sede 0077', 'Dirección 1', 'active');

-- Turnos (todos de la misma sede):
--   S1 2199-08-01 programado: avisos de demora (a1 dueño, a2 admin-empleado, a3 empleado común).
--   S2 2199-08-02 programado: avisos de ausencia (b1 dueño, b2 admin-empleado, b3 y b4 empleado común).
--   S3 2020-01-15 programado, ya pasó: ausencia fuera de plazo (c1 dueño, c2 empleado común).
--   S4 2199-08-03 programado: tarea t1, dueño esperado (todavía no empezó).
--   S5 2199-08-04 en curso: tarea t2, solo el empleado común, presente (el dueño no es titular).
--   S6 2199-08-05 en curso: tarea t3, dueño presente.
--   S7 2199-08-06 finalizado: observaciones (d1 dueño finalizado, d2 empleado común finalizado).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('c7700000-0000-0000-0000-0000000000b1', 'c7700000-0000-0000-0000-0000000000c1', 'c7700000-0000-0000-0000-0000000000a1', '2199-08-01', '08:00', '12:00', 3, 'scheduled'),
  ('c7700000-0000-0000-0000-0000000000b2', 'c7700000-0000-0000-0000-0000000000c1', 'c7700000-0000-0000-0000-0000000000a1', '2199-08-02', '08:00', '12:00', 4, 'scheduled'),
  ('c7700000-0000-0000-0000-0000000000b3', 'c7700000-0000-0000-0000-0000000000c1', 'c7700000-0000-0000-0000-0000000000a1', '2020-01-15', '08:00', '12:00', 2, 'scheduled'),
  ('c7700000-0000-0000-0000-0000000000b4', 'c7700000-0000-0000-0000-0000000000c1', 'c7700000-0000-0000-0000-0000000000a1', '2199-08-03', '08:00', '12:00', 1, 'scheduled'),
  ('c7700000-0000-0000-0000-0000000000b5', 'c7700000-0000-0000-0000-0000000000c1', 'c7700000-0000-0000-0000-0000000000a1', '2199-08-04', '08:00', '12:00', 1, 'in_progress'),
  ('c7700000-0000-0000-0000-0000000000b6', 'c7700000-0000-0000-0000-0000000000c1', 'c7700000-0000-0000-0000-0000000000a1', '2199-08-05', '08:00', '12:00', 1, 'in_progress'),
  ('c7700000-0000-0000-0000-0000000000b7', 'c7700000-0000-0000-0000-0000000000c1', 'c7700000-0000-0000-0000-0000000000a1', '2199-08-06', '08:00', '12:00', 2, 'completed');

insert into public.assignments (id, shift_id, employee_id, status) values
  ('c7700000-0000-0000-0000-0000000000d1', 'c7700000-0000-0000-0000-0000000000b1', 'c7700000-0000-0000-0000-000000000001', 'expected'),
  ('c7700000-0000-0000-0000-0000000000d2', 'c7700000-0000-0000-0000-0000000000b1', 'c7700000-0000-0000-0000-000000000002', 'expected'),
  ('c7700000-0000-0000-0000-0000000000d3', 'c7700000-0000-0000-0000-0000000000b1', 'c7700000-0000-0000-0000-000000000003', 'expected'),
  ('c7700000-0000-0000-0000-0000000000e1', 'c7700000-0000-0000-0000-0000000000b2', 'c7700000-0000-0000-0000-000000000001', 'expected'),
  ('c7700000-0000-0000-0000-0000000000e2', 'c7700000-0000-0000-0000-0000000000b2', 'c7700000-0000-0000-0000-000000000002', 'expected'),
  ('c7700000-0000-0000-0000-0000000000e3', 'c7700000-0000-0000-0000-0000000000b2', 'c7700000-0000-0000-0000-000000000003', 'expected'),
  ('c7700000-0000-0000-0000-0000000000f1', 'c7700000-0000-0000-0000-0000000000b3', 'c7700000-0000-0000-0000-000000000001', 'expected'),
  ('c7700000-0000-0000-0000-0000000000f2', 'c7700000-0000-0000-0000-0000000000b3', 'c7700000-0000-0000-0000-000000000003', 'expected'),
  ('c7700000-0000-0000-0000-000000000a01', 'c7700000-0000-0000-0000-0000000000b4', 'c7700000-0000-0000-0000-000000000001', 'expected'),
  ('c7700000-0000-0000-0000-000000000a02', 'c7700000-0000-0000-0000-0000000000b5', 'c7700000-0000-0000-0000-000000000003', 'present'),
  ('c7700000-0000-0000-0000-000000000a03', 'c7700000-0000-0000-0000-0000000000b6', 'c7700000-0000-0000-0000-000000000001', 'present'),
  ('c7700000-0000-0000-0000-000000000a04', 'c7700000-0000-0000-0000-0000000000b7', 'c7700000-0000-0000-0000-000000000001', 'finished'),
  ('c7700000-0000-0000-0000-000000000a05', 'c7700000-0000-0000-0000-0000000000b7', 'c7700000-0000-0000-0000-000000000003', 'finished');

-- Los avisos de ausencia sobre S2 necesitan una segunda asignación del empleado común.
-- (b3 y b4 de la descripción: e3 y una asignación de otro turno, para no repetir la misma.)
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('c7700000-0000-0000-0000-0000000000b8', 'c7700000-0000-0000-0000-0000000000c1', 'c7700000-0000-0000-0000-0000000000a1', '2199-08-07', '08:00', '12:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id, status) values
  ('c7700000-0000-0000-0000-000000000a06', 'c7700000-0000-0000-0000-0000000000b8', 'c7700000-0000-0000-0000-000000000003', 'expected');

insert into public.shift_tasks (id, shift_id, position, title, is_required, status) values
  ('c7700000-0000-0000-0000-000000000b01', 'c7700000-0000-0000-0000-0000000000b4', 1, 'Tarea t1', true, 'pending'),
  ('c7700000-0000-0000-0000-000000000b02', 'c7700000-0000-0000-0000-0000000000b5', 1, 'Tarea t2', true, 'pending'),
  ('c7700000-0000-0000-0000-000000000b03', 'c7700000-0000-0000-0000-0000000000b6', 1, 'Tarea t3', true, 'pending');

-- 0. Estructura: misma firma y mismos grants ---------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.notify_delay(uuid, integer, text)', 'execute')
  and has_function_privilege('authenticated', 'public.notify_absence(uuid, public.absence_reason, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.update_task_status(uuid, public.task_status, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_assignment_notes(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.notify_delay(uuid, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.notify_absence(uuid, public.absence_reason, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.update_task_status(uuid, public.task_status, text)', 'execute')
  and not has_function_privilege('anon', 'public.set_assignment_notes(uuid, text)', 'execute'),
  'las cuatro RPC conservan firma y grants: authenticated sí, anon no'
);

-- 1. notify_delay ------------------------------------------------------------------------------

select tests.as_user('test-0077-owner@example.com');
select is(
  (public.notify_delay('c7700000-0000-0000-0000-0000000000d1', 15, 'Tráfico')).source::text,
  'employee_app',
  'notify_delay: el dueño sobre su propia asignación avisa como empleado (origen employee_app)'
);
select is(
  (select status::text from public.assignments where id = 'c7700000-0000-0000-0000-0000000000d1'),
  'delay_notified',
  'notify_delay: la asignación propia del dueño queda delay_notified'
);
select is(
  (public.notify_delay('c7700000-0000-0000-0000-0000000000d3', 20, 'Aviso en nombre')).source::text,
  'admin',
  'notify_delay: el dueño sobre la asignación de otra persona sigue siendo administración (origen admin)'
);

select tests.as_user('test-0077-admin-emp@example.com');
select is(
  (public.notify_delay('c7700000-0000-0000-0000-0000000000d2', 10)).source::text,
  'employee_app',
  'notify_delay: el administrador sin manage_attendance avisa su propia demora como empleado'
);
select is(
  tests.hint_of($$select public.notify_delay('c7700000-0000-0000-0000-0000000000e3', 10)$$),
  'FORBIDDEN',
  'notify_delay: el mismo administrador sobre la asignación ajena sigue necesitando manage_attendance (FORBIDDEN)'
);

select tests.as_user('test-0077-empleado@example.com');
select is(
  tests.hint_of($$select public.notify_delay('c7700000-0000-0000-0000-0000000000d1', 10)$$),
  'NOT_YOUR_ASSIGNMENT',
  'notify_delay: el empleado común sobre la asignación de otra persona -> NOT_YOUR_ASSIGNMENT (sin cambios)'
);

select tests.as_user('test-0077-admin@example.com');
select is(
  (public.notify_delay('c7700000-0000-0000-0000-0000000000e2', 5)).source::text,
  'admin',
  'notify_delay: el administrador con manage_attendance (sin rol employee) avisa en nombre (origen admin)'
);

-- 2. notify_absence ----------------------------------------------------------------------------

select tests.as_user('test-0077-owner@example.com');
select is(
  tests.hint_of($$select public.notify_absence('c7700000-0000-0000-0000-0000000000e1')$$),
  'REASON_REQUIRED',
  'notify_absence: el dueño sobre lo propio sin motivo -> REASON_REQUIRED (validación del empleado)'
);
select is(
  tests.hint_of($$select public.notify_absence('c7700000-0000-0000-0000-0000000000f1', 'illness')$$),
  'TOO_LATE_TO_NOTIFY',
  'notify_absence: el dueño sobre su turno ya empezado -> TOO_LATE_TO_NOTIFY (ventana del empleado)'
);
select is(
  (select r.source::text || '/' || coalesce(r.has_certificate::text, 'null')
   from public.notify_absence('c7700000-0000-0000-0000-0000000000e1', 'illness', null, true) r),
  'employee_app/null',
  'notify_absence: el dueño sobre lo propio queda como employee_app y el certificado se ignora'
);
select is(
  (select status::text from public.assignments where id = 'c7700000-0000-0000-0000-0000000000e1'),
  'absence_notified',
  'notify_absence: la asignación propia del dueño queda absence_notified'
);
select is(
  (select r.source::text || '/' || r.has_certificate::text
   from public.notify_absence('c7700000-0000-0000-0000-0000000000f2', null, null, true) r),
  'admin/true',
  'notify_absence: el dueño sobre el turno ya empezado de otra persona sigue cargando en nombre (admin, con certificado)'
);
select is(
  tests.hint_of($$select public.notify_absence('c7700000-0000-0000-0000-0000000000e3')$$),
  'CERTIFICATE_REQUIRED',
  'notify_absence: el dueño sobre lo ajeno sin indicar el certificado -> CERTIFICATE_REQUIRED (camino administrativo)'
);

select tests.as_user('test-0077-admin-emp@example.com');
select is(
  (select r.source::text from public.notify_absence('c7700000-0000-0000-0000-0000000000e2', 'personal') r),
  'employee_app',
  'notify_absence: el administrador sin manage_attendance avisa su propia ausencia como empleado'
);
select is(
  tests.hint_of($$select public.notify_absence('c7700000-0000-0000-0000-000000000a06', null, null, false)$$),
  'FORBIDDEN',
  'notify_absence: el mismo administrador sobre la asignación ajena sin manage_attendance -> FORBIDDEN'
);

select tests.as_user('test-0077-empleado@example.com');
select is(
  tests.hint_of($$select public.notify_absence('c7700000-0000-0000-0000-0000000000e1', 'illness')$$),
  'NOT_YOUR_ASSIGNMENT',
  'notify_absence: el empleado común sobre la asignación de otra persona -> NOT_YOUR_ASSIGNMENT (sin cambios)'
);

-- 3. update_task_status ------------------------------------------------------------------------

select tests.as_user('test-0077-owner@example.com');
select is(
  tests.hint_of($$select public.update_task_status('c7700000-0000-0000-0000-000000000b01', 'done')$$),
  'TASK_LOCKED',
  'update_task_status: el dueño asignado que todavía no empezó -> TASK_LOCKED (ventana del empleado)'
);
select is(
  (public.update_task_status('c7700000-0000-0000-0000-000000000b03', 'done')).status::text,
  'done',
  'update_task_status: el dueño presente en su turno marca la tarea como empleado'
);
select is(
  (public.update_task_status('c7700000-0000-0000-0000-000000000b02', 'done')).status::text,
  'done',
  'update_task_status: el dueño en un turno donde no es titular sigue editando como administración'
);
select is(
  tests.hint_of($$select public.update_task_status('c7700000-0000-0000-0000-000000000b02', 'not_done')$$),
  'REASON_REQUIRED',
  'update_task_status: not_done sin motivo -> REASON_REQUIRED (sin cambios)'
);

select tests.as_user('test-0077-admin-emp@example.com');
select is(
  (public.update_task_status('c7700000-0000-0000-0000-000000000b01', 'in_progress')).status::text,
  'in_progress',
  'update_task_status: el administrador con rol employee, sin asignación en ese turno, edita como administración'
);

select tests.as_user('test-0077-empleado@example.com');
select is(
  tests.hint_of($$select public.update_task_status('c7700000-0000-0000-0000-000000000b03', 'done')$$),
  'TASK_LOCKED',
  'update_task_status: el empleado común sin asignación en el turno -> TASK_LOCKED (sin cambios)'
);

select tests.as_user('test-0077-admin@example.com');
select is(
  (public.update_task_status('c7700000-0000-0000-0000-000000000b01', 'done')).status::text,
  'done',
  'update_task_status: el administrador puro edita siempre (sin cambios)'
);

-- 4. set_assignment_notes ----------------------------------------------------------------------

select tests.as_user('test-0077-owner@example.com');
select is(
  (public.set_assignment_notes('c7700000-0000-0000-0000-0000000000d1', 'Observación propia')).notes,
  'Observación propia',
  'set_assignment_notes: el dueño sobre su asignación vigente guarda la observación'
);
select is(
  tests.hint_of($$select public.set_assignment_notes('c7700000-0000-0000-0000-000000000a04', 'Tarde')$$),
  'SHIFT_COMPLETED',
  'set_assignment_notes: el dueño sobre su asignación de un turno terminado -> SHIFT_COMPLETED (validación del empleado)'
);
select is(
  (public.set_assignment_notes('c7700000-0000-0000-0000-000000000a05', 'Corrección de oficina')).notes,
  'Corrección de oficina',
  'set_assignment_notes: el dueño sobre la asignación de otra persona en un turno terminado sigue editando como administración'
);
select is(
  tests.hint_of($$select public.set_assignment_notes('c7700000-0000-0000-0000-000000000a05', repeat('x', 2001))$$),
  'NOTES_TOO_LONG',
  'set_assignment_notes: más de 2000 caracteres -> NOTES_TOO_LONG (sin cambios)'
);

select tests.as_user('test-0077-admin-emp@example.com');
select is(
  (public.set_assignment_notes('c7700000-0000-0000-0000-0000000000d2', 'Obs. del admin-empleado')).notes,
  'Obs. del admin-empleado',
  'set_assignment_notes: el administrador con rol employee sobre su propia asignación guarda la observación'
);
select is(
  tests.hint_of($$select public.set_assignment_notes('c7700000-0000-0000-0000-000000000a04', 'Ajeno')$$),
  'OK',
  'set_assignment_notes: el mismo administrador sobre la asignación de otra persona sigue editando como administración'
);

select tests.as_user('test-0077-empleado@example.com');
select is(
  tests.hint_of($$select public.set_assignment_notes('c7700000-0000-0000-0000-0000000000d1', 'No es mía')$$),
  'FORBIDDEN',
  'set_assignment_notes: el empleado común sobre la asignación ajena -> FORBIDDEN (sin cambios)'
);
select is(
  tests.hint_of($$select public.set_assignment_notes('c7700000-0000-0000-0000-000000000a05', 'Propia, turno terminado')$$),
  'SHIFT_COMPLETED',
  'set_assignment_notes: el empleado común sobre su asignación de un turno terminado -> SHIFT_COMPLETED (sin cambios)'
);

-- 5. Lectura: v_my_day -------------------------------------------------------------------------
-- v_my_day filtra employee_id = auth.uid(): el dueño ve solo sus turnos, no los de los demás, a pesar
-- de que la RLS de administración le dejaría ver todo. Las fechas de fixtures están en 2199, fuera de la
-- ventana de hoy a +7 días, así que se verifica por la definición y por la RLS de assignments.

select tests.as_user('test-0077-owner@example.com');
select is(
  (select count(*)::int from public.assignments where employee_id = 'c7700000-0000-0000-0000-000000000001'),
  6,
  'lectura: el dueño ve sus propias asignaciones (RLS de administración y de empleado)'
);
select ok(
  pg_get_viewdef('public.v_my_day'::regclass) ~ 'employee_id\) = auth\.uid\(\)|employee_id = auth\.uid\(\)',
  'lectura: v_my_day filtra por employee_id = auth.uid() sin condicionar por rol (un dueño con employee ve su día como empleado)'
);
select ok(
  pg_get_viewdef('public.v_my_day'::regclass) !~ 'is_admin',
  'lectura: v_my_day no menciona app.is_admin()'
);

select tests.as_user('test-0077-empleado@example.com');
select is(
  (select count(*)::int from public.assignments where employee_id = 'c7700000-0000-0000-0000-000000000001'),
  0,
  'lectura: el empleado común no ve las asignaciones del dueño (sin cambios)'
);

-- 6. Auditoría de origen: las avisos del dueño sobre lo propio quedaron como employee_app ------

select tests.as_user('test-0077-owner@example.com');
select is(
  (select count(*)::int from public.attendance_notices n
   join public.assignments a on a.id = n.assignment_id
   where a.employee_id = 'c7700000-0000-0000-0000-000000000001' and n.source = 'employee_app'),
  2,
  'avisos del dueño sobre sus propias asignaciones: todos employee_app (demora y ausencia)'
);
select is(
  (select count(*)::int from public.attendance_notices n
   join public.assignments a on a.id = n.assignment_id
   where a.employee_id <> 'c7700000-0000-0000-0000-000000000001' and n.source = 'admin' and n.reported_by = 'c7700000-0000-0000-0000-000000000001'),
  2,
  'avisos del dueño sobre asignaciones ajenas: todos admin (demora en nombre y ausencia en nombre)'
);

select * from finish();

rollback;
