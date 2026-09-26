-- pgTAP de la migración 0027_rpc_notices_admin_attendance.sql (ABS-002, ABS-003, ATT-007, ATT-008,
-- ATT-009, F14 · Ausencias y demoras, asistencia administrativa): notify_delay, notify_absence
-- (propio y en nombre), admin_record_attendance, close_assignment, y los derivados nuevos de
-- v_assignments_board/v_my_day (último aviso, origen del registro, no_record, minutes_early_leave).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e2700000-...'.
--
-- Ojo con las fechas (nota de 0026_rpc_attendance.test.sql, heredada acá): notify_delay/
-- notify_absence/admin_record_attendance/close_assignment dependen de "antes/después del inicio
-- efectivo" y de "ahora" (p_at, AT_OUT_OF_RANGE), no de fechas fijas en 2199. Se calculan dos
-- anclas horarias reales, una en el pasado y otra en el futuro respecto de `now()`, con la misma
-- zona horaria que usan las RPC (America/Argentina/Buenos_Aires, ADR-019), en una tabla temporal
-- (`t27_anchors`) para no repetir la conversión en cada fixture. Los empleados de este archivo son
-- fixtures propios, así que un turno con estas fechas no puede chocar con la restricción de
-- exclusión de ningún dato real (esa restricción es por `employee_id`).
--
-- Límite conocido (aceptado, no resuelto): dentro de una misma transacción `now()` es constante
-- (transaction timestamp de Postgres), así que los cálculos de `t27_anchors` y cualquier `now()`
-- de las RPC comparten el mismo instante durante toda la corrida -- por eso el archivo separa
-- expresamente inicio y fin con offsets explícitos (nunca dos `p_at null` seguidos sobre la misma
-- asignación, que caerían en el mismo instante y disparían `INVALID_TIME_RANGE` por error). El
-- caso de `INVALID_TIME_RANGE` de `admin_record_attendance` (más abajo) resta 5 minutos a un
-- `check_in` fijado 2 horas antes de "ahora": si la corrida cae entre las 0:00 y las ~2:05 (hora
-- de Argentina), ese resultado podría quedar antes de la medianoche del turno y fallar con
-- `AT_OUT_OF_RANGE` en vez de `INVALID_TIME_RANGE` -- ventana de 2 horas por día, aceptada por
-- practicidad (mismo criterio pragmático que ya documentan otros archivos de esta carpeta sobre
-- fechas/horas reales).

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

-- Anclas horarias: "hace 3 horas" (turno ya empezado, hora de inicio efectiva ya pasada) y
-- "dentro de 3 horas" (turno que todavía no empezó). Se calcula la fecha Y la hora de Argentina a
-- partir del mismo instante (no `current_date`/`current_time` por separado) para que un turno
-- creado con esa fecha y esa hora tenga, exactamente, esa hora de inicio efectiva en UTC
-- (app.local_ts(shift_date, start_time) = el instante de origen).
create temporary table t27_anchors on commit drop as
select
  (now() - interval '3 hours') as past_instant,
  ((now() - interval '3 hours') at time zone 'America/Argentina/Buenos_Aires')::date as past_date,
  ((now() - interval '3 hours') at time zone 'America/Argentina/Buenos_Aires')::time as past_start,
  (((now() - interval '3 hours') at time zone 'America/Argentina/Buenos_Aires')::time + interval '1 hour')::time as past_end,
  (now() + interval '3 hours') as future_instant,
  ((now() + interval '3 hours') at time zone 'America/Argentina/Buenos_Aires')::date as future_date,
  ((now() + interval '3 hours') at time zone 'America/Argentina/Buenos_Aires')::time as future_start,
  (((now() + interval '3 hours') at time zone 'America/Argentina/Buenos_Aires')::time + interval '1 hour')::time as future_end,
  -- Fecha de HOY (Argentina): para las fixtures de admin_record_attendance/close_assignment que
  -- no dependen de "antes/después del inicio" (esa RPC no lo verifica) sino solo de que las 0:00
  -- del día del turno queden ANTES de "ahora" -- con `future_date` alcanzaría casi siempre, pero
  -- si `now()` cae cerca de la medianoche y la ancla futura (+3h) cruza al día siguiente, las 0:00
  -- de ESE día quedan DESPUÉS de "ahora" y `admin_record_attendance`/`close_assignment` rechazarían
  -- cualquier `p_at` con `AT_OUT_OF_RANGE` -- inclusive el `null` (= now()). `today_date` evita ese
  -- caso de punta por completo: sus 0:00 son, por construcción, siempre anteriores a "ahora".
  (now() at time zone 'America/Argentina/Buenos_Aires')::date as today_date;

select plan(67);

-- Existencia y firma --------------------------------------------------------------------------

select has_function('public', 'notify_delay', array['uuid', 'integer', 'text'], 'existe public.notify_delay(uuid, integer, text)');
select has_function('public', 'notify_absence', array['uuid', 'absence_reason', 'text'], 'existe public.notify_absence(uuid, absence_reason, text)');
select has_function('public', 'admin_record_attendance', array['uuid', 'attendance_kind', 'timestamptz', 'text'], 'existe public.admin_record_attendance(uuid, attendance_kind, timestamptz, text)');
select has_function('public', 'close_assignment', array['uuid', 'text', 'timestamptz'], 'existe public.close_assignment(uuid, text, timestamptz)');

