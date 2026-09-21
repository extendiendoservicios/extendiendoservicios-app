-- pgTAP de la migración 0015_indexes.sql (DB-018): confirma que los diecisiete índices de
-- 04_Modelo_de_Datos.md sección 8 existen, aunque todos se crearon en migraciones anteriores
-- (0003 a 0010) y no en esta -- ver el comentario de 0015_indexes.sql para el detalle de cuál
-- índice nació en qué migración.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Sin fixtures: solo consulta el catálogo, no crea ni borra filas.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(17);

select has_index('public', 'shifts', 'shifts_shift_date_idx', 'shifts.shift_date');
select has_index('public', 'shifts', 'shifts_site_id_shift_date_idx', 'shifts (site_id, shift_date)');
select has_index('public', 'shifts', 'shifts_service_id_shift_date_key', 'shifts (service_id, shift_date), único parcial -- cubre el par que pide la sección 8');
select has_index('public', 'shifts', 'shifts_status_idx', 'shifts.status parcial (scheduled, assigned, in_progress)');

select has_index('public', 'assignments', 'assignments_employee_id_shift_date_idx', 'assignments (employee_id, shift_date)');
select has_index('public', 'assignments', 'assignments_shift_id_idx', 'assignments.shift_id parcial (removed_at is null)');

select has_index('public', 'attendance_records', 'attendance_records_assignment_id_idx', 'attendance_records.assignment_id');
select has_index('public', 'attendance_notices', 'attendance_notices_assignment_id_created_at_idx', 'attendance_notices (assignment_id, created_at desc)');

select has_index('public', 'shift_tasks', 'shift_tasks_shift_id_position_idx', 'shift_tasks (shift_id, position)');

select has_index('public', 'supervisions', 'supervisions_supervisor_id_status_idx', 'supervisions (supervisor_id, status)');
select has_index('public', 'supervisions', 'supervisions_shift_id_idx', 'supervisions.shift_id');

select has_index('public', 'ratings', 'ratings_assignment_id_idx', 'ratings.assignment_id');

select has_index('public', 'sites', 'sites_client_id_idx', 'sites.client_id');

select has_index('public', 'employee_leaves', 'employee_leaves_no_overlap', 'employee_leaves: gist de exclusión');

select has_index('public', 'security_events', 'security_events_created_at_idx', 'security_events.created_at desc');
select has_index('public', 'security_events', 'security_events_actor_id_idx', 'security_events.actor_id');

select has_index('public', 'profiles', 'profiles_last_name_first_name_idx', 'profiles (last_name, first_name)');

select * from finish();

rollback;
