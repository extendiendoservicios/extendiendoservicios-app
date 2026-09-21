-- pgTAP de la migración 0009_attendance.sql (DB-011).
--
-- Cubre: estructura de attendance_records/attendance_notices, RLS habilitada (sin políticas
-- todavía, llegan en 0012, DB-014), unique (assignment_id, kind) de attendance_records, el check
-- de reason obligatorio cuando source = 'admin', los checks de attendance_notices (minutes_late
-- obligatorio y en rango 1..600 cuando kind = 'delay'; reason_code obligatorio cuando kind =
-- 'absence'; reason_text obligatorio cuando reason_code = 'other') y que varios avisos por
-- asignación están permitidos.
--
-- Solo estructura: las reglas de negocio (ventana de aviso, transición de la asignación) las
-- verifican las RPC de asistencia (0014, fase 13/14), no esta migración.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: '40000000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(34);

-- Estructura ------------------------------------------------------------------------------------

select has_table('public', 'attendance_records', 'existe public.attendance_records');
select has_table('public', 'attendance_notices', 'existe public.attendance_notices');

select columns_are(
  'public', 'attendance_records',
  array['id', 'assignment_id', 'kind', 'recorded_at', 'latitude', 'longitude', 'accuracy_m', 'source', 'recorded_by', 'reason', 'created_at'],
  'attendance_records tiene exactamente las columnas de 04 sección 2.3'
);

select columns_are(
  'public', 'attendance_notices',
  array['id', 'assignment_id', 'kind', 'minutes_late', 'reason_code', 'reason_text', 'reported_by', 'source', 'created_at'],
  'attendance_notices tiene exactamente las columnas de 04 sección 2.3'
);

select has_pk('public', 'attendance_records', 'attendance_records tiene primary key');
select has_pk('public', 'attendance_notices', 'attendance_notices tiene primary key');

select col_not_null('public', 'attendance_records', 'assignment_id', 'attendance_records.assignment_id not null');
select col_not_null('public', 'attendance_records', 'kind', 'attendance_records.kind not null');
select col_not_null('public', 'attendance_records', 'recorded_at', 'attendance_records.recorded_at not null');
select col_not_null('public', 'attendance_records', 'source', 'attendance_records.source not null');
select col_not_null('public', 'attendance_notices', 'assignment_id', 'attendance_notices.assignment_id not null');
select col_not_null('public', 'attendance_notices', 'kind', 'attendance_notices.kind not null');
select col_not_null('public', 'attendance_notices', 'source', 'attendance_notices.source not null');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance_records'::regclass and contype = 'f'
      and confrelid = 'public.assignments'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (assignment_id) REFERENCES assignments(id)'
  ),
  'attendance_records.assignment_id referencia public.assignments.id'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.attendance_records'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (assignment_id, kind)'
  ),
  'attendance_records tiene unique (assignment_id, kind)'
);

select ok((select relrowsecurity from pg_class where oid = 'public.attendance_records'::regclass), 'attendance_records tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.attendance_notices'::regclass), 'attendance_notices tiene RLS habilitada');

select has_index('public', 'attendance_records', 'attendance_records_assignment_id_idx', 'attendance_records: índice (assignment_id)');
select has_index('public', 'attendance_notices', 'attendance_notices_assignment_id_created_at_idx', 'attendance_notices: índice (assignment_id, created_at desc)');

-- Fixtures: cliente, sede, empleado, turno y asignación -------------------------------------------

insert into public.clients (id, legal_name) values ('40000000-0000-0000-0000-000000000001', 'Cliente de asistencia');
insert into public.sites (id, client_id, name, address)
values ('40000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000001', 'Sede', 'Dirección');
insert into auth.users (id, email, raw_user_meta_data) values
  ('40000000-0000-0000-0000-000000000081', 'test-db011-empleado@example.com', jsonb_build_object('first_name', 'Empleado', 'last_name', 'Prueba'));
insert into public.employees (profile_id, dni) values ('40000000-0000-0000-0000-000000000081', '50000081');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('40000000-0000-0000-0000-000000000040', '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000011', '2026-05-11', '08:00', '12:00', 1);
insert into public.assignments (id, shift_id, employee_id)
values ('40000000-0000-0000-0000-000000000050', '40000000-0000-0000-0000-000000000040', '40000000-0000-0000-0000-000000000081');

-- attendance_records: reason obligatorio cuando source = admin -------------------------------------

prepare attendance_record_admin_missing_reason as
  insert into public.attendance_records (assignment_id, kind, recorded_at, source)
  values ('40000000-0000-0000-0000-000000000050', 'check_in', now(), 'admin');

select throws_ok(
  'attendance_record_admin_missing_reason', '23514', null,
  'rechaza un registro con source = admin sin reason'
);

