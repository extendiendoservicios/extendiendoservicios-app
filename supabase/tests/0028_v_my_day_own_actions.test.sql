-- pgTAP de la migración 0028_v_my_day_own_actions.sql (P14.2, corrección chica): las propias
-- acciones del empleado (avisar demora, registrar inicio/fin, cargar la observación) NO tienen
-- que encender "Cambios desde tu última visita" (v_my_day.changed_since_last_seen, P-092); un
-- cambio hecho por administración (reprogramar el turno, editar sus notas, asignar a alguien
-- nuevo, o editar la franja de una asignación después de una acción propia anterior sobre esa
-- misma fila) SÍ tiene que encenderlo.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e2800000-...'.
--
-- Igual que 0027_rpc_notices_admin_attendance.test.sql: se calculan anclas horarias reales
-- respecto de `now()` (no fechas fijas), porque notify_delay/update_assignment_time exigen
-- "antes del inicio efectivo" y record_check_in exige "el turno es de hoy".

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

-- Ancla futura ("dentro de 3 horas", turno que todavía no empezó, misma técnica que 0027) y la
-- fecha de hoy en Argentina (para el turno de inicio/fin propio, que record_check_in exige que
-- sea "de hoy").
create temporary table t28_anchors on commit drop as
select
  (now() + interval '3 hours') as future_instant,
  ((now() + interval '3 hours') at time zone 'America/Argentina/Buenos_Aires')::date as future_date,
  ((now() + interval '3 hours') at time zone 'America/Argentina/Buenos_Aires')::time as future_start,
  (((now() + interval '3 hours') at time zone 'America/Argentina/Buenos_Aires')::time + interval '1 hour')::time as future_end;

-- Varias llamadas de más abajo se hacen como authenticated (vía tests.as_user) y necesitan leer
-- esta tabla temporal (por ejemplo, para armar los parámetros de update_shift_time).
grant select on t28_anchors to authenticated;

select plan(14);

-- Existencia de las funciones tocadas por 0028 (mismas firmas que 0023/0024/0027) -----------------

select has_function('app', 'start_shift_if_needed', array['uuid'], 'existe app.start_shift_if_needed(uuid)');
select has_function('app', 'complete_shift_if_done', array['uuid'], 'existe app.complete_shift_if_done(uuid)');
select has_function('public', 'update_shift_time', array['uuid', 'time', 'time'], 'existe public.update_shift_time(uuid, time, time)');
select has_function('public', 'update_assignment_time', array['uuid', 'time', 'time'], 'existe public.update_assignment_time(uuid, time, time)');
select has_function('public', 'update_shift_details', array['uuid', 'smallint', 'text'], 'existe public.update_shift_details(uuid, smallint, text)');

-- ---------------------------------------------------------------------------------------------
-- Fixtures comunes: un cliente activo con una sede activa; owner, admin y siete empleados (uno
-- por escenario, ver más abajo).
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('e2800000-0000-0000-0000-000000000001', 'Cliente de v_my_day y acciones propias', 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e2800000-0000-0000-0000-000000000011', 'e2800000-0000-0000-0000-000000000001', 'Sede de v_my_day y acciones propias', 'Dirección 1', 'active');

-- Un empleado distinto por escenario (0091, 0092, 0093, 0094, 0095, 0096, 0097): varios de los
-- escenarios usan la misma ancla horaria futura (t28_anchors), y assignments_no_overlap (0007) es
-- por empleado -- si dos escenarios compartieran empleado y ancla, chocarían entre sí sin que eso
-- tenga nada que ver con lo que prueba cada uno.
insert into auth.users (id, email, raw_user_meta_data) values
  ('e2800000-0000-0000-0000-000000000081', 'test-db028-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'PropiaAccion')),
  ('e2800000-0000-0000-0000-000000000082', 'test-db028-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'PropiaAccion')),
  ('e2800000-0000-0000-0000-000000000091', 'test-db028-emp-aviso@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Aviso')),
  ('e2800000-0000-0000-0000-000000000092', 'test-db028-emp-reprograma@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Reprograma')),
  ('e2800000-0000-0000-0000-000000000093', 'test-db028-emp-nuevo@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Nuevo')),
  ('e2800000-0000-0000-0000-000000000094', 'test-db028-emp-residual@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Residual')),
  ('e2800000-0000-0000-0000-000000000095', 'test-db028-emp-inicio@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Inicio')),
  ('e2800000-0000-0000-0000-000000000096', 'test-db028-emp-observacion@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Observacion')),
  ('e2800000-0000-0000-0000-000000000097', 'test-db028-emp-notas@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Notas'));