-- ---------------------------------------------------------------------------------------------
-- Fixtures comunes: un cliente activo con una sede activa; personas con los cuatro roles.
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('e2700000-0000-0000-0000-000000000001', 'Cliente de avisos y asistencia admin', 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e2700000-0000-0000-0000-000000000011', 'e2700000-0000-0000-0000-000000000001', 'Sede de avisos y asistencia admin', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2700000-0000-0000-0000-000000000081', 'test-db027-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Avisos')),
  ('e2700000-0000-0000-0000-000000000082', 'test-db027-admin-con-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCap')),
  ('e2700000-0000-0000-0000-000000000083', 'test-db027-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCap')),
  ('e2700000-0000-0000-0000-000000000084', 'test-db027-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Avisos')),
  ('e2700000-0000-0000-0000-000000000085', 'test-db027-emp-delay-propio@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'DelayPropio')),
  ('e2700000-0000-0000-0000-000000000086', 'test-db027-emp-delay-ajeno@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'DelayAjeno')),
  ('e2700000-0000-0000-0000-000000000087', 'test-db027-emp-minutos@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Minutos')),
  ('e2700000-0000-0000-0000-000000000088', 'test-db027-emp-tarde@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Tarde')),
  ('e2700000-0000-0000-0000-000000000089', 'test-db027-emp-empezada@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Empezada')),
  ('e2700000-0000-0000-0000-00000000008a', 'test-db027-emp-en-nombre@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'EnNombre')),
  ('e2700000-0000-0000-0000-00000000008b', 'test-db027-emp-cancelado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Cancelado')),
  ('e2700000-0000-0000-0000-00000000008c', 'test-db027-emp-completado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Completado')),
  ('e2700000-0000-0000-0000-00000000008d', 'test-db027-emp-ausencia-propia@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'AusenciaPropia')),
  ('e2700000-0000-0000-0000-00000000008e', 'test-db027-emp-ausencia-tarde@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'AusenciaTarde')),
  ('e2700000-0000-0000-0000-00000000008f', 'test-db027-emp-ausencia-en-nombre@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'AusenciaEnNombre')),
  ('e2700000-0000-0000-0000-000000000090', 'test-db027-emp-ausencia-empezada@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'AusenciaEmpezada')),
  ('e2700000-0000-0000-0000-000000000091', 'test-db027-emp-motivo@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Motivo')),
  ('e2700000-0000-0000-0000-000000000092', 'test-db027-emp-admin-attendance@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'AdminAttendance')),
  ('e2700000-0000-0000-0000-000000000093', 'test-db027-emp-close@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Close')),
  ('e2700000-0000-0000-0000-000000000094', 'test-db027-emp-medianoche@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Medianoche')),
  ('e2700000-0000-0000-0000-000000000095', 'test-db027-emp-no-record@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'NoRecord')),
  ('e2700000-0000-0000-0000-000000000096', 'test-db027-emp-early-leave@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'EarlyLeave')),
  ('e2700000-0000-0000-0000-000000000097', 'test-db027-emp-last-notice@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'LastNotice')),
  ('e2700000-0000-0000-0000-000000000098', 'test-db027-emp-my-day@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'MyDay')),
  ('e2700000-0000-0000-0000-000000000099', 'test-db027-emp-admin-sin-inicio@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'AdminSinInicio'));

insert into public.user_roles (profile_id, role) values
  ('e2700000-0000-0000-0000-000000000081', 'owner'),
  ('e2700000-0000-0000-0000-000000000082', 'admin'),
  ('e2700000-0000-0000-0000-000000000083', 'admin'),
  ('e2700000-0000-0000-0000-000000000084', 'supervisor'),
  ('e2700000-0000-0000-0000-000000000085', 'employee'),
  ('e2700000-0000-0000-0000-000000000086', 'employee'),
  ('e2700000-0000-0000-0000-000000000087', 'employee'),
  ('e2700000-0000-0000-0000-000000000088', 'employee'),
  ('e2700000-0000-0000-0000-000000000089', 'employee'),
  ('e2700000-0000-0000-0000-00000000008a', 'employee'),
  ('e2700000-0000-0000-0000-00000000008b', 'employee'),
  ('e2700000-0000-0000-0000-00000000008c', 'employee'),
  ('e2700000-0000-0000-0000-00000000008d', 'employee'),
  ('e2700000-0000-0000-0000-00000000008e', 'employee'),
  ('e2700000-0000-0000-0000-00000000008f', 'employee'),
  ('e2700000-0000-0000-0000-000000000090', 'employee'),
  ('e2700000-0000-0000-0000-000000000091', 'employee'),
  ('e2700000-0000-0000-0000-000000000092', 'employee'),
  ('e2700000-0000-0000-0000-000000000093', 'employee'),
  ('e2700000-0000-0000-0000-000000000094', 'employee'),
  ('e2700000-0000-0000-0000-000000000095', 'employee'),
  ('e2700000-0000-0000-0000-000000000096', 'employee'),
  ('e2700000-0000-0000-0000-000000000097', 'employee'),
  ('e2700000-0000-0000-0000-000000000098', 'employee'),
  ('e2700000-0000-0000-0000-000000000099', 'employee');

-- admin-con-cap tiene manage_attendance; admin-sin-cap no (mismo patrón que 0024/0026).
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2700000-0000-0000-0000-000000000082', 'manage_attendance', true),
  ('e2700000-0000-0000-0000-000000000083', 'manage_attendance', false);

insert into public.employees (profile_id, dni) values
  ('e2700000-0000-0000-0000-000000000084', '92700084'),
  ('e2700000-0000-0000-0000-000000000085', '92700085'),
  ('e2700000-0000-0000-0000-000000000086', '92700086'),
  ('e2700000-0000-0000-0000-000000000087', '92700087'),
  ('e2700000-0000-0000-0000-000000000088', '92700088'),
  ('e2700000-0000-0000-0000-000000000089', '92700089'),
  ('e2700000-0000-0000-0000-00000000008a', '92700091'),
  ('e2700000-0000-0000-0000-00000000008b', '92700092'),
  ('e2700000-0000-0000-0000-00000000008c', '92700093'),
  ('e2700000-0000-0000-0000-00000000008d', '92700094'),
  ('e2700000-0000-0000-0000-00000000008e', '92700095'),
  ('e2700000-0000-0000-0000-00000000008f', '92700096'),
  ('e2700000-0000-0000-0000-000000000090', '92700097'),
  ('e2700000-0000-0000-0000-000000000091', '92700098'),
  ('e2700000-0000-0000-0000-000000000092', '92700099'),
  ('e2700000-0000-0000-0000-000000000093', '92700100'),
  ('e2700000-0000-0000-0000-000000000094', '92700101'),
  ('e2700000-0000-0000-0000-000000000095', '92700102'),
  ('e2700000-0000-0000-0000-000000000096', '92700103'),
  ('e2700000-0000-0000-0000-000000000097', '92700104'),
  ('e2700000-0000-0000-0000-000000000098', '92700105'),
  ('e2700000-0000-0000-0000-000000000099', '92700106');

-- ---------------------------------------------------------------------------------------------
-- notify_delay ------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Turno de emp-delay-propio, todavía no empezado (ancla futura): feliz, y base de MINUTES_REQUIRED
-- se prueba sobre otra asignación propia (emp-minutos) para no depender del orden de ejecución.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000201', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000301', 'e2700000-0000-0000-0000-000000000201', 'e2700000-0000-0000-0000-000000000085');

-- Turno de emp-delay-ajeno, también futuro: para NOT_YOUR_ASSIGNMENT (llamado por emp-delay-propio).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000202', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000302', 'e2700000-0000-0000-0000-000000000202', 'e2700000-0000-0000-0000-000000000086');

-- Turno de emp-minutos, futuro: MINUTES_REQUIRED.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000203', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000303', 'e2700000-0000-0000-0000-000000000203', 'e2700000-0000-0000-0000-000000000087');

-- Turno de emp-tarde, YA empezado (ancla pasada): TOO_LATE_TO_NOTIFY.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000204', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', past_date, past_start, past_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000304', 'e2700000-0000-0000-0000-000000000204', 'e2700000-0000-0000-0000-000000000088');

-- Turno de emp-empezada, futuro, pero la asignación se fuerza a present: ASSIGNMENT_STARTED.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000205', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id, status) values
  ('e2700000-0000-0000-0000-000000000305', 'e2700000-0000-0000-0000-000000000205', 'e2700000-0000-0000-0000-000000000089', 'present');

-- Turno de emp-en-nombre, futuro: aviso "en nombre" por admin-con-cap.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000206', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000306', 'e2700000-0000-0000-0000-000000000206', 'e2700000-0000-0000-0000-00000000008a');

-- Turno cancelado de emp-cancelado (futuro salvo por el estado): SHIFT_CANCELLED.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason)
select 'e2700000-0000-0000-0000-000000000207', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'cancelled', now(), 'e2700000-0000-0000-0000-000000000081', 'Cliente canceló el servicio'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000307', 'e2700000-0000-0000-0000-000000000207', 'e2700000-0000-0000-0000-00000000008b');

-- Turno completed de emp-completado: SHIFT_COMPLETED.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000208', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'completed'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id, status) values
  ('e2700000-0000-0000-0000-000000000308', 'e2700000-0000-0000-0000-000000000208', 'e2700000-0000-0000-0000-00000000008c', 'finished');

-- ASSIGNMENT_NOT_FOUND.
select tests.as_user('test-db027-emp-delay-propio@example.com');

prepare notify_delay_not_found as select public.notify_delay('00000000-0000-0000-0000-000000000000', 15);
select throws_ok('notify_delay_not_found', 'P0001', 'No encontramos esa asignación.', 'notify_delay: id inexistente -> ASSIGNMENT_NOT_FOUND');

-- NOT_YOUR_ASSIGNMENT.
prepare notify_delay_ajena as select public.notify_delay('e2700000-0000-0000-0000-000000000302', 15);
select throws_ok('notify_delay_ajena', 'P0001', 'Esa asignación no es tuya.', 'notify_delay: asignación ajena -> NOT_YOUR_ASSIGNMENT');

-- FORBIDDEN: supervisor.
select tests.as_user('test-db027-supervisora@example.com');
prepare notify_delay_supervisor as select public.notify_delay('e2700000-0000-0000-0000-000000000301', 15);
select throws_ok('notify_delay_supervisor', 'P0001', 'No tenés permiso para hacer esto.', 'notify_delay: supervisor -> FORBIDDEN');

-- FORBIDDEN: admin sin manage_attendance.
select tests.as_user('test-db027-admin-sin-cap@example.com');
prepare notify_delay_admin_sin_cap as select public.notify_delay('e2700000-0000-0000-0000-000000000301', 15);
select throws_ok('notify_delay_admin_sin_cap', 'P0001', 'No tenés permiso para hacer esto.', 'notify_delay: admin sin manage_attendance -> FORBIDDEN');

-- MINUTES_REQUIRED: sin minutos.
select tests.as_user('test-db027-emp-minutos@example.com');
prepare notify_delay_sin_minutos as select public.notify_delay('e2700000-0000-0000-0000-000000000303', null);
select throws_ok('notify_delay_sin_minutos', 'P0001', 'Indicá los minutos de demora estimados.', 'notify_delay: sin minutos -> MINUTES_REQUIRED');

-- MINUTES_REQUIRED: fuera de rango (0 y 601).
prepare notify_delay_minutos_cero as select public.notify_delay('e2700000-0000-0000-0000-000000000303', 0);
select throws_ok('notify_delay_minutos_cero', 'P0001', 'Indicá los minutos de demora estimados.', 'notify_delay: 0 minutos -> MINUTES_REQUIRED');

prepare notify_delay_minutos_exceso as select public.notify_delay('e2700000-0000-0000-0000-000000000303', 601);
select throws_ok('notify_delay_minutos_exceso', 'P0001', 'Indicá los minutos de demora estimados.', 'notify_delay: 601 minutos -> MINUTES_REQUIRED');

-- SHIFT_CANCELLED.
select tests.as_user('test-db027-emp-cancelado@example.com');
prepare notify_delay_cancelado as select public.notify_delay('e2700000-0000-0000-0000-000000000307', 15);
select throws_ok('notify_delay_cancelado', 'P0001', 'Este turno está cancelado.', 'notify_delay: turno cancelado -> SHIFT_CANCELLED');

-- SHIFT_COMPLETED.
select tests.as_user('test-db027-emp-completado@example.com');
prepare notify_delay_completado as select public.notify_delay('e2700000-0000-0000-0000-000000000308', 15);
select throws_ok('notify_delay_completado', 'P0001', 'Este turno ya terminó.', 'notify_delay: turno completed -> SHIFT_COMPLETED');

-- ASSIGNMENT_STARTED: la asignación ya está present.
select tests.as_user('test-db027-emp-empezada@example.com');
prepare notify_delay_empezada as select public.notify_delay('e2700000-0000-0000-0000-000000000305', 15);
select throws_ok('notify_delay_empezada', 'P0001', 'La asignación ya empezó.', 'notify_delay: asignación present -> ASSIGNMENT_STARTED');

-- TOO_LATE_TO_NOTIFY: la hora de inicio efectiva ya pasó.
select tests.as_user('test-db027-emp-tarde@example.com');
prepare notify_delay_tarde as select public.notify_delay('e2700000-0000-0000-0000-000000000304', 15);
select throws_ok('notify_delay_tarde', 'P0001', 'El aviso tiene que hacerse antes de la hora de inicio.', 'notify_delay: inicio efectivo ya pasado -> TOO_LATE_TO_NOTIFY');

-- Feliz: emp-delay-propio, antes del inicio.
select tests.as_user('test-db027-emp-delay-propio@example.com');
select is(
  (public.notify_delay('e2700000-0000-0000-0000-000000000301', 15, 'Corte de calle')).kind::text,
  'delay',
  'notify_delay: feliz, inserta un aviso de tipo delay'
);

set local role postgres;
select is(
  (select status::text from public.assignments where id = 'e2700000-0000-0000-0000-000000000301'),
  'delay_notified',
  'notify_delay: la asignación pasa a delay_notified'
);

-- Feliz "en nombre": admin-con-cap avisa por emp-en-nombre.
select tests.as_user('test-db027-admin-con-cap@example.com');
select is(
  (public.notify_delay('e2700000-0000-0000-0000-000000000306', 20)).source::text,
  'admin',
  'notify_delay en nombre: source = admin'
);

set local role postgres;
select is(
  (select reported_by from public.attendance_notices where assignment_id = 'e2700000-0000-0000-0000-000000000306' and kind = 'delay'),
  'e2700000-0000-0000-0000-000000000082'::uuid,
  'notify_delay en nombre: reported_by es quien avisó (P-074)'
);

-- ---------------------------------------------------------------------------------------------
-- notify_absence ----------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Turno futuro de emp-ausencia-propia: feliz, y también REASON_REQUIRED (misma asignación, la
-- excepción no deja rastro -- throws_ok usa un savepoint interno de pgTAP).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000209', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000309', 'e2700000-0000-0000-0000-000000000209', 'e2700000-0000-0000-0000-00000000008d');

-- Turno YA empezado de emp-ausencia-tarde: TOO_LATE_TO_NOTIFY para el propio empleado.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-00000000020a', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', past_date, past_start, past_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-00000000030a', 'e2700000-0000-0000-0000-00000000020a', 'e2700000-0000-0000-0000-00000000008e');

-- Turno YA empezado de emp-ausencia-en-nombre, SIN check-in: el admin con manage_attendance sí
-- puede avisar la ausencia (decisión de Mike, P14.0).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-00000000020b', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', past_date, past_start, past_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-00000000030b', 'e2700000-0000-0000-0000-00000000020b', 'e2700000-0000-0000-0000-00000000008f');

-- Turno futuro de emp-ausencia-empezada, forzado a present: ni el propio ni el admin pueden avisar
-- ausencia -> ASSIGNMENT_STARTED.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-00000000020c', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id, status) values
  ('e2700000-0000-0000-0000-00000000030c', 'e2700000-0000-0000-0000-00000000020c', 'e2700000-0000-0000-0000-000000000090', 'present');

-- Turno futuro de emp-motivo: REASON_REQUIRED (sin motivo, y con "other" sin texto).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-00000000020d', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-00000000030d', 'e2700000-0000-0000-0000-00000000020d', 'e2700000-0000-0000-0000-000000000091');

