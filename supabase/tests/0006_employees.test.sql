-- pgTAP de la migración 0006_employees.sql (DB-008).
--
-- Cubre: estructura y restricciones de employees/employee_client_permissions/
-- employee_availability/employee_leaves, RLS habilitada (todavía sin políticas: llegan en 0012,
-- DB-014), la secuencia del legajo (dos altas seguidas no chocan), unicidad de employee_number y
-- de dni, el check de employee_availability (end_time > start_time y weekday 0..6), el check de
-- employee_leaves (ends_on >= starts_on) y la exclusión de licencias superpuestas del mismo
-- empleado (dos filas que se pisan fallan; dos que no se pisan, o de empleados distintos, o donde
-- una ya está dada de baja lógica, pasan).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Nota sobre `employee_number_seq`: `nextval()` no es transaccional (un
-- `rollback` no "devuelve" los valores consumidos); es el comportamiento estándar de las
-- secuencias de Postgres y no afecta la corrección de estos tests ni de la numeración real de
-- legajos (P-036: el legajo es editable, no depende de no tener saltos).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(45);

-- Estructura ----------------------------------------------------------------------------------

select has_table('public', 'employees', 'existe public.employees');
select has_table('public', 'employee_client_permissions', 'existe public.employee_client_permissions');
select has_table('public', 'employee_availability', 'existe public.employee_availability');
select has_table('public', 'employee_leaves', 'existe public.employee_leaves');

select columns_are(
  'public', 'employees',
  array[
    'profile_id', 'employee_number', 'dni', 'cuil', 'address', 'birth_date', 'hire_date',
    'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relationship',
    'status', 'terminated_at', 'notes',
    'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'
  ],
  'employees tiene exactamente las columnas de 04 sección 2.1'
);

select columns_are(
  'public', 'employee_client_permissions',
  array['employee_id', 'client_id', 'created_by', 'created_at'],
  'employee_client_permissions tiene exactamente las columnas de 04 sección 2.1'
);

select columns_are(
  'public', 'employee_availability',
  array['id', 'employee_id', 'weekday', 'start_time', 'end_time', 'created_at', 'updated_at', 'created_by', 'updated_by'],
  'employee_availability tiene exactamente las columnas de 04 sección 2.1'
);

select columns_are(
  'public', 'employee_leaves',
  array['id', 'employee_id', 'starts_on', 'ends_on', 'reason', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'],
  'employee_leaves tiene exactamente las columnas de 04 sección 2.1'
);

select has_pk('public', 'employees', 'employees tiene primary key (profile_id)');
select col_is_pk('public', 'employee_client_permissions', array['employee_id', 'client_id'], 'employee_client_permissions: PK (employee_id, client_id)');
select has_pk('public', 'employee_availability', 'employee_availability tiene primary key');
select has_pk('public', 'employee_leaves', 'employee_leaves tiene primary key');

select col_not_null('public', 'employees', 'dni', 'employees.dni not null');
select col_not_null('public', 'employees', 'employee_number', 'employees.employee_number not null');
select col_not_null('public', 'employee_availability', 'employee_id', 'employee_availability.employee_id not null');
select col_not_null('public', 'employee_availability', 'weekday', 'employee_availability.weekday not null');
select col_not_null('public', 'employee_leaves', 'employee_id', 'employee_leaves.employee_id not null');
select col_not_null('public', 'employee_leaves', 'starts_on', 'employee_leaves.starts_on not null');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.employees'::regclass
      and contype = 'f'
      and confrelid = 'public.profiles'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (profile_id) REFERENCES profiles(id)'
  ),
  'employees.profile_id referencia public.profiles.id'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.employee_leaves'::regclass
      and contype = 'x'
  ),
  'employee_leaves tiene una restricción de exclusión'
);

-- Triggers --------------------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'employees' and t.tgname = 'trg_set_updated_at'
  ),
  'employees tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'employee_availability' and t.tgname = 'trg_set_updated_at'
  ),
  'employee_availability tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'employee_leaves' and t.tgname = 'trg_set_updated_at'
  ),
  'employee_leaves tiene el trigger trg_set_updated_at'
);

-- RLS habilitada (sin políticas todavía) -------------------------------------------------------

select ok((select relrowsecurity from pg_class where oid = 'public.employees'::regclass), 'employees tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.employee_client_permissions'::regclass), 'employee_client_permissions tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.employee_availability'::regclass), 'employee_availability tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.employee_leaves'::regclass), 'employee_leaves tiene RLS habilitada');

-- Fixtures: tres personas con perfil (para las pruebas de empleados) y un cliente ----------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-0000-0000-000000000001', 'test-db008-empleado-a@example.com', jsonb_build_object('first_name', 'Empleada', 'last_name', 'Uno')),
  ('e0000000-0000-0000-0000-000000000002', 'test-db008-empleado-b@example.com', jsonb_build_object('first_name', 'Empleado', 'last_name', 'Dos')),
  ('e0000000-0000-0000-0000-000000000003', 'test-db008-empleado-c@example.com', jsonb_build_object('first_name', 'Empleada', 'last_name', 'Tres')),
  ('e0000000-0000-0000-0000-000000000004', 'test-db008-empleado-d@example.com', jsonb_build_object('first_name', 'Empleado', 'last_name', 'Cuatro')),
  ('e0000000-0000-0000-0000-000000000005', 'test-db008-empleado-e@example.com', jsonb_build_object('first_name', 'Empleada', 'last_name', 'Cinco'));

insert into public.clients (id, legal_name) values ('e0000000-0000-0000-0000-000000000099', 'Cliente de prueba DB-008');

-- Secuencia del legajo: dos altas seguidas no chocan --------------------------------------------