insert into public.user_roles (profile_id, role) values
  ('e2800000-0000-0000-0000-000000000081', 'owner'),
  ('e2800000-0000-0000-0000-000000000082', 'admin'),
  ('e2800000-0000-0000-0000-000000000091', 'employee'),
  ('e2800000-0000-0000-0000-000000000092', 'employee'),
  ('e2800000-0000-0000-0000-000000000093', 'employee'),
  ('e2800000-0000-0000-0000-000000000094', 'employee'),
  ('e2800000-0000-0000-0000-000000000095', 'employee'),
  ('e2800000-0000-0000-0000-000000000096', 'employee'),
  ('e2800000-0000-0000-0000-000000000097', 'employee');

insert into public.employees (profile_id, dni) values
  ('e2800000-0000-0000-0000-000000000091', '92800091'),
  ('e2800000-0000-0000-0000-000000000092', '92800092'),
  ('e2800000-0000-0000-0000-000000000093', '92800093'),
  ('e2800000-0000-0000-0000-000000000094', '92800094'),
  ('e2800000-0000-0000-0000-000000000095', '92800095'),
  ('e2800000-0000-0000-0000-000000000096', '92800096'),
  ('e2800000-0000-0000-0000-000000000097', '92800097');

-- `last_seen_changes_at` de los siete, UNA hora antes de "ahora" -- no `now()` a secas: dentro de
-- una misma transacción `now()` es constante (mismo criterio que 0027_rpc_notices_admin_
-- attendance.test.sql), así que created_at/updated_at de todo lo que se inserte o actualice más
-- abajo va a coincidir exactamente con el "ahora" de esta transacción. Si last_seen_changes_at
-- también fuera ese mismo "ahora", la comparación `> last_seen_changes_at` de v_my_day daría
-- FALSE por igualdad en todos los casos (propios y ajenos por igual) y ningún assert de acá
-- probaría lo que dice probar -- por eso se corre una hora hacia atrás.
update public.profiles set last_seen_changes_at = now() - interval '1 hour'
where id in (
  'e2800000-0000-0000-0000-000000000091', 'e2800000-0000-0000-0000-000000000092',
  'e2800000-0000-0000-0000-000000000093', 'e2800000-0000-0000-0000-000000000094',
  'e2800000-0000-0000-0000-000000000095', 'e2800000-0000-0000-0000-000000000096',
  'e2800000-0000-0000-0000-000000000097'
);

-- ---------------------------------------------------------------------------------------------
-- 1. Aviso propio (notify_delay) no enciende el indicador para quien avisó -----------------------
-- ---------------------------------------------------------------------------------------------

-- created_at se fija dos horas antes de "ahora" (en el insert, no con un update posterior -- un
-- update dispararía trg_set_updated_at y dejaría el turno con updated_at NOT NULL, exactamente lo
-- que se quiere evitar acá): simula un turno que ya existía y que el empleado ya vio, para que el
-- único cambio bajo prueba sea el aviso de demora sobre la ASIGNACIÓN (si no, el turno recién
-- creado encendería el indicador por sí solo, sin que notify_delay tenga nada que ver).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, created_at)
select 'e2800000-0000-0000-0000-000000000201', 'e2800000-0000-0000-0000-000000000001', 'e2800000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled', now() - interval '2 hours'
from t28_anchors;

insert into public.assignments (id, shift_id, employee_id) values
  ('e2800000-0000-0000-0000-000000000301', 'e2800000-0000-0000-0000-000000000201', 'e2800000-0000-0000-0000-000000000091');

select tests.as_user('test-db028-emp-aviso@example.com');
select public.notify_delay('e2800000-0000-0000-0000-000000000301', 15);

select ok(
  not (select changed_since_last_seen from public.v_my_day where assignment_id = 'e2800000-0000-0000-0000-000000000301'),
  'v_my_day: avisar la propia demora (notify_delay) no enciende changed_since_last_seen'
);

