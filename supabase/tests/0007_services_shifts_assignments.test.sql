-- pgTAP de la migración 0007_services_shifts_assignments.sql (DB-009), parte 1: estructura de
-- las tres tablas y comportamiento de services/shifts. La parte de assignments (exclusión,
-- trigger de ventana, unicidad de empleado por turno) está en
-- 0007_services_shifts_assignments_assignments.test.sql (archivo separado por tamaño, ver
-- supabase/tests/README.md).
--
-- Cubre: existencia y columnas de las tres tablas, RLS habilitada (sin políticas todavía, llegan
-- en 0012, DB-014), FK compuestas (site_id, client_id) -> sites(id, client_id) de services y
-- shifts (existencia y comportamiento: rechaza una sede que no pertenece al cliente indicado),
-- triggers trg_set_updated_at e índices de 04 sección 8; en services: checks de weekdays, franja
-- horaria y dotación; en shifts: checks de franja y dotación, columnas generadas
-- starts_at/ends_at en una fecha de enero y otra de julio (ADR-019, sin horario de verano) y la
-- unicidad parcial (service_id, shift_date) -- incluye que un turno cancelado (status =
-- 'cancelled', deleted_at sigue null) NO libera el día, mientras que un turno dado de baja
-- lógica (deleted_at not null) sí lo libera, tal cual queda acotada la restricción en el modelo
-- (04 sección 2.3: "parcial service_id is not null and deleted_at is null").
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: '10000000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(72);

-- Estructura ------------------------------------------------------------------------------------

select has_table('public', 'services', 'existe public.services');
select has_table('public', 'shifts', 'existe public.shifts');
select has_table('public', 'assignments', 'existe public.assignments');

select columns_are(
  'public', 'services',
  array[
    'id', 'client_id', 'site_id', 'name', 'weekdays', 'start_time', 'end_time',
    'required_staff', 'valid_from', 'valid_to', 'works_on_holidays', 'min_hours_month',
    'max_hours_month', 'status', 'notes',
    'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'
  ],
  'services tiene exactamente las columnas de 04 sección 2.3'
);

select columns_are(
  'public', 'shifts',
  array[
    'id', 'service_id', 'client_id', 'site_id', 'shift_date', 'start_time', 'end_time',
    'required_staff', 'status', 'generated', 'checklist_template_id',
    'cancelled_at', 'cancelled_by', 'cancel_reason', 'notes',
    'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at',
    'starts_at', 'ends_at'
  ],
  'shifts tiene exactamente las columnas de 04 sección 2.3 (más starts_at/ends_at generadas)'
);

select columns_are(
  'public', 'assignments',
  array[
    'id', 'shift_id', 'employee_id', 'start_time', 'end_time', 'status', 'notes',
    'removed_at', 'removed_by', 'removed_reason',
    'created_at', 'updated_at', 'created_by', 'updated_by',
    'shift_date', 'window'
  ],
  'assignments tiene exactamente las columnas de 04 sección 2.3'
);

select has_pk('public', 'services', 'services tiene primary key');
select has_pk('public', 'shifts', 'shifts tiene primary key');
select has_pk('public', 'assignments', 'assignments tiene primary key');

select col_not_null('public', 'services', 'client_id', 'services.client_id not null');
select col_not_null('public', 'services', 'site_id', 'services.site_id not null');
select col_not_null('public', 'services', 'name', 'services.name not null');
select col_not_null('public', 'services', 'weekdays', 'services.weekdays not null');
select col_not_null('public', 'services', 'start_time', 'services.start_time not null');
select col_not_null('public', 'services', 'end_time', 'services.end_time not null');
select col_not_null('public', 'services', 'valid_from', 'services.valid_from not null');

select col_not_null('public', 'shifts', 'client_id', 'shifts.client_id not null');
select col_not_null('public', 'shifts', 'site_id', 'shifts.site_id not null');
select col_not_null('public', 'shifts', 'shift_date', 'shifts.shift_date not null');
select col_not_null('public', 'shifts', 'start_time', 'shifts.start_time not null');
select col_not_null('public', 'shifts', 'end_time', 'shifts.end_time not null');
select col_not_null('public', 'shifts', 'required_staff', 'shifts.required_staff not null');

