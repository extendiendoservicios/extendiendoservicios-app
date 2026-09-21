-- DB-002 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Enumeraciones de 04_Modelo_de_Datos.md sección 3, en el esquema `public` (junto con las tablas
-- que las van a usar), con los valores exactos y en el mismo orden del modelo. Los valores de
-- `security_event_type` salen de la sección 2.6 (tabla `security_events`).
--
-- Agregar un valor más adelante es `alter type ... add value ...`, sin rehacer nada (04 sección 3):
-- así entran los estados de los módulos futuros.

create type public.app_role as enum (
  'owner',
  'admin',
  'supervisor',
  'employee'
);
comment on type public.app_role is 'Rol de una persona: Dueño, Administrador, Supervisor, Empleado.';

create type public.admin_capability as enum (
  'manage_users',
  'cancel_shifts',
  'edit_ratings',
  'edit_checklists',
  'manage_attendance',
  'generate_shifts',
  'manage_supervisions'
);
comment on type public.admin_capability is 'Capacidad activable por administrador: Gestionar usuarios, Cancelar turnos, Editar calificaciones, Editar plantillas de tareas, Registrar asistencia por otros, Generar turnos del mes, Asignar supervisiones.';

create type public.client_status as enum (
  'active',
  'suspended',
  'closed'
);
comment on type public.client_status is 'Estado de un cliente: Activo, Suspendido, Baja.';

create type public.site_status as enum (
  'active',
  'inactive'
);
comment on type public.site_status is 'Estado de una sede: Activa, Inactiva.';

create type public.employee_status as enum (
  'active',
  'terminated'
);
comment on type public.employee_status is 'Estado de un empleado: Activo, Baja (más "De licencia" derivado).';

create type public.service_status as enum (
  'active',
  'paused',
  'ended'
);
comment on type public.service_status is 'Estado de un servicio recurrente: Activo, Pausado, Finalizado.';

create type public.shift_status as enum (
  'scheduled',
  'assigned',
  'in_progress',
  'completed',
  'cancelled'
);
comment on type public.shift_status is 'Estado de un turno: Programado, Asignado, En curso, Finalizado, Cancelado (más "Sin cubrir" y "Próximo" derivados).';

create type public.assignment_status as enum (
  'expected',
  'delay_notified',
  'absence_notified',
  'present',
  'finished'
);
comment on type public.assignment_status is 'Estado de una asignación: Esperado, Demora avisada, Ausencia avisada, Presente, Finalizado (más "Sin registro" derivado).';

create type public.task_status as enum (
  'pending',
  'in_progress',
  'done',
  'not_done'
);
comment on type public.task_status is 'Estado de una tarea del checklist de un turno: Pendiente, En curso, Completada, No realizada.';

create type public.attendance_kind as enum (
  'check_in',
  'check_out'
);
comment on type public.attendance_kind is 'Tipo de registro de asistencia: Inicio, Fin.';

create type public.attendance_source as enum (
  'employee_app',
  'admin'
);
comment on type public.attendance_source is 'Origen de un registro o aviso: Desde la app, Cargado por administración.';

create type public.notice_kind as enum (
  'delay',
  'absence'
);
comment on type public.notice_kind is 'Tipo de aviso: Demora, Ausencia.';

create type public.absence_reason as enum (
  'illness',
  'personal',
  'procedure',
  'transport',
  'other'
);
comment on type public.absence_reason is 'Motivo de una ausencia: Enfermedad, Motivo personal, Trámite, Transporte, Otro.';

create type public.supervision_status as enum (
  'assigned',
  'in_progress',
  'completed',
  'not_done',
  'cancelled'
);
comment on type public.supervision_status is 'Estado de una supervisión: Asignada, En curso, Completada, No realizada, Cancelada.';

create type public.security_event_type as enum (
  'sign_in',
  'sign_in_failed',
  'user_created',
  'user_deactivated',
  'user_reactivated',
  'password_reset_by_admin',
  'sessions_revoked',
  'roles_changed',
  'capabilities_changed',
  'email_changed'
);
comment on type public.security_event_type is 'Tipo de evento de seguridad registrado en security_events (04 sección 2.6).';
