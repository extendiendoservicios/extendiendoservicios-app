-- pgTAP de la migración 0010_supervisions_ratings.sql (DB-012).
--
-- Cubre: estructura de supervisions/supervision_attendance/ratings/rating_criteria, RLS
-- habilitada (sin políticas todavía, llegan en 0012, DB-014), el valor por defecto de
-- supervisions.status, los checks de not_done_reason/cancel_reason obligatorios según estado, la
-- unicidad parcial (shift_id, supervisor_id) entre las no canceladas (P-086: sin supervisión
-- espontánea), unique (supervision_id, kind) de supervision_attendance, el check de
-- ratings.score en 1..5 y unique (supervision_id, assignment_id), y app.supervises_shift(shift_id)
-- (04 sección 5), pendiente desde 0007 (DB-009) hasta que existiera esta tabla.
--
-- Solo estructura: las transiciones de 04 sección 6.4 (assign_supervision, supervision_check_in,
-- complete_supervision, rate_employee, etc.) llegan con las RPC de supervisión (0015, fase 15).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: '50000000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(53);

-- Estructura ------------------------------------------------------------------------------------

select has_table('public', 'supervisions', 'existe public.supervisions');
select has_table('public', 'supervision_attendance', 'existe public.supervision_attendance');
select has_table('public', 'ratings', 'existe public.ratings');
select has_table('public', 'rating_criteria', 'existe public.rating_criteria');

select columns_are(
  'public', 'supervisions',
  array[
    'id', 'shift_id', 'supervisor_id', 'status', 'assigned_by', 'assigned_at',
    'not_done_reason', 'cancel_reason', 'general_notes', 'criteria_snapshot',
    'created_at', 'updated_at', 'created_by', 'updated_by'
  ],
  'supervisions tiene exactamente las columnas de 04 sección 2.5'
);

select columns_are(
  'public', 'supervision_attendance',
  array['id', 'supervision_id', 'kind', 'recorded_at', 'latitude', 'longitude', 'accuracy_m', 'created_at'],
  'supervision_attendance tiene exactamente las columnas de 04 sección 2.5'
);

select columns_are(
  'public', 'ratings',
  array['id', 'supervision_id', 'assignment_id', 'score', 'comment', 'created_at', 'updated_at', 'created_by', 'updated_by'],
  'ratings tiene exactamente las columnas de 04 sección 2.5'
);

select columns_are(
  'public', 'rating_criteria',
  array['id', 'position', 'title', 'description', 'valid_from', 'valid_to', 'created_at', 'updated_at', 'created_by', 'updated_by'],
  'rating_criteria tiene exactamente las columnas de 04 sección 2.5'
);

select has_pk('public', 'supervisions', 'supervisions tiene primary key');
select has_pk('public', 'supervision_attendance', 'supervision_attendance tiene primary key');
select has_pk('public', 'ratings', 'ratings tiene primary key');
select has_pk('public', 'rating_criteria', 'rating_criteria tiene primary key');

select col_not_null('public', 'supervisions', 'shift_id', 'supervisions.shift_id not null');
select col_not_null('public', 'supervisions', 'supervisor_id', 'supervisions.supervisor_id not null');
select col_not_null('public', 'ratings', 'supervision_id', 'ratings.supervision_id not null');
select col_not_null('public', 'ratings', 'assignment_id', 'ratings.assignment_id not null');
select col_not_null('public', 'ratings', 'score', 'ratings.score not null');
select col_not_null('public', 'rating_criteria', 'title', 'rating_criteria.title not null');
select col_not_null('public', 'rating_criteria', 'valid_from', 'rating_criteria.valid_from not null');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.supervisions'::regclass and contype = 'f'
      and confrelid = 'public.shifts'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (shift_id) REFERENCES shifts(id)'
  ),
  'supervisions.shift_id referencia public.shifts.id'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.supervisions'::regclass and contype = 'f'
      and confrelid = 'public.employees'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (supervisor_id) REFERENCES employees(profile_id)'
  ),
  'supervisions.supervisor_id referencia public.employees.profile_id'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.ratings'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (supervision_id, assignment_id)'
  ),
  'ratings tiene unique (supervision_id, assignment_id)'
);

select ok((select relrowsecurity from pg_class where oid = 'public.supervisions'::regclass), 'supervisions tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.supervision_attendance'::regclass), 'supervision_attendance tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.ratings'::regclass), 'ratings tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.rating_criteria'::regclass), 'rating_criteria tiene RLS habilitada');