-- REASON_REQUIRED: sin motivo.
select tests.as_user('test-db027-emp-motivo@example.com');
prepare notify_absence_sin_motivo as select public.notify_absence('e2700000-0000-0000-0000-00000000030d', null);
select throws_ok('notify_absence_sin_motivo', 'P0001', 'Indicá el motivo de la ausencia.', 'notify_absence: sin motivo -> REASON_REQUIRED');

-- REASON_REQUIRED: "other" sin texto.
prepare notify_absence_other_sin_texto as select public.notify_absence('e2700000-0000-0000-0000-00000000030d', 'other');
select throws_ok('notify_absence_other_sin_texto', 'P0001', 'Indicá el motivo de la ausencia.', 'notify_absence: other sin texto -> REASON_REQUIRED');

-- FORBIDDEN: admin sin manage_attendance.
select tests.as_user('test-db027-admin-sin-cap@example.com');
prepare notify_absence_admin_sin_cap as select public.notify_absence('e2700000-0000-0000-0000-00000000030d', 'illness');
select throws_ok('notify_absence_admin_sin_cap', 'P0001', 'No tenés permiso para hacer esto.', 'notify_absence: admin sin manage_attendance -> FORBIDDEN');

-- NOT_YOUR_ASSIGNMENT: empleado sobre asignación ajena.
select tests.as_user('test-db027-emp-motivo@example.com');
prepare notify_absence_ajena as select public.notify_absence('e2700000-0000-0000-0000-000000000309', 'illness');
select throws_ok('notify_absence_ajena', 'P0001', 'Esa asignación no es tuya.', 'notify_absence: asignación ajena -> NOT_YOUR_ASSIGNMENT');