select lives_ok(
  $$insert into public.attendance_records (id, assignment_id, kind, recorded_at, source, reason)
    values ('40000000-0000-0000-0000-000000000060', '40000000-0000-0000-0000-000000000050', 'check_in', now(), 'admin', 'sin smartphone (P-075)')$$,
  'permite un registro con source = admin con reason'
);

select lives_ok(
  $$insert into public.attendance_records (assignment_id, kind, recorded_at, source)
    values ('40000000-0000-0000-0000-000000000050', 'check_out', now(), 'employee_app')$$,
  'permite un registro con source = employee_app sin reason'
);

-- attendance_records: unique (assignment_id, kind) -------------------------------------------------

prepare attendance_record_duplicate_kind as
  insert into public.attendance_records (assignment_id, kind, recorded_at, source)
  values ('40000000-0000-0000-0000-000000000050', 'check_in', now(), 'employee_app');

select throws_ok(
  'attendance_record_duplicate_kind', '23505', null,
  'rechaza un segundo check_in para la misma asignación'
);

-- attendance_notices: minutes_late obligatorio y en rango 1..600 cuando kind = delay --------------

prepare attendance_notice_delay_missing_minutes as
  insert into public.attendance_notices (assignment_id, kind, source)
  values ('40000000-0000-0000-0000-000000000050', 'delay', 'employee_app');

select throws_ok(
  'attendance_notice_delay_missing_minutes', '23514', null,
  'rechaza un aviso de demora sin minutes_late'
);

prepare attendance_notice_delay_minutes_zero as
  insert into public.attendance_notices (assignment_id, kind, minutes_late, source)
  values ('40000000-0000-0000-0000-000000000050', 'delay', 0, 'employee_app');

select throws_ok(
  'attendance_notice_delay_minutes_zero', '23514', null,
  'rechaza un aviso de demora con minutes_late = 0'
);

prepare attendance_notice_delay_minutes_too_high as
  insert into public.attendance_notices (assignment_id, kind, minutes_late, source)
  values ('40000000-0000-0000-0000-000000000050', 'delay', 601, 'employee_app');

select throws_ok(
  'attendance_notice_delay_minutes_too_high', '23514', null,
  'rechaza un aviso de demora con minutes_late = 601'
);

select lives_ok(
  $$insert into public.attendance_notices (id, assignment_id, kind, minutes_late, source)
    values ('40000000-0000-0000-0000-000000000070', '40000000-0000-0000-0000-000000000050', 'delay', 15, 'employee_app')$$,
  'permite un aviso de demora con minutes_late en rango'
);

-- attendance_notices: reason_code obligatorio cuando kind = absence -------------------------------

prepare attendance_notice_absence_missing_reason_code as
  insert into public.attendance_notices (assignment_id, kind, source)
  values ('40000000-0000-0000-0000-000000000050', 'absence', 'employee_app');

select throws_ok(
  'attendance_notice_absence_missing_reason_code', '23514', null,
  'rechaza un aviso de ausencia sin reason_code'
);

-- attendance_notices: reason_text obligatorio cuando reason_code = other --------------------------

prepare attendance_notice_absence_other_missing_text as
  insert into public.attendance_notices (assignment_id, kind, reason_code, source)
  values ('40000000-0000-0000-0000-000000000050', 'absence', 'other', 'employee_app');

select throws_ok(
  'attendance_notice_absence_other_missing_text', '23514', null,
  'rechaza un aviso de ausencia con reason_code = other sin reason_text'
);

select lives_ok(
  $$insert into public.attendance_notices (id, assignment_id, kind, reason_code, reason_text, source)
    values ('40000000-0000-0000-0000-000000000071', '40000000-0000-0000-0000-000000000050', 'absence', 'other', 'se le rompió el auto', 'employee_app')$$,
  'permite un aviso de ausencia con reason_code = other y reason_text'
);

-- attendance_notices: varios avisos por asignación permitidos (primero demora, después ausencia) --

select lives_ok(
  $$insert into public.attendance_notices (assignment_id, kind, reason_code, source)
    values ('40000000-0000-0000-0000-000000000050', 'absence', 'illness', 'employee_app')$$,
  'permite un segundo aviso (ausencia) para la misma asignación que ya tenía un aviso de demora'
);

select is(
  (select count(*)::int from public.attendance_notices where assignment_id = '40000000-0000-0000-0000-000000000050'),
  3,
  'attendance_notices: los tres avisos de la asignación quedan (uno de demora, dos de ausencia)'
);

-- RLS habilitada + cero políticas deniega a authenticated (sanity check) ------------------------

set local role authenticated;

select is((select count(*)::int from public.attendance_records), 0, 'attendance_records: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.attendance_notices), 0, 'attendance_notices: sin políticas, authenticated no ve ninguna fila');

select * from finish();

rollback;
