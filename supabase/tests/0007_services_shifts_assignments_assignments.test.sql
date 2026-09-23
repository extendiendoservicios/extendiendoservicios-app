-- pgTAP de la migración 0007_services_shifts_assignments.sql (DB-009), parte 2: assignments.
-- La estructura de las tres tablas y el comportamiento de services/shifts están en
-- 0007_services_shifts_assignments.test.sql (archivo separado por tamaño, ver
-- supabase/tests/README.md).
--
-- Cubre: valor por defecto de assignments.status, check de franja propia
-- (assignments_time_range_check), check de campos de baja (assignments_removed_fields_check),
-- el trigger app.sync_assignment_window (calcula shift_date/window al insertar, respeta la
-- franja propia cuando existe, y recalcula cuando cambia la franja del turno), la restricción de
-- exclusión assignments_no_overlap (P-053: mismo empleado en dos turnos que se pisan falla, en
-- dos que no se pisan entra, con franja propia que evita la superposición entra, una asignación
-- quitada libera el rango) y la unicidad parcial (shift_id, employee_id) entre las vigentes.
-- También app.current_employee_id() y app.shares_shift(shift_id) (04 sección 5), nuevas en esta
-- migración.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: '20000000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(22);

-- Fixtures: un cliente con una sede, y dos empleados (X e Y) ------------------------------------