-- Feliz: emp-ausencia-propia, antes del inicio.
select tests.as_user('test-db027-emp-ausencia-propia@example.com');
select is(
  (public.notify_absence('e2700000-0000-0000-0000-000000000309', 'illness', 'Certificado médico')).kind::text,
  'absence',
  'notify_absence: feliz, inserta un aviso de tipo absence'
);

set local role postgres;
select is(
  (select status::text from public.assignments where id = 'e2700000-0000-0000-0000-000000000309'),
  'absence_notified',
  'notify_absence: la asignación pasa a absence_notified'
);
-- P-073: el cupo no se libera solo -- el turno sigue con required_staff = 1 (no lo toca esta RPC).
select is(
  (select required_staff from public.shifts where id = 'e2700000-0000-0000-0000-000000000209'),
  1::smallint,
  'notify_absence: no libera el cupo (required_staff sin cambios, P-073)'
);

-- TOO_LATE_TO_NOTIFY: el propio empleado, inicio efectivo ya pasado.
select tests.as_user('test-db027-emp-ausencia-tarde@example.com');
prepare notify_absence_tarde as select public.notify_absence('e2700000-0000-0000-0000-00000000030a', 'illness');
select throws_ok('notify_absence_tarde', 'P0001', 'El aviso tiene que hacerse antes de la hora de inicio.', 'notify_absence: propio después del inicio -> TOO_LATE_TO_NOTIFY');