-- ---------------------------------------------------------------------------------------------
-- 2. Inicio y fin propios (record_check_in/record_check_out) no encienden el indicador, ni por la
--    asignación ni por el turno (app.start_shift_if_needed/app.complete_shift_if_done, 0028) -----
-- ---------------------------------------------------------------------------------------------

set local role postgres;

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
values ('e2800000-0000-0000-0000-000000000202', 'e2800000-0000-0000-0000-000000000001', 'e2800000-0000-0000-0000-000000000011', app.today(), '08:00', '16:00', 1, 'scheduled');

insert into public.assignments (id, shift_id, employee_id) values
  ('e2800000-0000-0000-0000-000000000302', 'e2800000-0000-0000-0000-000000000202', 'e2800000-0000-0000-0000-000000000095');

select tests.as_user('test-db028-emp-inicio@example.com');
select public.record_check_in('e2800000-0000-0000-0000-000000000302');

select ok(
  not (select changed_since_last_seen from public.v_my_day where assignment_id = 'e2800000-0000-0000-0000-000000000302'),
  'v_my_day: el propio check-in no enciende changed_since_last_seen (ni por la asignación ni por la transición scheduled -> in_progress del turno)'
);

set local role postgres;

select is(
  (select status::text from public.shifts where id = 'e2800000-0000-0000-0000-000000000202'),
  'in_progress',
  'record_check_in llevó el turno a in_progress (app.start_shift_if_needed, sin esto el resto del test no prueba nada)'
);

select tests.as_user('test-db028-emp-inicio@example.com');
select public.record_check_out('e2800000-0000-0000-0000-000000000302');

select ok(
  not (select changed_since_last_seen from public.v_my_day where assignment_id = 'e2800000-0000-0000-0000-000000000302'),
  'v_my_day: el propio check-out no enciende changed_since_last_seen (ni por la asignación ni por la transición in_progress -> completed del turno, app.complete_shift_if_done)'
);

-- ---------------------------------------------------------------------------------------------
-- 3. Cargar la propia observación (set_assignment_notes) no enciende el indicador -----------------
-- ---------------------------------------------------------------------------------------------

set local role postgres;

-- Mismo motivo que el turno de la sección 1: created_at en el insert (no con un update posterior)
-- para que el turno quede "ya visto" y el único cambio bajo prueba sea la observación sobre la
-- ASIGNACIÓN.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, created_at)
select 'e2800000-0000-0000-0000-000000000203', 'e2800000-0000-0000-0000-000000000001', 'e2800000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled', now() - interval '2 hours'
from t28_anchors;

insert into public.assignments (id, shift_id, employee_id) values
  ('e2800000-0000-0000-0000-000000000303', 'e2800000-0000-0000-0000-000000000203', 'e2800000-0000-0000-0000-000000000096');

select tests.as_user('test-db028-emp-observacion@example.com');
select public.set_assignment_notes('e2800000-0000-0000-0000-000000000303', 'Todo bien, sede cerrada al llegar');

select ok(
  not (select changed_since_last_seen from public.v_my_day where assignment_id = 'e2800000-0000-0000-0000-000000000303'),
  'v_my_day: cargar la propia observación (set_assignment_notes) no enciende changed_since_last_seen'
);

-- ---------------------------------------------------------------------------------------------
-- 4. Administración reprograma el turno (update_shift_time) SÍ enciende el indicador -------------
-- ---------------------------------------------------------------------------------------------

set local role postgres;

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2800000-0000-0000-0000-000000000204', 'e2800000-0000-0000-0000-000000000001', 'e2800000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t28_anchors;

insert into public.assignments (id, shift_id, employee_id) values
  ('e2800000-0000-0000-0000-000000000304', 'e2800000-0000-0000-0000-000000000204', 'e2800000-0000-0000-0000-000000000092');

select tests.as_user('test-db028-admin@example.com');
select public.update_shift_time(
  'e2800000-0000-0000-0000-000000000204',
  (select future_start from t28_anchors),
  (select (future_end + interval '1 hour')::time from t28_anchors)
);

select tests.as_user('test-db028-emp-reprograma@example.com');

select ok(
  (select changed_since_last_seen from public.v_my_day where assignment_id = 'e2800000-0000-0000-0000-000000000304'),
  'v_my_day: administración reprograma el turno (update_shift_time) -> changed_since_last_seen = true'
);

