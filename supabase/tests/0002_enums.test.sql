-- pgTAP de la migración 0002_enums.sql (DB-002, TEST-001).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. La extensión pgtap se crea (si hace falta) dentro de esta misma
-- transacción.
--
-- Cada enum se verifica con enum_has_labels(schema, enum, labels[], descripción), que compara
-- los valores exactos y en el mismo orden de 04_Modelo_de_Datos.md sección 3 (y sección 2.6 para
-- security_event_type).

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

select enum_has_labels(
  'public', 'app_role',
  array['owner', 'admin', 'supervisor', 'employee'],
  'app_role tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'admin_capability',
  array[
    'manage_users', 'cancel_shifts', 'edit_ratings', 'edit_checklists',
    'manage_attendance', 'generate_shifts', 'manage_supervisions'
  ],
  'admin_capability tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'client_status',
  array['active', 'suspended', 'closed'],
  'client_status tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'site_status',
  array['active', 'inactive'],
  'site_status tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'employee_status',
  array['active', 'terminated'],
  'employee_status tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'service_status',
  array['active', 'paused', 'ended'],
  'service_status tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'shift_status',
  array['scheduled', 'assigned', 'in_progress', 'completed', 'cancelled'],
  'shift_status tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'assignment_status',
  array['expected', 'delay_notified', 'absence_notified', 'present', 'finished'],
  'assignment_status tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'task_status',
  array['pending', 'in_progress', 'done', 'not_done'],
  'task_status tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'attendance_kind',
  array['check_in', 'check_out'],
  'attendance_kind tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'attendance_source',
  array['employee_app', 'admin'],
  'attendance_source tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'notice_kind',
  array['delay', 'absence'],
  'notice_kind tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'absence_reason',
  array['illness', 'personal', 'procedure', 'transport', 'other'],
  'absence_reason tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'supervision_status',
  array['assigned', 'in_progress', 'completed', 'not_done', 'cancelled'],
  'supervision_status tiene los valores exactos y en orden'
);

select enum_has_labels(
  'public', 'security_event_type',
  array[
    'sign_in', 'sign_in_failed', 'user_created', 'user_deactivated',
    'user_reactivated', 'password_reset_by_admin', 'sessions_revoked',
    'roles_changed', 'capabilities_changed', 'email_changed'
  ],
  'security_event_type tiene los valores exactos y en orden (04 sección 2.6)'
);

select * from finish();

rollback;