-- ASSIGNMENT_STARTED: ya present, ni para el propio ni para el admin.
select tests.as_user('test-db027-emp-ausencia-empezada@example.com');
prepare notify_absence_empezada_propio as select public.notify_absence('e2700000-0000-0000-0000-00000000030c', 'illness');
select throws_ok('notify_absence_empezada_propio', 'P0001', 'La asignación ya empezó.', 'notify_absence: propio, asignación present -> ASSIGNMENT_STARTED');

select tests.as_user('test-db027-admin-con-cap@example.com');
prepare notify_absence_empezada_admin as select public.notify_absence('e2700000-0000-0000-0000-00000000030c', 'illness');
select throws_ok('notify_absence_empezada_admin', 'P0001', 'La asignación ya empezó.', 'notify_absence: en nombre, asignación present -> ASSIGNMENT_STARTED');

-- Feliz "en nombre" DESPUÉS del inicio, sin check-in registrado (decisión de Mike, 26 sep 2026, P14.0).
select is(
  (public.notify_absence('e2700000-0000-0000-0000-00000000030b', 'transport')).source::text,
  'admin',
  'notify_absence en nombre, después del inicio y sin check-in: se acepta (P14.0)'
);

set local role postgres;
select is(
  (select status::text from public.assignments where id = 'e2700000-0000-0000-0000-00000000030b'),
  'absence_notified',
  'notify_absence en nombre después del inicio: la asignación pasa a absence_notified igual'
);

-- ---------------------------------------------------------------------------------------------
-- admin_record_attendance --------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Turno de HOY de emp-admin-attendance (today_date, no future_date: admin_record_attendance no
-- depende de "antes/después del inicio", solo de que las 0:00 del día del turno queden antes de
-- "ahora" -- ver la nota de t27_anchors): check_in/check_out felices, y los rechazos de rango/motivo.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-00000000020e', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', today_date, '06:00'::time, '07:00'::time, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-00000000030e', 'e2700000-0000-0000-0000-00000000020e', 'e2700000-0000-0000-0000-000000000092');

-- FORBIDDEN: admin sin manage_attendance.
select tests.as_user('test-db027-admin-sin-cap@example.com');
prepare admin_attendance_forbidden as select public.admin_record_attendance('e2700000-0000-0000-0000-00000000030e', 'check_in', null, 'Se olvidó el teléfono');
select throws_ok('admin_attendance_forbidden', 'P0001', 'No tenés permiso para hacer esto.', 'admin_record_attendance: sin manage_attendance -> FORBIDDEN');

select tests.as_user('test-db027-admin-con-cap@example.com');

-- ASSIGNMENT_NOT_FOUND.
prepare admin_attendance_not_found as select public.admin_record_attendance('00000000-0000-0000-0000-000000000000', 'check_in', null, 'Motivo');
select throws_ok('admin_attendance_not_found', 'P0001', 'No encontramos esa asignación.', 'admin_record_attendance: id inexistente -> ASSIGNMENT_NOT_FOUND');