select col_not_null('public', 'assignments', 'shift_id', 'assignments.shift_id not null');
select col_not_null('public', 'assignments', 'employee_id', 'assignments.employee_id not null');
select col_not_null('public', 'assignments', 'shift_date', 'assignments.shift_date not null (la fija app.sync_assignment_window antes del check)');
select col_not_null('public', 'assignments', 'window', 'assignments.window not null (la fija app.sync_assignment_window antes del check)');

-- FK compuestas (04 sección 2.3): garantizan que la sede pertenece al cliente indicado ----------

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.services'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (site_id, client_id) REFERENCES sites(id, client_id)'
  ),
  'services tiene la FK compuesta (site_id, client_id) -> sites(id, client_id)'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.shifts'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (site_id, client_id) REFERENCES sites(id, client_id)'
  ),
  'shifts tiene la FK compuesta (site_id, client_id) -> sites(id, client_id)'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.assignments'::regclass
      and contype = 'f'
      and confrelid = 'public.shifts'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (shift_id) REFERENCES shifts(id)'
  ),
  'assignments.shift_id referencia public.shifts.id'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.assignments'::regclass
      and contype = 'f'
      and confrelid = 'public.employees'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (employee_id) REFERENCES employees(profile_id)'
  ),
  'assignments.employee_id referencia public.employees.profile_id'
);

-- RLS habilitada (sin políticas todavía) -------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.services'::regclass), 'services tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.shifts'::regclass), 'shifts tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.assignments'::regclass), 'assignments tiene RLS habilitada');

-- Triggers ----------------------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'services' and t.tgname = 'trg_set_updated_at'
  ),
  'services tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'shifts' and t.tgname = 'trg_set_updated_at'
  ),
  'shifts tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'assignments' and t.tgname = 'trg_set_updated_at'
  ),
  'assignments tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'assignments' and t.tgname = 'trg_sync_assignment_window'
  ),
  'assignments tiene el trigger trg_sync_assignment_window (before insert/update)'
);
select ok(
  exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'shifts' and t.tgname = 'trg_sync_assignment_window_from_shift'
  ),
  'shifts tiene el trigger trg_sync_assignment_window_from_shift (after update)'
);

-- Índices de 04 sección 8 --------------------------------------------------------------------------

select has_index('public', 'shifts', 'shifts_service_id_shift_date_key', 'shifts: índice único parcial (service_id, shift_date)');
select has_index('public', 'shifts', 'shifts_shift_date_idx', 'shifts: índice (shift_date)');
select has_index('public', 'shifts', 'shifts_site_id_shift_date_idx', 'shifts: índice (site_id, shift_date)');
select has_index('public', 'shifts', 'shifts_status_idx', 'shifts: índice parcial (status)');
select has_index('public', 'assignments', 'assignments_shift_id_employee_id_key', 'assignments: índice único parcial (shift_id, employee_id)');
select has_index('public', 'assignments', 'assignments_employee_id_shift_date_idx', 'assignments: índice (employee_id, shift_date)');
select has_index('public', 'assignments', 'assignments_shift_id_idx', 'assignments: índice parcial (shift_id)');

-- Fixtures: un perfil (para cancelled_by) y dos clientes con una sede cada uno (para probar la
-- FK compuesta) -----------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000090', 'test-db009-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Prueba'));

insert into public.clients (id, legal_name) values
  ('10000000-0000-0000-0000-000000000001', 'Cliente Uno'),
  ('10000000-0000-0000-0000-000000000002', 'Cliente Dos');

insert into public.sites (id, client_id, name, address) values
  ('10000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'Sede Uno', 'Dirección uno'),
  ('10000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000002', 'Sede Dos', 'Dirección dos');

-- services: valores por defecto -------------------------------------------------------------------

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from)
values (
  '10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011',
  'Servicio de prueba', array[1, 2, 3]::smallint[], '08:00', '12:00', '2026-01-01'
);

select is(
  (select status::text from public.services where id = '10000000-0000-0000-0000-000000000030'),
  'active',
  'services.status nace en active sin indicarlo'
);

select is(
  (select works_on_holidays from public.services where id = '10000000-0000-0000-0000-000000000030'),
  true,
  'services.works_on_holidays nace en true sin indicarlo (P-050, decisión menor)'
);

-- services: check de weekdays (app.valid_weekdays) ------------------------------------------------

