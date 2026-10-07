// tests/permissions/suite/rpc.ts — TEST-019 (P18.3)
//
// La matriz de las RPC expuestas de `public` (`06_API.md`: "toda RPC llama primero a
// `app.require_role` / `app.require_capability`, que lanzan FORBIDDEN"). Cada caso llama a la
// RPC con argumentos que NO escriben nada (ids inexistentes, valores inválidos que se rechazan
// DESPUÉS de la puerta de rol, o un estado que ya es el actual) y mira el código estable
// (`hint`) que devuelve:
//   - fuera de su alcance: `FORBIDDEN` (o `NOT_YOUR_*` cuando el rol sí es el correcto pero la
//     fila es de otro), y `42501` para `anon` (el `execute` está revocado);
//   - dentro de su alcance: cualquier otro error posterior a la puerta, que prueba que el rol
//     "pasó" (por ejemplo `SHIFT_NOT_FOUND`). Que "lo permitido funciona" con datos reales lo
//     ejercitan los e2e y pgTAP; acá se prueba que la puerta abre solo para quien corresponde.

import type { Contexto } from './contexto.ts'
import type { Perfil } from './perfiles.ts'

/** Funciones que App_dev expone y que NO salen de las migraciones (las crea la plataforma). */
export const RPC_DE_PLATAFORMA = ['rls_auto_enable'] as const

export const INEXISTENTE = '00000000-0000-4000-8000-000000000001'

export type Esperado = string // un `hint`, un código (`42501`, `22008`) u 'OK' (sin error)

export interface CasoRpc {
  /** Nombre de la RPC (clave del inventario). */
  rpc: string
  /** Variante, para distinguir dos casos de la misma RPC. */
  variante?: string
  args: (c: Contexto, quien: Perfil) => Record<string, unknown>
  esperado: Record<Perfil, Esperado>
  /** Filas de `09_Trazabilidad.md` y casos borde que cubre. */
  cubre?: string[]
}

type Pasan = Partial<Record<Perfil, Esperado>>

/**
 * Esperado por perfil: `anon` siempre `42501`; los que se indican en `pasan` devuelven lo que
 * se les pide; el resto, `FORBIDDEN`.
 */
function caso(
  rpc: string,
  args: CasoRpc['args'],
  pasan: Pasan,
  extra: Partial<CasoRpc> = {},
): CasoRpc {
  return {
    rpc,
    args,
    esperado: {
      anon: '42501',
      empleado: 'FORBIDDEN',
      supervisor: 'FORBIDDEN',
      dual: 'FORBIDDEN',
      adminSin: 'FORBIDDEN',
      admin: 'FORBIDDEN',
      owner: 'FORBIDDEN',
      ...pasan,
    },
    ...extra,
  }
}

/** Los tres perfiles administrativos devuelven `hint`. */
const admins = (hint: Esperado): Pasan => ({
  adminSin: hint,
  admin: hint,
  owner: hint,
})

/** Solo los que tienen la capacidad (el admin con todas y el dueño). */
const conCapacidad = (hint: Esperado): Pasan => ({ admin: hint, owner: hint })

const U = INEXISTENTE