-- REASON_REQUIRED.
prepare admin_attendance_sin_motivo as select public.admin_record_attendance('e2700000-0000-0000-0000-00000000030e', 'check_in', null, '   ');
select throws_ok('admin_attendance_sin_motivo', 'P0001', 'Indicá el motivo.', 'admin_record_attendance: motivo vacío -> REASON_REQUIRED');

-- AT_OUT_OF_RANGE: futuro.
prepare admin_attendance_futuro as
  select public.admin_record_attendance('e2700000-0000-0000-0000-00000000030e', 'check_in', now() + interval '1 hour', 'Motivo');
select throws_ok('admin_attendance_futuro', 'P0001', 'La hora tiene que estar entre las 0:00 del día del turno y este momento.', 'admin_record_attendance: p_at futuro -> AT_OUT_OF_RANGE');

-- AT_OUT_OF_RANGE: antes de las 0:00 del día del turno.
prepare admin_attendance_antes_del_dia as
  select public.admin_record_attendance('e2700000-0000-0000-0000-00000000030e', 'check_in', now() - interval '365 days', 'Motivo');
select throws_ok('admin_attendance_antes_del_dia', 'P0001', 'La hora tiene que estar entre las 0:00 del día del turno y este momento.', 'admin_record_attendance: p_at antes del día del turno -> AT_OUT_OF_RANGE');

-- Feliz: check_in en nombre. p_at explícito (2 horas antes de "ahora", no null): dentro de una
-- misma transacción now() es constante (nota de 0026_rpc_attendance.test.sql) -- si acá se dejara
-- el check_in en null (= now()) y el check_out feliz de más abajo también en null, los dos
-- registros quedarían con el MISMO instante y el check_out fallaría con INVALID_TIME_RANGE (fin no
-- posterior al inicio) en vez de aceptarse.
select is(
  (public.admin_record_attendance('e2700000-0000-0000-0000-00000000030e', 'check_in', now() - interval '2 hours', 'Se olvidó el teléfono')).kind::text,
  'check_in',
  'admin_record_attendance: check_in feliz'
);

set local role postgres;
select is(
  (select source::text from public.attendance_records where assignment_id = 'e2700000-0000-0000-0000-00000000030e' and kind = 'check_in'),
  'admin',
  'admin_record_attendance: source = admin'
);
select is(
  (select recorded_by from public.attendance_records where assignment_id = 'e2700000-0000-0000-0000-00000000030e' and kind = 'check_in'),
  'e2700000-0000-0000-0000-000000000082'::uuid,
  'admin_record_attendance: recorded_by es quien lo cargó (P-075)'
);
select is(
  (select status::text from public.assignments where id = 'e2700000-0000-0000-0000-00000000030e'),
  'present',
  'admin_record_attendance: la asignación pasa a present'
);
select is(
  (select status::text from public.shifts where id = 'e2700000-0000-0000-0000-00000000020e'),
  'in_progress',
  'admin_record_attendance: el turno (dotación 1) pasa a in_progress con el check_in'
);

select tests.as_user('test-db027-admin-con-cap@example.com');

-- ALREADY_CHECKED_IN.
prepare admin_attendance_doble_in as select public.admin_record_attendance('e2700000-0000-0000-0000-00000000030e', 'check_in', null, 'Motivo');
select throws_ok('admin_attendance_doble_in', 'P0001', 'Ya registraste el inicio.', 'admin_record_attendance: doble check_in -> ALREADY_CHECKED_IN');

-- INVALID_TIME_RANGE: check_out antes del check_in ya registrado.
set local role postgres;
select set_config('t27.check_in_at', (select recorded_at::text from public.attendance_records where assignment_id = 'e2700000-0000-0000-0000-00000000030e' and kind = 'check_in'), false);
select tests.as_user('test-db027-admin-con-cap@example.com');

prepare admin_attendance_fin_antes_del_inicio as
  select public.admin_record_attendance('e2700000-0000-0000-0000-00000000030e', 'check_out', current_setting('t27.check_in_at')::timestamptz - interval '5 minutes', 'Motivo');
select throws_ok('admin_attendance_fin_antes_del_inicio', 'P0001', 'La hora de fin tiene que ser posterior a la de inicio.', 'admin_record_attendance: check_out anterior al check_in -> INVALID_TIME_RANGE');

-- Feliz: check_out en nombre -> turno completed (única asignación vigente).
select is(
  (public.admin_record_attendance('e2700000-0000-0000-0000-00000000030e', 'check_out', null, 'Cierre por teléfono')).kind::text,
  'check_out',
  'admin_record_attendance: check_out feliz'
);

set local role postgres;
select is(
  (select status::text from public.shifts where id = 'e2700000-0000-0000-0000-00000000020e'),
  'completed',
  'admin_record_attendance: el turno pasa a completed con el check_out (única asignación)'
);

select tests.as_user('test-db027-admin-con-cap@example.com');

-- ALREADY_CHECKED_OUT.
prepare admin_attendance_doble_out as select public.admin_record_attendance('e2700000-0000-0000-0000-00000000030e', 'check_out', null, 'Motivo');
select throws_ok('admin_attendance_doble_out', 'P0001', 'Ya registraste el fin.', 'admin_record_attendance: doble check_out -> ALREADY_CHECKED_OUT');

set local role postgres;