prepare service_invalid_weekdays as
  insert into public.services (client_id, site_id, name, weekdays, start_time, end_time, valid_from)
  values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'Inválido', array[]::smallint[], '08:00', '12:00', '2026-01-01');

select throws_ok('service_invalid_weekdays', '23514', null, 'rechaza services.weekdays vacío (app.valid_weekdays)');

select lives_ok(
  $$insert into public.services (client_id, site_id, name, weekdays, start_time, end_time, valid_from)
    values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'Válido', array[0,6]::smallint[], '08:00', '12:00', '2026-01-01')$$,
  'permite services.weekdays con domingo y sábado'
);

-- services: check de franja horaria ----------------------------------------------------------------

prepare service_invalid_time_range as
  insert into public.services (client_id, site_id, name, weekdays, start_time, end_time, valid_from)
  values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'Franja inválida', array[1]::smallint[], '12:00', '08:00', '2026-01-01');

select throws_ok('service_invalid_time_range', '23514', null, 'rechaza services con end_time <= start_time');

-- services: check de dotación (1..10) --------------------------------------------------------------

prepare service_required_staff_zero as
  insert into public.services (client_id, site_id, name, weekdays, start_time, end_time, valid_from, required_staff)
  values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'Dotación cero', array[1]::smallint[], '08:00', '12:00', '2026-01-01', 0);

select throws_ok('service_required_staff_zero', '23514', null, 'rechaza services.required_staff = 0');

prepare service_required_staff_too_high as
  insert into public.services (client_id, site_id, name, weekdays, start_time, end_time, valid_from, required_staff)
  values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', 'Dotación alta', array[1]::smallint[], '08:00', '12:00', '2026-01-01', 11);

select throws_ok('service_required_staff_too_high', '23514', null, 'rechaza services.required_staff = 11');

-- services: la FK compuesta rechaza una sede que no pertenece al cliente indicado -----------------

prepare service_site_client_mismatch as
  insert into public.services (client_id, site_id, name, weekdays, start_time, end_time, valid_from)
  values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000021', 'Sede ajena', array[1]::smallint[], '08:00', '12:00', '2026-01-01');

select throws_ok(
  'service_site_client_mismatch', '23503', null,
  'rechaza un service con site_id que no pertenece a client_id (FK compuesta)'
);