select has_index('public', 'supervisions', 'supervisions_shift_id_supervisor_id_key', 'supervisions: índice único parcial (shift_id, supervisor_id)');
select has_index('public', 'supervisions', 'supervisions_supervisor_id_status_idx', 'supervisions: índice (supervisor_id, status)');
select has_index('public', 'supervisions', 'supervisions_shift_id_idx', 'supervisions: índice (shift_id)');
select has_index('public', 'ratings', 'ratings_assignment_id_idx', 'ratings: índice (assignment_id)');

select has_function('app', 'supervises_shift', array['uuid'], 'existe app.supervises_shift(uuid)');

-- Fixtures: cliente, sede, un empleado supervisor y otro empleado común, un turno y su asignación

insert into public.clients (id, legal_name) values ('50000000-0000-0000-0000-000000000001', 'Cliente de supervisiones');
insert into public.sites (id, client_id, name, address)
values ('50000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000001', 'Sede', 'Dirección');
insert into auth.users (id, email, raw_user_meta_data) values
  ('50000000-0000-0000-0000-000000000081', 'test-db012-supervisora@example.com', jsonb_build_object('first_name', 'Supervisora', 'last_name', 'Prueba')),
  ('50000000-0000-0000-0000-000000000082', 'test-db012-empleado@example.com', jsonb_build_object('first_name', 'Empleado', 'last_name', 'Prueba'));
insert into public.employees (profile_id, dni) values
  ('50000000-0000-0000-0000-000000000081', '60000081'),
  ('50000000-0000-0000-0000-000000000082', '60000082');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('50000000-0000-0000-0000-000000000040', '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000011', '2026-06-08', '08:00', '12:00', 1);
insert into public.assignments (id, shift_id, employee_id)
values ('50000000-0000-0000-0000-000000000050', '50000000-0000-0000-0000-000000000040', '50000000-0000-0000-0000-000000000082');

-- supervisions: valor por defecto de status ---------------------------------------------------------

insert into public.supervisions (id, shift_id, supervisor_id)
values ('50000000-0000-0000-0000-000000000060', '50000000-0000-0000-0000-000000000040', '50000000-0000-0000-0000-000000000081');

select is(
  (select status::text from public.supervisions where id = '50000000-0000-0000-0000-000000000060'),
  'assigned',
  'supervisions.status nace en assigned sin indicarlo (04 sección 6.4: "— -> assigned")'
);

-- supervisions: unicidad parcial (shift_id, supervisor_id) entre las no canceladas (P-086) --------

prepare supervision_duplicate_shift_supervisor as
  insert into public.supervisions (shift_id, supervisor_id)
  values ('50000000-0000-0000-0000-000000000040', '50000000-0000-0000-0000-000000000081');

select throws_ok(
  'supervision_duplicate_shift_supervisor', '23505', null,
  'rechaza una segunda supervisión no cancelada del mismo turno y supervisor (P-086, sin supervisión espontánea)'
);

-- supervisions: not_done_reason obligatorio cuando status = not_done -------------------------------

prepare supervision_not_done_missing_reason as
  update public.supervisions set status = 'not_done' where id = '50000000-0000-0000-0000-000000000060';

select throws_ok(
  'supervision_not_done_missing_reason', '23514', null,
  'rechaza marcar una supervisión not_done sin not_done_reason'
);

select lives_ok(
  $$update public.supervisions set status = 'not_done', not_done_reason = 'turno cancelado en el momento' where id = '50000000-0000-0000-0000-000000000060'$$,
  'permite marcar una supervisión not_done con motivo'
);

-- supervisions: cancel_reason obligatorio cuando status = cancelled --------------------------------

prepare supervision_cancel_missing_reason as
  update public.supervisions set status = 'cancelled', not_done_reason = null where id = '50000000-0000-0000-0000-000000000060';

select throws_ok(
  'supervision_cancel_missing_reason', '23514', null,
  'rechaza cancelar una supervisión sin cancel_reason'
);

select lives_ok(
  $$update public.supervisions set status = 'cancelled', not_done_reason = null, cancel_reason = 'turno cancelado' where id = '50000000-0000-0000-0000-000000000060'$$,
  'permite cancelar una supervisión con motivo'
);

-- supervisions: cancelada libera la unicidad parcial (shift_id, supervisor_id) ---------------------

select lives_ok(
  $$insert into public.supervisions (id, shift_id, supervisor_id)
    values ('50000000-0000-0000-0000-000000000061', '50000000-0000-0000-0000-000000000040', '50000000-0000-0000-0000-000000000081')$$,
  'una supervisión cancelada libera el par (shift_id, supervisor_id) para una nueva'
);

-- supervision_attendance: unique (supervision_id, kind) --------------------------------------------