-- NOT_CHECKED_IN: check_out sin check_in previo, otra asignación de HOY (today_date: la
-- verificación de rango de p_at, AT_OUT_OF_RANGE, corre ANTES que NOT_CHECKED_IN dentro de la RPC
-- -- ver la nota de t27_anchors). Empleado dedicado (099), no 093 (ese lo usa el turno de
-- close_assignment más abajo, en la misma franja horaria fija): dos asignaciones vigentes del
-- MISMO empleado en el mismo horario chocarían con la exclusión assignments_no_overlap (P-053).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-00000000020f', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', today_date, '06:00'::time, '07:00'::time, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-00000000030f', 'e2700000-0000-0000-0000-00000000020f', 'e2700000-0000-0000-0000-000000000099');

select tests.as_user('test-db027-admin-con-cap@example.com');
prepare admin_attendance_sin_inicio as select public.admin_record_attendance('e2700000-0000-0000-0000-00000000030f', 'check_out', null, 'Motivo');
select throws_ok('admin_attendance_sin_inicio', 'P0001', 'Todavía no registraste el inicio.', 'admin_record_attendance: check_out sin check_in -> NOT_CHECKED_IN');

set local role postgres;

-- Turno que cruza la medianoche EN LA CARGA (no en la franja, que sigue sin cruzar): shift_date
-- de ayer, 22:00 a 23:59, y se carga el check_out HOY temprano (antes de now()) -- P-069. p_at
-- explícito en el check_in (no null): mismo motivo que el bloque feliz de arriba, para que el
-- check_out (null = now()) quede estrictamente después.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000210', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', past_date - 1, '22:00', '23:59', 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000310', 'e2700000-0000-0000-0000-000000000210', 'e2700000-0000-0000-0000-000000000094');

select tests.as_user('test-db027-admin-con-cap@example.com');

select is(
  (public.admin_record_attendance('e2700000-0000-0000-0000-000000000310', 'check_in', now() - interval '1 hour', 'Se cargó al otro día')).kind::text,
  'check_in',
  'admin_record_attendance: check_in de un turno de ayer a la noche, cargado ahora -> aceptado'
);
select is(
  (public.admin_record_attendance('e2700000-0000-0000-0000-000000000310', 'check_out', null, 'Se cargó al otro día')).kind::text,
  'check_out',
  'admin_record_attendance: check_out del mismo turno de ayer, cargado ahora -> aceptado (P-069)'
);

-- ---------------------------------------------------------------------------------------------
-- close_assignment ----------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

set local role postgres;

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000211', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', today_date, '06:00'::time, '07:00'::time, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id, status) values
  ('e2700000-0000-0000-0000-000000000311', 'e2700000-0000-0000-0000-000000000211', 'e2700000-0000-0000-0000-000000000093', 'present');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by, reason) values
  ('e2700000-0000-0000-0000-000000000311', 'check_in', now() - interval '1 hour', 'employee_app', 'e2700000-0000-0000-0000-000000000093', null);

-- FORBIDDEN: sin manage_attendance.
select tests.as_user('test-db027-admin-sin-cap@example.com');
prepare close_assignment_forbidden as select public.close_assignment('e2700000-0000-0000-0000-000000000311', 'Motivo');
select throws_ok('close_assignment_forbidden', 'P0001', 'No tenés permiso para hacer esto.', 'close_assignment: sin manage_attendance -> FORBIDDEN');

select tests.as_user('test-db027-admin-con-cap@example.com');

-- REASON_REQUIRED.
prepare close_assignment_sin_motivo as select public.close_assignment('e2700000-0000-0000-0000-000000000311', '  ');
select throws_ok('close_assignment_sin_motivo', 'P0001', 'Indicá el motivo.', 'close_assignment: sin motivo -> REASON_REQUIRED');

-- Feliz.
select is(
  (public.close_assignment('e2700000-0000-0000-0000-000000000311', 'Se olvidó de marcar la salida')).kind::text,
  'check_out',
  'close_assignment: feliz, inserta un check_out'
);

set local role postgres;
select is(
  (select source::text from public.attendance_records where assignment_id = 'e2700000-0000-0000-0000-000000000311' and kind = 'check_out'),
  'admin',
  'close_assignment: el check_out queda con source = admin (04 sección 10)'
);
select is(
  (select status::text from public.assignments where id = 'e2700000-0000-0000-0000-000000000311'),
  'finished',
  'close_assignment: la asignación pasa a finished'
);
select is(
  (select status::text from public.shifts where id = 'e2700000-0000-0000-0000-000000000211'),
  'completed',
  'close_assignment: el turno pasa a completed (única asignación vigente)'
);

select tests.as_user('test-db027-admin-con-cap@example.com');

-- ALREADY_CHECKED_OUT.
prepare close_assignment_doble as select public.close_assignment('e2700000-0000-0000-0000-000000000311', 'Motivo');
select throws_ok('close_assignment_doble', 'P0001', 'Ya registraste el fin.', 'close_assignment: doble cierre -> ALREADY_CHECKED_OUT');

set local role postgres;

-- NOT_CHECKED_IN: nunca empezó.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000212', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000312', 'e2700000-0000-0000-0000-000000000212', 'e2700000-0000-0000-0000-000000000095');

select tests.as_user('test-db027-admin-con-cap@example.com');
prepare close_assignment_sin_inicio as select public.close_assignment('e2700000-0000-0000-0000-000000000312', 'Motivo');
select throws_ok('close_assignment_sin_inicio', 'P0001', 'Todavía no registraste el inicio.', 'close_assignment: nunca empezó -> NOT_CHECKED_IN');

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- v_assignments_board: no_record, minutes_early_leave, último aviso, origen del registro --------
-- ---------------------------------------------------------------------------------------------