insert into public.clients (id, legal_name) values ('20000000-0000-0000-0000-000000000001', 'Cliente de asignaciones');
insert into public.sites (id, client_id, name, address)
values ('20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 'Sede', 'Dirección');

insert into auth.users (id, email, raw_user_meta_data) values
  ('20000000-0000-0000-0000-000000000081', 'test-db009-empleado-x@example.com', jsonb_build_object('first_name', 'Empleado', 'last_name', 'Equis')),
  ('20000000-0000-0000-0000-000000000082', 'test-db009-empleado-y@example.com', jsonb_build_object('first_name', 'Empleada', 'last_name', 'Ye'));
insert into public.employees (profile_id, dni) values
  ('20000000-0000-0000-0000-000000000081', '40000081'),
  ('20000000-0000-0000-0000-000000000082', '40000082');

-- Cuatro turnos el mismo día: A (08-12), B (11-15, se pisa con A), C (12-16, adyacente a A, no se
-- pisa) y D (09-10, se usa con franja propia para no pisar nada). Más E (12-16, otro turno, mismo
-- horario que C) para la prueba de "liberar el rango al quitar".
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff) values
  ('20000000-0000-0000-0000-000000000041', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-04-06', '08:00', '12:00', 2),
  ('20000000-0000-0000-0000-000000000042', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-04-06', '11:00', '15:00', 2),
  ('20000000-0000-0000-0000-000000000043', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-04-06', '12:00', '16:00', 2),
  ('20000000-0000-0000-0000-000000000044', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-04-06', '09:00', '10:00', 2),
  ('20000000-0000-0000-0000-000000000045', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-04-06', '12:00', '16:00', 2);

-- assignments: valor por defecto de status --------------------------------------------------------

insert into public.assignments (id, shift_id, employee_id)
values ('20000000-0000-0000-0000-000000000051', '20000000-0000-0000-0000-000000000041', '20000000-0000-0000-0000-000000000081');

select is(
  (select status::text from public.assignments where id = '20000000-0000-0000-0000-000000000051'),
  'expected',
  'assignments.status nace en expected sin indicarlo (04 sección 6.2: "— -> expected")'
);

-- app.sync_assignment_window: calcula shift_date/window con la franja del turno (sin franja propia) --

select is(
  (select shift_date from public.assignments where id = '20000000-0000-0000-0000-000000000051'),
  '2026-04-06'::date,
  'app.sync_assignment_window copia shift_date del turno'
);

select is(
  (select "window" from public.assignments where id = '20000000-0000-0000-0000-000000000051'),
  tstzrange(app.local_ts('2026-04-06', '08:00'), app.local_ts('2026-04-06', '12:00'), '[)'),
  'app.sync_assignment_window calcula window con la franja del turno cuando la asignación no tiene franja propia'
);

-- assignments: franja propia con end_time <= start_time se rechaza. En la práctica el error sale
-- del propio constructor de tstzrange (22000, "range lower bound must be less than or equal to
-- range upper bound") dentro de app.sync_assignment_window, que corre antes que cualquier check
-- de tabla (BEFORE ROW): con ambas puntas presentes e invertidas, el trigger arma un rango
-- inválido antes de que Postgres llegue a evaluar assignments_time_range_check. Ese check de
-- tabla queda como respaldo por si el trigger alguna vez se deshabilita (por ejemplo, una carga
-- masiva con `alter table ... disable trigger all`) -- decisión menor, documentada acá.
prepare assignment_invalid_time_range as
  insert into public.assignments (shift_id, employee_id, start_time, end_time)
  values ('20000000-0000-0000-0000-000000000044', '20000000-0000-0000-0000-000000000082', '10:00', '09:00');

select throws_ok(
  'assignment_invalid_time_range', '22000', null,
  'rechaza una franja propia con end_time <= start_time (error del constructor de tstzrange en el trigger, antes que el check de tabla)'
);

-- app.sync_assignment_window: respeta la franja propia cuando existe -----------------------------

insert into public.assignments (id, shift_id, employee_id, start_time, end_time)
values ('20000000-0000-0000-0000-000000000058', '20000000-0000-0000-0000-000000000041', '20000000-0000-0000-0000-000000000082', '09:00', '10:00');

select is(
  (select "window" from public.assignments where id = '20000000-0000-0000-0000-000000000058'),
  tstzrange(app.local_ts('2026-04-06', '09:00'), app.local_ts('2026-04-06', '10:00'), '[)'),
  'app.sync_assignment_window usa la franja propia (09:00-10:00) en vez de la del turno (08:00-12:00)'
);

-- Exclusión (P-053): el mismo empleado en dos turnos que se pisan falla --------------------------

prepare assignment_overlap as
  insert into public.assignments (shift_id, employee_id)
  values ('20000000-0000-0000-0000-000000000042', '20000000-0000-0000-0000-000000000081');

select throws_ok(
  'assignment_overlap', '23P01', null,
  'rechaza al mismo empleado en dos turnos que se pisan (08-12 y 11-15)'
);

-- Exclusión: dos turnos que no se pisan (adyacentes, "[)") entra --------------------------------

select lives_ok(
  $$insert into public.assignments (id, shift_id, employee_id)
    values ('20000000-0000-0000-0000-000000000053', '20000000-0000-0000-0000-000000000043', '20000000-0000-0000-0000-000000000081')$$,
  'permite al mismo empleado en dos turnos adyacentes que no se pisan (08-12 y 12-16, rango "[)")'
);

-- Exclusión: con franja propia que evita la superposición, entra ---------------------------------

select lives_ok(
  $$insert into public.assignments (id, shift_id, employee_id, start_time, end_time)
    values ('20000000-0000-0000-0000-000000000054', '20000000-0000-0000-0000-000000000044', '20000000-0000-0000-0000-000000000081', '16:00', '17:00')$$,
  'permite al mismo empleado en un turno que se pisaría (09-10 dentro de 08-12) si la franja propia (16-17) evita la superposición'
);

-- Exclusión: una asignación quitada (baja lógica) libera el rango --------------------------------

update public.assignments
set removed_at = now(), removed_by = '20000000-0000-0000-0000-000000000081', removed_reason = 'prueba pgTAP'
where id = '20000000-0000-0000-0000-000000000053';

select lives_ok(
  $$insert into public.assignments (id, shift_id, employee_id)
    values ('20000000-0000-0000-0000-000000000055', '20000000-0000-0000-0000-000000000045', '20000000-0000-0000-0000-000000000081')$$,
  'una asignación quitada (removed_at not null) libera el rango: el mismo empleado entra en un turno con el mismo horario (12-16) que el turno cuya asignación se quitó'
);

-- assignments: check de campos de baja (removed_by/removed_reason obligatorios con removed_at) ---

prepare assignment_removed_missing_fields as
  update public.assignments set removed_at = now() where id = '20000000-0000-0000-0000-000000000055';

select throws_ok(
  'assignment_removed_missing_fields', '23514', null,
  'rechaza quitar una asignación sin removed_by/removed_reason'
);

-- Unicidad parcial (shift_id, employee_id): duplicado activo rechazado, sin importar si las
-- franjas se pisan o no (la unicidad es independiente de la exclusión) --------------------------

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('20000000-0000-0000-0000-000000000046', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', '2026-04-09', '08:00', '12:00', 2);

insert into public.assignments (id, shift_id, employee_id)
values ('20000000-0000-0000-0000-000000000056', '20000000-0000-0000-0000-000000000046', '20000000-0000-0000-0000-000000000082');

prepare assignment_duplicate_shift_employee as
  insert into public.assignments (shift_id, employee_id, start_time, end_time)
  values ('20000000-0000-0000-0000-000000000046', '20000000-0000-0000-0000-000000000082', '14:00', '15:00');

select throws_ok(
  'assignment_duplicate_shift_employee', '23505', null,
  'rechaza una segunda asignación activa del mismo empleado al mismo turno, aunque la franja propia no se pise con la primera'
);

-- Unicidad parcial: después de quitar la primera (baja lógica), una nueva para el mismo turno y
-- empleado entra -----------------------------------------------------------------------------

update public.assignments
set removed_at = now(), removed_by = '20000000-0000-0000-0000-000000000082', removed_reason = 'prueba pgTAP'
where id = '20000000-0000-0000-0000-000000000056';

select lives_ok(
  $$insert into public.assignments (id, shift_id, employee_id)
    values ('20000000-0000-0000-0000-000000000057', '20000000-0000-0000-0000-000000000046', '20000000-0000-0000-0000-000000000082')$$,
  'después de quitar la asignación anterior, una nueva para el mismo turno y empleado entra (unicidad parcial removed_at is null)'
);

-- Trigger app.sync_assignment_window: recalcula la ventana cuando cambia la franja del turno -----

update public.shifts set start_time = '07:00' where id = '20000000-0000-0000-0000-000000000041';

select is(
  (select "window" from public.assignments where id = '20000000-0000-0000-0000-000000000051'),
  tstzrange(app.local_ts('2026-04-06', '07:00'), app.local_ts('2026-04-06', '12:00'), '[)'),
  'al cambiar shifts.start_time, app.sync_assignment_window recalcula la ventana de la asignación sin franja propia'
);

select is(
  (select "window" from public.assignments where id = '20000000-0000-0000-0000-000000000058'),
  tstzrange(app.local_ts('2026-04-06', '09:00'), app.local_ts('2026-04-06', '10:00'), '[)'),
  'al cambiar shifts.start_time, la asignación con franja propia (09:00-10:00) no se ve afectada'
);

-- app.current_employee_id() y app.shares_shift(shift_id) (04 sección 5) --------------------------

select has_function('app', 'current_employee_id', array[]::text[], 'existe app.current_employee_id()');
select has_function('app', 'shares_shift', array['uuid'], 'existe app.shares_shift(uuid)');

select set_config('request.jwt.claims', jsonb_build_object('sub', '20000000-0000-0000-0000-000000000081')::text, true);

select is(
  app.current_employee_id(),
  '20000000-0000-0000-0000-000000000081'::uuid,
  'app.current_employee_id() devuelve auth.uid() cuando existe fila en employees'
);

select ok(
  app.shares_shift('20000000-0000-0000-0000-000000000041'),
  'app.shares_shift: true para un turno con asignación vigente del usuario actual'
);

select ok(
  not app.shares_shift('20000000-0000-0000-0000-000000000042'),
  'app.shares_shift: false para un turno sin asignación del usuario actual'
);

select ok(
  not app.shares_shift('20000000-0000-0000-0000-000000000043'),
  'app.shares_shift: false para un turno cuya única asignación del usuario está quitada (removed_at not null)'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', '00000000-0000-0000-0000-000000000000')::text, true);

select is(
  app.current_employee_id(),
  null::uuid,
  'app.current_employee_id() devuelve null cuando no existe fila en employees para ese id'
);

-- RLS habilitada + cero políticas deniega a authenticated (sanity check) ------------------------

set local role authenticated;

select is((select count(*)::int from public.assignments), 0, 'assignments: sin políticas, authenticated no ve ninguna fila');

select * from finish();

rollback;