-- ---------------------------------------------------------------------------------------------
-- 5. Administración edita las notas del turno (update_shift_details) SÍ enciende el indicador ----
-- ---------------------------------------------------------------------------------------------

set local role postgres;

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2800000-0000-0000-0000-000000000205', 'e2800000-0000-0000-0000-000000000001', 'e2800000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t28_anchors;

insert into public.assignments (id, shift_id, employee_id) values
  ('e2800000-0000-0000-0000-000000000305', 'e2800000-0000-0000-0000-000000000205', 'e2800000-0000-0000-0000-000000000097');

select tests.as_user('test-db028-admin@example.com');
select public.update_shift_details('e2800000-0000-0000-0000-000000000205', 1::smallint, 'Pidieron reforzar la limpieza de baños');

select tests.as_user('test-db028-emp-notas@example.com');

select ok(
  (select changed_since_last_seen from public.v_my_day where assignment_id = 'e2800000-0000-0000-0000-000000000305'),
  'v_my_day: administración edita las notas del turno (update_shift_details) -> changed_since_last_seen = true'
);

-- ---------------------------------------------------------------------------------------------
-- 6. Administración asigna a alguien nuevo (assign_employee) SÍ enciende el indicador -------------
--    (created_at de la asignación nueva, sin condición -- comportamiento ya existente de 0011) --
-- ---------------------------------------------------------------------------------------------

set local role postgres;

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2800000-0000-0000-0000-000000000206', 'e2800000-0000-0000-0000-000000000001', 'e2800000-0000-0000-0000-000000000011', future_date, future_start, future_end, 2, 'scheduled'
from t28_anchors;

select tests.as_user('test-db028-admin@example.com');

create temporary table t28_new_assignment on commit drop as
select (public.assign_employee('e2800000-0000-0000-0000-000000000206', 'e2800000-0000-0000-0000-000000000093') -> 'assignment' ->> 'id')::uuid as id;

select tests.as_user('test-db028-emp-nuevo@example.com');

select ok(
  (select changed_since_last_seen from public.v_my_day where assignment_id = (select id from t28_new_assignment)),
  'v_my_day: administración asigna a alguien nuevo (assign_employee) -> changed_since_last_seen = true'
);

-- ---------------------------------------------------------------------------------------------
-- 7. Caso residual documentado en 0028: una acción propia anterior sobre la asignación NO tiene
--    que enmascarar un cambio posterior de administración sobre esa misma fila
--    (update_assignment_time, la única RPC de asignaciones que antes de 0028 no fijaba updated_by)
-- ---------------------------------------------------------------------------------------------

set local role postgres;

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2800000-0000-0000-0000-000000000207', 'e2800000-0000-0000-0000-000000000001', 'e2800000-0000-0000-0000-000000000011', future_date, future_start, future_end, 1, 'scheduled'
from t28_anchors;

insert into public.assignments (id, shift_id, employee_id) values
  ('e2800000-0000-0000-0000-000000000307', 'e2800000-0000-0000-0000-000000000207', 'e2800000-0000-0000-0000-000000000094');

-- El empleado carga su propia observación primero (queda updated_by = él mismo) y recién ahí se
-- marca "visto" -- si update_assignment_time no fijara updated_by, la fila seguiría atribuida a
-- él y el cambio de administración de más abajo quedaría enmascarado.
select tests.as_user('test-db028-emp-residual@example.com');
select public.set_assignment_notes('e2800000-0000-0000-0000-000000000307', 'Llego un rato antes de la hora habitual');

set local role postgres;
select tests.as_user('test-db028-admin@example.com');
select public.update_assignment_time(
  'e2800000-0000-0000-0000-000000000307',
  (select future_start from t28_anchors),
  (select (future_end - interval '30 minutes')::time from t28_anchors)
);

select tests.as_user('test-db028-emp-residual@example.com');

select ok(
  (select changed_since_last_seen from public.v_my_day where assignment_id = 'e2800000-0000-0000-0000-000000000307'),
  'v_my_day: update_assignment_time de administración, después de una observación propia anterior sobre la misma fila, no queda enmascarado (updated_by ya no se arrastra, 0028)'
);

set local role postgres;

select * from finish();

rollback;