insert into public.supervision_attendance (id, supervision_id, kind, recorded_at)
values ('50000000-0000-0000-0000-000000000070', '50000000-0000-0000-0000-000000000061', 'check_in', now());

prepare supervision_attendance_duplicate_kind as
  insert into public.supervision_attendance (supervision_id, kind, recorded_at)
  values ('50000000-0000-0000-0000-000000000061', 'check_in', now());

select throws_ok(
  'supervision_attendance_duplicate_kind', '23505', null,
  'rechaza un segundo check_in para la misma supervisión'
);

select lives_ok(
  $$insert into public.supervision_attendance (supervision_id, kind, recorded_at)
    values ('50000000-0000-0000-0000-000000000061', 'check_out', now())$$,
  'permite el check_out de la misma supervisión'
);

-- ratings: check de score 1..5 y unique (supervision_id, assignment_id) ----------------------------

prepare rating_score_zero as
  insert into public.ratings (supervision_id, assignment_id, score)
  values ('50000000-0000-0000-0000-000000000061', '50000000-0000-0000-0000-000000000050', 0);

select throws_ok('rating_score_zero', '23514', null, 'rechaza ratings.score = 0');

prepare rating_score_too_high as
  insert into public.ratings (supervision_id, assignment_id, score)
  values ('50000000-0000-0000-0000-000000000061', '50000000-0000-0000-0000-000000000050', 6);

select throws_ok('rating_score_too_high', '23514', null, 'rechaza ratings.score = 6');

select lives_ok(
  $$insert into public.ratings (id, supervision_id, assignment_id, score, comment)
    values ('50000000-0000-0000-0000-000000000080', '50000000-0000-0000-0000-000000000061', '50000000-0000-0000-0000-000000000050', 5, 'Excelente')$$,
  'permite una calificación válida (score 1..5, comentario opcional)'
);

prepare rating_duplicate_supervision_assignment as
  insert into public.ratings (supervision_id, assignment_id, score)
  values ('50000000-0000-0000-0000-000000000061', '50000000-0000-0000-0000-000000000050', 3);

select throws_ok(
  'rating_duplicate_supervision_assignment', '23505', null,
  'rechaza una segunda calificación de la misma asignación en la misma supervisión'
);

-- rating_criteria: vigencia por defecto y cierre con valid_to --------------------------------------

insert into public.rating_criteria (id, position, title)
values ('50000000-0000-0000-0000-000000000090', 1, 'Puntualidad');

select is(
  (select valid_from from public.rating_criteria where id = '50000000-0000-0000-0000-000000000090'),
  current_date,
  'rating_criteria.valid_from nace en la fecha de hoy sin indicarlo'
);

select lives_ok(
  $$update public.rating_criteria set valid_to = current_date where id = '50000000-0000-0000-0000-000000000090'$$,
  'permite cerrar un criterio con valid_to (P-087: no se borra)'
);

-- app.supervises_shift(shift_id) (04 sección 5) -----------------------------------------------------

select set_config('request.jwt.claims', jsonb_build_object('sub', '50000000-0000-0000-0000-000000000081')::text, true);

select ok(
  app.supervises_shift('50000000-0000-0000-0000-000000000040'),
  'app.supervises_shift: true para un turno con supervisión no cancelada del usuario actual (61: not_done)'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', '50000000-0000-0000-0000-000000000082')::text, true);

select ok(
  not app.supervises_shift('50000000-0000-0000-0000-000000000040'),
  'app.supervises_shift: false para un usuario que no es el supervisor asignado'
);

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('50000000-0000-0000-0000-000000000041', '50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000011', '2026-06-09', '08:00', '12:00', 1);

insert into public.supervisions (id, shift_id, supervisor_id, status, cancel_reason)
values ('50000000-0000-0000-0000-000000000062', '50000000-0000-0000-0000-000000000041', '50000000-0000-0000-0000-000000000081', 'cancelled', 'prueba');

select set_config('request.jwt.claims', jsonb_build_object('sub', '50000000-0000-0000-0000-000000000081')::text, true);

select ok(
  not app.supervises_shift('50000000-0000-0000-0000-000000000041'),
  'app.supervises_shift: false cuando la única supervisión del usuario sobre ese turno está cancelada'
);

-- RLS habilitada + cero políticas deniega a authenticated (sanity check) ------------------------

set local role authenticated;

select is((select count(*)::int from public.supervisions), 0, 'supervisions: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.supervision_attendance), 0, 'supervision_attendance: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.ratings), 0, 'ratings: sin políticas, authenticated no ve ninguna fila');
select is((select count(*)::int from public.rating_criteria), 0, 'rating_criteria: sin políticas, authenticated no ve ninguna fila');

select * from finish();

rollback;