-- shifts: valores por defecto -----------------------------------------------------------------------

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('10000000-0000-0000-0000-000000000040', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', '2026-03-10', '08:00', '12:00', 1);

select is(
  (select status::text from public.shifts where id = '10000000-0000-0000-0000-000000000040'),
  'scheduled',
  'shifts.status nace en scheduled sin indicarlo (04 sección 6.1: "— -> scheduled")'
);

select is(
  (select generated from public.shifts where id = '10000000-0000-0000-0000-000000000040'),
  false,
  'shifts.generated nace en false sin indicarlo'
);

-- shifts: check de franja horaria y de dotación ------------------------------------------------------

prepare shift_invalid_time_range as
  insert into public.shifts (client_id, site_id, shift_date, start_time, end_time, required_staff)
  values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', '2026-03-11', '12:00', '08:00', 1);

select throws_ok('shift_invalid_time_range', '23514', null, 'rechaza shifts con end_time <= start_time');

prepare shift_required_staff_zero as
  insert into public.shifts (client_id, site_id, shift_date, start_time, end_time, required_staff)
  values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', '2026-03-11', '08:00', '12:00', 0);

select throws_ok('shift_required_staff_zero', '23514', null, 'rechaza shifts.required_staff = 0');

-- shifts: la FK compuesta rechaza una sede que no pertenece al cliente indicado --------------------

prepare shift_site_client_mismatch as
  insert into public.shifts (client_id, site_id, shift_date, start_time, end_time, required_staff)
  values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000021', '2026-03-11', '08:00', '12:00', 1);

select throws_ok(
  'shift_site_client_mismatch', '23503', null,
  'rechaza un shift con site_id que no pertenece a client_id (FK compuesta)'
);

-- shifts: columnas generadas starts_at/ends_at, enero y julio (ADR-019, sin horario de verano) ----

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('10000000-0000-0000-0000-000000000050', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', '2026-01-15', '10:00', '14:00', 1);

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('10000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', '2026-07-15', '10:00', '14:00', 1);

select is(
  (select starts_at from public.shifts where id = '10000000-0000-0000-0000-000000000050'),
  '2026-01-15 13:00:00+00'::timestamptz,
  'shifts.starts_at en verano (enero): 10:00 ART = 13:00 UTC'
);

select is(
  (select ends_at from public.shifts where id = '10000000-0000-0000-0000-000000000050'),
  '2026-01-15 17:00:00+00'::timestamptz,
  'shifts.ends_at en verano (enero): 14:00 ART = 17:00 UTC'
);

select is(
  (select starts_at from public.shifts where id = '10000000-0000-0000-0000-000000000051'),
  '2026-07-15 13:00:00+00'::timestamptz,
  'shifts.starts_at en invierno (julio): 10:00 ART = 13:00 UTC (mismo desplazamiento, sin horario de verano)'
);

select is(
  (select ends_at from public.shifts where id = '10000000-0000-0000-0000-000000000051'),
  '2026-07-15 17:00:00+00'::timestamptz,
  'shifts.ends_at en invierno (julio): 14:00 ART = 17:00 UTC (mismo desplazamiento, sin horario de verano)'
);

-- shifts: unicidad parcial (service_id, shift_date) -----------------------------------------------

insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values (
  '10000000-0000-0000-0000-000000000060', '10000000-0000-0000-0000-000000000030',
  '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011',
  '2026-03-16', '08:00', '12:00', 1
);

prepare shift_duplicate_service_date as
  insert into public.shifts (service_id, client_id, site_id, shift_date, start_time, end_time, required_staff)
  values (
    '10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000011', '2026-03-16', '09:00', '11:00', 1
  );

select throws_ok(
  'shift_duplicate_service_date', '23505', null,
  'rechaza un segundo turno del mismo servicio el mismo día'
);

select lives_ok(
  $$insert into public.shifts (service_id, client_id, site_id, shift_date, start_time, end_time, required_staff)
    values ('10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', '2026-03-17', '08:00', '12:00', 1)$$,
  'permite un turno del mismo servicio al día siguiente'
);

select lives_ok(
  $$insert into public.shifts (client_id, site_id, shift_date, start_time, end_time, required_staff)
    values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', '2026-03-16', '14:00', '18:00', 1)$$,
  'permite un turno puntual (service_id null) el mismo día que uno de servicio: la unicidad no aplica a service_id null'
);

-- shifts: check de campos de cancelación -------------------------------------------------------------

prepare shift_cancel_missing_fields as
  update public.shifts set status = 'cancelled' where id = '10000000-0000-0000-0000-000000000060';

select throws_ok(
  'shift_cancel_missing_fields', '23514', null,
  'rechaza cancelar un turno sin cancelled_at/cancelled_by/cancel_reason'
);

select lives_ok(
  $$update public.shifts
    set status = 'cancelled', cancelled_at = now(),
        cancelled_by = '10000000-0000-0000-0000-000000000090', cancel_reason = 'prueba pgTAP'
    where id = '10000000-0000-0000-0000-000000000060'$$,
  'permite cancelar un turno con los tres campos obligatorios presentes'
);

-- shifts: un turno cancelado (deleted_at sigue null) NO libera el día para un nuevo turno --------

prepare shift_duplicate_after_cancel as
  insert into public.shifts (service_id, client_id, site_id, shift_date, start_time, end_time, required_staff)
  values (
    '10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000011', '2026-03-16', '09:00', '11:00', 1
  );

select throws_ok(
  'shift_duplicate_after_cancel', '23505', null,
  'un turno cancelado (status = cancelled, deleted_at null) sigue bloqueando el día: la unicidad parcial solo excluye deleted_at is null'
);

-- shifts: dar de baja lógica (deleted_at) sí libera el día ----------------------------------------

update public.shifts set deleted_at = now() where id = '10000000-0000-0000-0000-000000000060';

select lives_ok(
  $$insert into public.shifts (service_id, client_id, site_id, shift_date, start_time, end_time, required_staff)
    values ('10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000011', '2026-03-16', '09:00', '11:00', 1)$$,
  'un turno dado de baja lógica (deleted_at not null) libera el día para uno nuevo'
);

-- RLS habilitada + cero políticas deniega a authenticated (sanity check) ------------------------

set local role authenticated;

select is((select count(*)::int from public.services), 0, 'services: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.shifts), 0, 'shifts: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.assignments), 0, 'assignments: sin políticas, authenticated no ve ninguna fila');

select * from finish();

rollback;