insert into public.employees (profile_id, dni) values ('e0000000-0000-0000-0000-000000000001', '20000001');
insert into public.employees (profile_id, dni) values ('e0000000-0000-0000-0000-000000000002', '20000002');
insert into public.employees (profile_id, dni) values ('e0000000-0000-0000-0000-000000000003', '20000003');

select isnt(
  (select employee_number from public.employees where profile_id = 'e0000000-0000-0000-0000-000000000001'),
  (select employee_number from public.employees where profile_id = 'e0000000-0000-0000-0000-000000000002'),
  'employee_number_seq: dos altas seguidas obtienen legajos distintos'
);

-- unicidad de employee_number -------------------------------------------------------------------

prepare employee_duplicate_number as
  insert into public.employees (profile_id, dni, employee_number)
  values (
    'e0000000-0000-0000-0000-000000000004',
    '20000004',
    (select employee_number from public.employees where profile_id = 'e0000000-0000-0000-0000-000000000001')
  );

select throws_ok(
  'employee_duplicate_number',
  '23505',
  null,
  'rechaza dos empleados con el mismo legajo'
);

-- unicidad de dni ---------------------------------------------------------------------------------

prepare employee_duplicate_dni as
  insert into public.employees (profile_id, dni)
  values ('e0000000-0000-0000-0000-000000000005', '20000001');

select throws_ok(
  'employee_duplicate_dni',
  '23505',
  null,
  'rechaza dos empleados con el mismo DNI'
);

-- employee_availability: check weekday 0..6 -------------------------------------------------------

prepare availability_invalid_weekday as
  insert into public.employee_availability (employee_id, weekday, start_time, end_time)
  values ('e0000000-0000-0000-0000-000000000001', 7, '08:00', '12:00');

select throws_ok(
  'availability_invalid_weekday',
  '23514',
  null,
  'rechaza employee_availability con weekday fuera de 0..6'
);

-- employee_availability: check end_time > start_time ------------------------------------------------

prepare availability_invalid_time_range as
  insert into public.employee_availability (employee_id, weekday, start_time, end_time)
  values ('e0000000-0000-0000-0000-000000000001', 1, '12:00', '08:00');

select throws_ok(
  'availability_invalid_time_range',
  '23514',
  null,
  'rechaza employee_availability con end_time <= start_time'
);

select lives_ok(
  $$insert into public.employee_availability (employee_id, weekday, start_time, end_time)
    values ('e0000000-0000-0000-0000-000000000001', 1, '08:00', '12:00')$$,
  'permite employee_availability con una franja válida'
);

-- employee_leaves: check ends_on >= starts_on -------------------------------------------------------

prepare leave_invalid_range as
  insert into public.employee_leaves (employee_id, starts_on, ends_on)
  values ('e0000000-0000-0000-0000-000000000001', '2026-03-10', '2026-03-01');

select throws_ok(
  'leave_invalid_range',
  '23514',
  null,
  'rechaza employee_leaves con ends_on anterior a starts_on'
);

select lives_ok(
  $$insert into public.employee_leaves (employee_id, starts_on, ends_on)
    values ('e0000000-0000-0000-0000-000000000003', '2026-03-01', null)$$,
  'permite una licencia abierta (ends_on nulo)'
);

-- employee_leaves: exclusión de licencias superpuestas del mismo empleado --------------------------

insert into public.employee_leaves (id, employee_id, starts_on, ends_on)
values ('e0000000-0000-0000-0000-000000000030', 'e0000000-0000-0000-0000-000000000001', '2026-01-10', '2026-01-20');

prepare leave_overlap_same_employee as
  insert into public.employee_leaves (employee_id, starts_on, ends_on)
  values ('e0000000-0000-0000-0000-000000000001', '2026-01-15', '2026-01-25');

select throws_ok(
  'leave_overlap_same_employee',
  '23P01',
  null,
  'rechaza dos licencias superpuestas del mismo empleado'
);

select lives_ok(
  $$insert into public.employee_leaves (employee_id, starts_on, ends_on)
    values ('e0000000-0000-0000-0000-000000000001', '2026-02-01', '2026-02-10')$$,
  'permite dos licencias del mismo empleado que no se superponen'
);

select lives_ok(
  $$insert into public.employee_leaves (employee_id, starts_on, ends_on)
    values ('e0000000-0000-0000-0000-000000000002', '2026-01-10', '2026-01-20')$$,
  'permite el mismo rango de fechas en una licencia de otro empleado'
);

update public.employee_leaves set deleted_at = now() where id = 'e0000000-0000-0000-0000-000000000030';

select lives_ok(
  $$insert into public.employee_leaves (employee_id, starts_on, ends_on)
    values ('e0000000-0000-0000-0000-000000000001', '2026-01-10', '2026-01-20')$$,
  'permite un rango que ya no se superpone porque la licencia anterior está dada de baja lógica'
);

-- employee_client_permissions: PK (employee_id, client_id) -----------------------------------------

select lives_ok(
  $$insert into public.employee_client_permissions (employee_id, client_id)
    values ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000099')$$,
  'permite habilitar un empleado para un cliente'
);

prepare employee_client_permission_duplicate as
  insert into public.employee_client_permissions (employee_id, client_id)
  values ('e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000099');

select throws_ok(
  'employee_client_permission_duplicate',
  '23505',
  null,
  'rechaza habilitar dos veces al mismo empleado para el mismo cliente'
);

-- RLS habilitada + cero políticas deniega a authenticated (sanity check) ------------------------

set local role authenticated;

select is((select count(*)::int from public.employees), 0, 'employees: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.employee_client_permissions), 0, 'employee_client_permissions: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.employee_availability), 0, 'employee_availability: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.employee_leaves), 0, 'employee_leaves: sin políticas, authenticated no ve ninguna fila');

select * from finish();

rollback;