-- no_record: expected con la hora de inicio efectiva ya pasada (ancla pasada, sin ningún registro).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000213', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', past_date, past_start, past_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000313', 'e2700000-0000-0000-0000-000000000213', 'e2700000-0000-0000-0000-000000000095');

select is(
  (select display_status from public.v_assignments_board where id = 'e2700000-0000-0000-0000-000000000313'),
  'no_record',
  'v_assignments_board: display_status = no_record (expected, inicio efectivo ya pasado, P-071)'
);

-- minutes_early_leave: check_out antes del fin previsto.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000214', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', past_date, past_start, past_end, 1, 'in_progress'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id, status) values
  ('e2700000-0000-0000-0000-000000000314', 'e2700000-0000-0000-0000-000000000214', 'e2700000-0000-0000-0000-000000000096', 'finished');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by, reason)
select 'e2700000-0000-0000-0000-000000000314', 'check_in', past_instant, 'employee_app', 'e2700000-0000-0000-0000-000000000096', null
from t27_anchors;
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by, reason)
select 'e2700000-0000-0000-0000-000000000314', 'check_out', past_end_at - interval '10 minutes', 'employee_app', 'e2700000-0000-0000-0000-000000000096', null
from (select app.local_ts(past_date, past_end) as past_end_at from t27_anchors) t;

select is(
  (select minutes_early_leave from public.v_assignments_board where id = 'e2700000-0000-0000-0000-000000000314'),
  10,
  'v_assignments_board: minutes_early_leave = 10 cuando el check_out fue 10 minutos antes del fin previsto (P-076)'
);

-- último aviso y origen del registro: demora y después ausencia (la vista muestra la más
-- reciente) sobre la misma asignación de emp-last-notice, y origen admin en el check_in.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000215', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000315', 'e2700000-0000-0000-0000-000000000215', 'e2700000-0000-0000-0000-000000000097');

select tests.as_user('test-db027-emp-last-notice@example.com');
select public.notify_delay('e2700000-0000-0000-0000-000000000315', 5);
select public.notify_absence('e2700000-0000-0000-0000-000000000315', 'procedure');

-- Dentro de una misma transacción now() es constante (nota de t27_anchors): los dos avisos de
-- arriba quedan con el MISMO created_at, así que "el más reciente" queda indefinido sin un
-- desempate -- se adelanta a mano el created_at del aviso de delay (el primero, en teoría) para
-- que el de absence quede, de verdad, después.
set local role postgres;
update public.attendance_notices
set created_at = now() - interval '1 minute'
where assignment_id = 'e2700000-0000-0000-0000-000000000315' and kind = 'delay';

select is(
  (select last_notice_kind::text from public.v_assignments_board where id = 'e2700000-0000-0000-0000-000000000315'),
  'absence',
  'v_assignments_board: last_notice_kind es el más reciente (absence, después de delay)'
);
select is(
  (select last_notice_reason_code::text from public.v_assignments_board where id = 'e2700000-0000-0000-0000-000000000315'),
  'procedure',
  'v_assignments_board: last_notice_reason_code del aviso más reciente'
);

-- Origen del registro: check_in cargado por admin_record_attendance queda visible en la vista.
select tests.as_user('test-db027-admin-con-cap@example.com');
select public.admin_record_attendance('e2700000-0000-0000-0000-000000000315', 'check_in', null, 'Cargado por administración');

set local role postgres;
select is(
  (select check_in_source::text from public.v_assignments_board where id = 'e2700000-0000-0000-0000-000000000315'),
  'admin',
  'v_assignments_board: check_in_source = admin cuando lo carga admin_record_attendance'
);
select is(
  (select check_in_recorded_by from public.v_assignments_board where id = 'e2700000-0000-0000-0000-000000000315'),
  'e2700000-0000-0000-0000-000000000082'::uuid,
  'v_assignments_board: check_in_recorded_by es quien lo cargó'
);

-- ---------------------------------------------------------------------------------------------
-- v_my_day: site_city/site_latitude/site_longitude, último aviso, origen del registro -----------
-- ---------------------------------------------------------------------------------------------

update public.sites
set city = 'Ciudad de prueba', latitude = -34.6, longitude = -58.4
where id = 'e2700000-0000-0000-0000-000000000011';

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2700000-0000-0000-0000-000000000216', 'e2700000-0000-0000-0000-000000000001', 'e2700000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t27_anchors;
insert into public.assignments (id, shift_id, employee_id) values
  ('e2700000-0000-0000-0000-000000000316', 'e2700000-0000-0000-0000-000000000216', 'e2700000-0000-0000-0000-000000000098');

select tests.as_user('test-db027-emp-my-day@example.com');
select public.notify_delay('e2700000-0000-0000-0000-000000000316', 12, 'Embotellamiento');

select is(
  (select site_city from public.v_my_day where assignment_id = 'e2700000-0000-0000-0000-000000000316'),
  'Ciudad de prueba',
  'v_my_day: site_city (pendiente de P13.2, sumado en 0027)'
);
select is(
  (select site_latitude from public.v_my_day where assignment_id = 'e2700000-0000-0000-0000-000000000316'),
  -34.6,
  'v_my_day: site_latitude'
);
select is(
  (select last_notice_kind::text from public.v_my_day where assignment_id = 'e2700000-0000-0000-0000-000000000316'),
  'delay',
  'v_my_day: last_notice_kind refleja el aviso propio ("avisaste demora de 12 min", P14.2)'
);
select is(
  (select last_notice_minutes_late from public.v_my_day where assignment_id = 'e2700000-0000-0000-0000-000000000316'),
  12::smallint,
  'v_my_day: last_notice_minutes_late'
);

set local role postgres;

select * from finish();

rollback;