export const CASOS_RPC: CasoRpc[] = [
  // --- Usuarios, roles y capacidades -----------------------------------------------------------
  caso(
    'set_user_roles',
    () => ({ p_profile_id: U, p_roles: ['employee'] }),
    conCapacidad('PROFILE_NOT_FOUND'),
    { cubre: ['RB-A01', 'RB-X02', 'CB-17'] },
  ),
  caso(
    'set_admin_capability',
    () => ({ p_profile_id: U, p_capability: 'manage_users', p_enabled: true }),
    { owner: 'ADMIN_ROLE_REQUIRED' },
    { cubre: ['RB-A01', 'RB-X02', 'CB-17'] },
  ),
  caso(
    'mark_changes_seen',
    () => ({}),
    {
      empleado: 'OK',
      supervisor: 'OK',
      dual: 'OK',
      adminSin: 'OK',
      admin: 'OK',
      owner: 'OK',
    },
    { cubre: ['RB-E02'] },
  ),
  // Nombre de una persona (0033, P19.5a): el dueño cambia el de cualquiera; los demás, solo el
  // propio. Con un id inexistente, el dueño pasa la puerta y recibe PROFILE_NOT_FOUND; los demás
  // reciben FORBIDDEN sin enterarse de quién existe.
  caso(
    'update_person_name',
    () => ({ p_profile_id: U, p_first_name: 'Prueba', p_last_name: 'Matriz' }),
    { owner: 'PROFILE_NOT_FOUND' },
    { cubre: ['RB-X02'] },
  ),
  // Uso exclusivo de la Edge Function (`service_role`): ni el dueño la puede llamar.
  caso('admin_revoke_user_sessions', () => ({ p_profile_id: U }), {
    empleado: '42501',
    supervisor: '42501',
    dual: '42501',
    adminSin: '42501',
    admin: '42501',
    owner: '42501',
  }),

  // Función de la PLATAFORMA (no está en las migraciones: la crea Supabase con "RLS automática"):
  // es un disparador de eventos, no una RPC de negocio, y nadie de la app debería poder llamarla.
  caso(
    'rls_auto_enable',
    () => ({}),
    {
      empleado: '42501',
      supervisor: '42501',
      dual: '42501',
      adminSin: '42501',
      admin: '42501',
      owner: '42501',
    },
    { cubre: ['RB-X02'] },
  ),

  // --- Resumen por cliente (0033, P19.5a): dueño y administradores ----------------------------
  caso(
    'client_service_summary',
    () => ({ p_client_id: U, p_from: '2099-01-01', p_to: '2099-01-02' }),
    admins('CLIENT_NOT_FOUND'),
    { cubre: ['RB-X02'] },
  ),
  caso(
    'clients_worked_minutes',
    () => ({ p_from: '2099-01-02', p_to: '2099-01-01' }),
    admins('INVALID_DATE_RANGE'),
    { cubre: ['RB-X02'] },
  ),

  // --- Turnos -----------------------------------------------------------------------------------
  caso(
    'create_shift',
    () => ({
      p_client_id: U,
      p_site_id: U,
      p_date: '2099-01-01',
      p_start: '08:00',
      p_end: '12:00',
      p_required_staff: 1,
    }),
    admins('CLIENT_NOT_ACTIVE'),
    { cubre: ['RB-A04'] },
  ),
  // `p_month = 13` se rechaza después de la puerta y sin generar nada.
  caso(
    'generate_shifts',
    () => ({ p_year: 2099, p_month: 13 }),
    conCapacidad('22008'),
    { cubre: ['RB-A04', 'RB-X02'] },
  ),
  caso(
    'update_shift_time',
    () => ({ p_shift_id: U, p_start: '08:00', p_end: '12:00' }),
    admins('SHIFT_NOT_FOUND'),
    { cubre: ['RB-A04'] },
  ),
  caso(
    'cancel_shift',
    () => ({ p_shift_id: U, p_reason: 'e2e-perm' }),
    conCapacidad('SHIFT_NOT_FOUND'),
    { cubre: ['RB-A04', 'RB-X02'] },
  ),
  caso(
    'reload_shift_tasks',
    () => ({ p_shift_id: U }),
    conCapacidad('SHIFT_NOT_FOUND'),
    { cubre: ['RB-A05', 'RB-X02'] },
  ),
  caso(
    'update_shift_details',
    () => ({ p_shift_id: U, p_required_staff: 1 }),
    admins('SHIFT_NOT_FOUND'),
    { cubre: ['RB-A04'] },
  ),

  // --- Asignaciones -----------------------------------------------------------------------------
  caso(
    'assign_employee',
    () => ({ p_shift_id: U, p_employee_id: U }),
    admins('SHIFT_NOT_FOUND'),
    { cubre: ['RB-A04'] },
  ),
  caso(
    'remove_assignment',
    () => ({ p_assignment_id: U, p_reason: 'e2e-perm' }),
    admins('ASSIGNMENT_NOT_FOUND'),
    { cubre: ['RB-A04'] },
  ),
  caso(
    'update_assignment_time',
    () => ({ p_assignment_id: U, p_start: '08:00', p_end: '12:00' }),
    admins('ASSIGNMENT_NOT_FOUND'),
    { cubre: ['RB-A04'] },
  ),

  // --- Plantillas y tareas ----------------------------------------------------------------------
  caso(
    'clone_checklist_template',
    () => ({ p_client_id: U, p_site_id: U }),
    conCapacidad('CLIENT_NOT_ACTIVE'),
    { cubre: ['RB-A05', 'RB-X02'] },
  ),
  // Tarea real del turno A, con el mismo estado que ya tiene (no cambia nada).
  caso(
    'update_task_status',
    (c) => ({ p_task_id: c.e.tareaA, p_status: 'pending' }),
    {
      // Empleado y doble rol: son "empleado" pero no están presentes en el turno A (TASK_LOCKED).
      empleado: 'TASK_LOCKED',
      dual: 'TASK_LOCKED',
      ...admins('OK'),
    },
    { cubre: ['RB-E05', 'CB-12'] },
  ),

  // --- Asistencia y avisos (empleado) -----------------------------------------------------------
  caso(
    'record_check_in',
    () => ({ p_assignment_id: U }),
    { empleado: 'ASSIGNMENT_NOT_FOUND', dual: 'ASSIGNMENT_NOT_FOUND' },
    { cubre: ['RB-E04'] },
  ),
  caso(
    'record_check_in',
    (c) => ({ p_assignment_id: c.e.asigE2 }),
    // Asignación de un compañero: el rol es el correcto pero la fila no es suya.
    { empleado: 'NOT_YOUR_ASSIGNMENT', dual: 'NOT_YOUR_ASSIGNMENT' },
    { variante: 'de un compañero', cubre: ['RB-E04', 'RB-X02'] },
  ),
  caso(
    'record_check_out',
    () => ({ p_assignment_id: U }),
    { empleado: 'ASSIGNMENT_NOT_FOUND', dual: 'ASSIGNMENT_NOT_FOUND' },
    { cubre: ['RB-E04'] },
  ),
  caso(
    'record_check_out',
    (c) => ({ p_assignment_id: c.e.asigE2 }),
    { empleado: 'NOT_YOUR_ASSIGNMENT', dual: 'NOT_YOUR_ASSIGNMENT' },
    { variante: 'de un compañero', cubre: ['RB-E04', 'RB-X02'] },
  ),
  // Observación propia: el empleado y los administradores pueden; la del compañero, no.
  caso(
    'set_assignment_notes',
    (c) => ({ p_assignment_id: c.e.asigE1, p_notes: 'e2e-perm-nota' }),
    { empleado: 'OK', ...admins('OK') },
    { cubre: ['RB-E06'] },
  ),
  caso(
    'set_assignment_notes',
    (c) => ({ p_assignment_id: c.e.asigE2, p_notes: 'e2e-perm-ajena' }),
    { ...admins('OK') },
    { variante: 'del compañero', cubre: ['RB-E06', 'RB-X02'] },
  ),
  // Minutos en 0: se rechazan DESPUÉS de la puerta (MINUTES_REQUIRED) y sin crear el aviso.
  caso(
    'notify_delay',
    (c) => ({ p_assignment_id: c.e.asigE1, p_minutes: 0 }),
    {
      empleado: 'MINUTES_REQUIRED',
      dual: 'NOT_YOUR_ASSIGNMENT',
      admin: 'MINUTES_REQUIRED',
      owner: 'MINUTES_REQUIRED',
    },
    { cubre: ['RB-E07', 'RB-A08'] },
  ),
  caso(
    'notify_delay',
    (c) => ({ p_assignment_id: c.e.asigE2, p_minutes: 0 }),
    {
      empleado: 'NOT_YOUR_ASSIGNMENT',
      dual: 'NOT_YOUR_ASSIGNMENT',
      admin: 'MINUTES_REQUIRED',
      owner: 'MINUTES_REQUIRED',
    },
    { variante: 'del compañero', cubre: ['RB-E07', 'RB-X02'] },
  ),
  // «En camino» (0033, P19.5a): solo el empleado de la asignación; ni el administrador con
  // permiso de asistencia ni el dueño avisan en nombre de otro.
  caso(
    'notify_on_the_way',
    () => ({ p_assignment_id: U }),
    { empleado: 'ASSIGNMENT_NOT_FOUND', dual: 'ASSIGNMENT_NOT_FOUND' },
    { cubre: ['RB-E07'] },
  ),
  caso(
    'notify_on_the_way',
    (c) => ({ p_assignment_id: c.e.asigE2 }),
    { empleado: 'NOT_YOUR_ASSIGNMENT', dual: 'NOT_YOUR_ASSIGNMENT' },
    { variante: 'del compañero', cubre: ['RB-E07', 'RB-X02'] },
  ),
  caso(
    'notify_absence',
    (c) => ({ p_assignment_id: c.e.asigE1, p_reason_code: 'other' }),
    {
      empleado: 'REASON_REQUIRED',
      dual: 'NOT_YOUR_ASSIGNMENT',
      admin: 'REASON_REQUIRED',
      owner: 'REASON_REQUIRED',
    },
    { cubre: ['RB-E07', 'RB-A08'] },
  ),
  caso(
    'notify_absence',
    (c) => ({ p_assignment_id: c.e.asigE2, p_reason_code: 'other' }),
    {
      empleado: 'NOT_YOUR_ASSIGNMENT',
      dual: 'NOT_YOUR_ASSIGNMENT',
      admin: 'REASON_REQUIRED',
      owner: 'REASON_REQUIRED',
    },
    { variante: 'del compañero', cubre: ['RB-E07', 'RB-X02'] },
  ),

  // --- Asistencia en nombre de otro (manage_attendance) -----------------------------------------
  caso(
    'admin_record_attendance',
    () => ({ p_assignment_id: U, p_kind: 'check_in', p_reason: 'e2e-perm' }),
    conCapacidad('ASSIGNMENT_NOT_FOUND'),
    { cubre: ['RB-A08', 'RB-X02'] },
  ),
  caso(
    'close_assignment',
    () => ({ p_assignment_id: U, p_reason: 'e2e-perm' }),
    conCapacidad('ASSIGNMENT_NOT_FOUND'),
    { cubre: ['RB-A08', 'RB-X02'] },
  ),

  // --- Supervisiones ----------------------------------------------------------------------------
  caso(
    'assign_supervision',
    () => ({ p_shift_id: U, p_supervisor_id: U }),
    conCapacidad('SHIFT_NOT_FOUND'),
    { cubre: ['RB-A09', 'RB-X02'] },
  ),
  caso(
    'cancel_supervision',
    () => ({ p_supervision_id: U, p_reason: 'e2e-perm' }),
    conCapacidad('SUPERVISION_NOT_FOUND'),
    { cubre: ['RB-A09', 'RB-X02'] },
  ),
  // La supervisión A ya está en curso: `ALREADY_STARTED` prueba la puerta sin registrar nada.
  caso(
    'supervision_check_in',
    (c) => ({ p_supervision_id: c.e.supA }),
    { supervisor: 'ALREADY_STARTED', dual: 'NOT_YOUR_SUPERVISION' },
    { cubre: ['RB-S01'] },
  ),
  caso(
    'supervision_check_in',
    (c) => ({ p_supervision_id: c.e.supB }),
    { supervisor: 'NOT_YOUR_SUPERVISION', dual: 'NOT_YOUR_SUPERVISION' },
    { variante: 'de otro supervisor', cubre: ['RB-S01', 'RB-X02'] },
  ),
  caso(
    'supervision_check_out',
    (c) => ({ p_supervision_id: c.e.supB }),
    { supervisor: 'NOT_YOUR_SUPERVISION', dual: 'NOT_YOUR_SUPERVISION' },
    { variante: 'de otro supervisor', cubre: ['RB-S01', 'RB-X02'] },
  ),
  caso(
    'complete_supervision',
    (c) => ({ p_supervision_id: c.e.supB }),
    { supervisor: 'NOT_YOUR_SUPERVISION', dual: 'NOT_YOUR_SUPERVISION' },
    { variante: 'de otro supervisor', cubre: ['RB-S04', 'RB-X02'] },
  ),
  // Sin motivo: se rechaza después de la puerta (REASON_REQUIRED) y no marca nada.
  caso(
    'mark_supervision_not_done',
    (c) => ({ p_supervision_id: c.e.supA, p_reason: '' }),
    {
      supervisor: 'REASON_REQUIRED',
      dual: 'NOT_YOUR_SUPERVISION',
      ...admins('REASON_REQUIRED'),
    },
    { cubre: ['RB-S04', 'RB-A09'] },
  ),
  // Puntaje 9: fuera de rango, se rechaza después de la puerta y no califica a nadie.
  caso(
    'rate_employee',
    (c) => ({
      p_supervision_id: c.e.supA,
      p_assignment_id: c.e.asigE1,
      p_score: 9,
    }),
    {
      supervisor: 'SCORE_OUT_OF_RANGE',
      dual: 'NOT_YOUR_SUPERVISION',
      admin: 'SCORE_OUT_OF_RANGE',
      owner: 'SCORE_OUT_OF_RANGE',
    },
    { cubre: ['RB-S04', 'RB-X02', 'CB-14'] },
  ),
  // CB-13: el doble rol supervisa un turno en el que él mismo está asignado y no se califica.
  caso(
    'rate_employee',
    (c) => ({
      p_supervision_id: c.e.supD,
      p_assignment_id: c.e.asigDual,
      p_score: 3,
    }),
    {
      supervisor: 'NOT_YOUR_SUPERVISION',
      dual: 'SELF_RATING_NOT_ALLOWED',
      admin: 'SELF_RATING_NOT_ALLOWED',
      owner: 'SELF_RATING_NOT_ALLOWED',
    },
    { variante: 'a sí mismo (CB-13)', cubre: ['RB-S04', 'CB-13'] },
  ),
]
