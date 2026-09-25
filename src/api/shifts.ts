import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'

/**
 * `src/api/shifts.ts` (SHIFT-007, mismo patrón que `src/api/services.ts` y
 * `src/api/users.ts` — ver `src/api/README.md`): turnos de ADM-05, ADM-07 y
 * ADM-09 (`06_API.md` sección 7).
 *
 * A diferencia de `clients.ts`/`sites.ts`/`services.ts`, acá SÍ hay RPC
 * propia para cada escritura (`0023_rpc_shifts.sql`, ya aplicada en
 * `App_dev`): `create_shift`, `generate_shifts`, `update_shift_time`,
 * `cancel_shift`, `reload_shift_tasks`. `0012_rls_policies.sql` sección 9 lo
 * confirma ("Insert/Update/Delete: RPC ... only" — `shifts` no tiene
 * política de escritura directa para ningún rol). Por eso acá no hace falta
 * un `mapWriteError` a mano como en esos otros módulos: los cinco errores
 * `P0001` que puede lanzar cada RPC (ver el comentario de
 * `0023_rpc_shifts.sql`) ya traen `hint` en mayúsculas y `message` en
 * voseo, así que `fromPostgrestError` los deja pasar tal cual.
 *
 * Nota para el reporte del encargo (contradicción entre `06` y el backend
 * ya construido): `06_API.md` sección 7 lista además "Editar notas
 * administrativas | update `shifts.notes` | O, A" como si fuera una
 * escritura directa por PostgREST, pero `0012_rls_policies.sql` no le da a
 * `shifts` ninguna política de insert/update/delete — todas las escrituras
 * pasan por las cinco RPC de arriba, y ninguna de ellas toca `notes` ni
 * `required_staff` de un turno ya creado. `05_Pantallas_y_Navegacion.md`
 * línea 41 (ADM-07) pide que la edición permita cambiar "franja, dotación y
 * notas, según estado", pero el único endpoint de edición que existe es
 * `update_shift_time(p_shift_id, p_start, p_end)`: sin RPC (o política) para
 * dotación o notas de un turno existente, este módulo solo expone
 * `updateShiftTime`. Reportado al orquestador (ver el reporte del encargo);
 * ADM-07 en modo edición queda limitado a la franja horaria hasta que se
 * resuelva.
 */

export type ShiftStatus = Database['public']['Enums']['shift_status']

/** Las cinco etiquetas de `04_Modelo_de_Datos.md` sección 3 (sin los derivados `uncovered`/`upcoming`, que son de `StatusBadge`). */
export const SHIFT_STATUS_LABELS: Record<ShiftStatus, string> = {
  scheduled: 'Programado',
  assigned: 'Asignado',
  in_progress: 'En curso',
  completed: 'Finalizado',
  cancelled: 'Cancelado',
}

// -------------------------------------------------------------------------
// 1. Lista del día (ADM-05, versión mínima de SHIFT-010)
// -------------------------------------------------------------------------

/** Una fila de `v_shifts_board` para la lista de un día (`06` sección 7: "Lista del día"). */
export interface ShiftListRow {
  id: string
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  siteCity: string | null
  shiftDate: string
  startTime: string
  endTime: string
  requiredStaff: number
  status: ShiftStatus
  /** `scheduled`/`assigned`/`in_progress`/`completed`/`cancelled`, o los derivados `uncovered`/`upcoming` (`04` sección 4). */
  displayStatus: string
  assignedCount: number
  presentCount: number
  finishedCount: number
  absentCount: number
  delayedCount: number
  generated: boolean
  notes: string | null
}

interface ShiftBoardRow {
  id: string
  client_id: string
  client_legal_name: string
  client_trade_name: string | null
  site_id: string
  site_name: string
  site_city: string | null
  shift_date: string
  start_time: string
  end_time: string
  required_staff: number
  status: ShiftStatus
  display_status: string
  assigned_count: number
  present_count: number
  finished_count: number
  absent_count: number
  delayed_count: number
  generated: boolean
  notes: string | null
}

function mapShiftBoardRow(row: ShiftBoardRow): ShiftListRow {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_trade_name ?? row.client_legal_name,
    siteId: row.site_id,
    siteName: row.site_name,
    siteCity: row.site_city,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    requiredStaff: row.required_staff,
    status: row.status,
    displayStatus: row.display_status,
    assignedCount: row.assigned_count,
    presentCount: row.present_count,
    finishedCount: row.finished_count,
    absentCount: row.absent_count,
    delayedCount: row.delayed_count,
    generated: row.generated,
    notes: row.notes,
  }
}

const SHIFT_BOARD_SELECT =
  'id, client_id, client_legal_name, client_trade_name, site_id, site_name, site_city, shift_date, start_time, end_time, required_staff, status, display_status, assigned_count, present_count, finished_count, absent_count, delayed_count, generated, notes'

/**
 * ADM-05 mínima (SHIFT-010): turnos de una fecha, ordenados por hora
 * (`06` sección 7: "Lista del día | ... | Polling 30 s"). El polling en sí
 * lo arma el hook de `src/features/shifts/queries.ts`, no esta función.
 */
export async function fetchShiftsByDate(date: string): Promise<ShiftListRow[]> {
  const { data, error } = await supabase
    .from('v_shifts_board')
    .select(SHIFT_BOARD_SELECT)
    .eq('shift_date', date)
    .order('start_time', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => mapShiftBoardRow(row as ShiftBoardRow))
}

/**
 * Datos mínimos de un turno para el modo edición de ADM-07 (SHIFT-008):
 * franja actual, estado (decide qué se puede tocar según `04` sección 6.1)
 * y los nombres de cliente/sede, de solo lectura en ese modo. No es el
 * detalle completo de ADM-06 (asignaciones, tareas, asistencia,
 * supervisiones): eso es de F11.
 */
export interface ShiftEditRow {
  id: string
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  shiftDate: string
  startTime: string
  endTime: string
  requiredStaff: number
  status: ShiftStatus
  notes: string | null
}

export async function fetchShiftForEdit(id: string): Promise<ShiftEditRow> {
  const { data, error } = await supabase
    .from('v_shifts_board')
    .select(SHIFT_BOARD_SELECT)
    .eq('id', id)
    .single()

  if (error) {
    throw fromPostgrestError(error)
  }
  const row = data as ShiftBoardRow
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_trade_name ?? row.client_legal_name,
    siteId: row.site_id,
    siteName: row.site_name,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    requiredStaff: row.required_staff,
    status: row.status,
    notes: row.notes,
  }
}

// -------------------------------------------------------------------------
// 2. create_shift (ADM-07, alta puntual — SHIFT-008)
// -------------------------------------------------------------------------

export interface CreateShiftInput {
  clientId: string
  siteId: string
  date: string
  start: string
  end: string
  requiredStaff: number
  serviceId?: string
  notes?: string | null
}

export interface CreateShiftResult {
  shiftId: string
  /** `'HOLIDAY'` es la única advertencia que documenta `06` sección 7 (informativa, no bloquea). */
  warnings: string[]
}

/**
 * Turno puntual o manual (`06` sección 7: `create_shift`). Devuelve el id
 * del turno recién creado y las advertencias (`HOLIDAY`, si la fecha es
 * feriado) para que ADM-07 las muestre antes de navegar a la lista.
 */
export async function createShift(
  input: CreateShiftInput,
): Promise<CreateShiftResult> {
  const { data, error } = await supabase.rpc('create_shift', {
    p_client_id: input.clientId,
    p_site_id: input.siteId,
    p_date: input.date,
    p_start: input.start,
    p_end: input.end,
    p_required_staff: input.requiredStaff,
    p_service_id: input.serviceId,
    p_notes: input.notes ?? undefined,
  })

  if (error) {
    throw fromPostgrestError(error)
  }

  const payload = data as { shift: { id: string }; warnings: string[] }
  return { shiftId: payload.shift.id, warnings: payload.warnings ?? [] }
}

// -------------------------------------------------------------------------
// 3. generate_shifts (ADM-09 — SHIFT-009)
// -------------------------------------------------------------------------

export interface GenerateShiftsResult {
  created: number
  skipped: number
  holidaysSkipped: number
}

/**
 * Resumen previo de ADM-09 (`05` línea 43: "resumen previo (servicios
 * activos, feriados del mes)"). Cuenta servicios `active` cuya vigencia
 * toca algún día del mes pedido, sin filtrar por cliente/sede activos: es
 * una aproximación para orientar antes de generar, no repite la lógica
 * exacta de `generate_shifts` (que sí exige cliente y sede activos y
 * recorre día por día) — decisión propia, documentada en el reporte del
 * encargo. El conteo real de turnos creados lo da la propia RPC.
 */
export async function fetchActiveServicesCountForMonth(
  year: number,
  month: number,
): Promise<number> {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const { count, error } = await supabase
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .is('deleted_at', null)
    .lte('valid_from', to)
    .or(`valid_to.is.null,valid_to.gte.${from}`)

  if (error) {
    throw fromPostgrestError(error)
  }
  return count ?? 0
}

/**
 * Generación mensual idempotente (`06` sección 6: `generate_shifts`,
 * capacidad `generate_shifts`). "Regenerar" solo crea los turnos que
 * faltan: nunca borra ni modifica los que ya existían (P-044).
 */
export async function generateShifts(
  year: number,
  month: number,
): Promise<GenerateShiftsResult> {
  const { data, error } = await supabase.rpc('generate_shifts', {
    p_year: year,
    p_month: month,
  })

  if (error) {
    throw fromPostgrestError(error)
  }

  const payload = data as {
    created: number
    skipped: number
    holidays_skipped: number
  }
  return {
    created: payload.created,
    skipped: payload.skipped,
    holidaysSkipped: payload.holidays_skipped,
  }
}

// -------------------------------------------------------------------------
// 4. update_shift_time (ADM-07 edición — SHIFT-008)
// -------------------------------------------------------------------------

/**
 * Cambia la franja de un turno existente (`06` sección 7: `update_shift_time`).
 * Ver la nota del comentario de arriba: es la única escritura de edición
 * que existe hoy para un turno ya creado (sin RPC para dotación ni notas).
 */
export async function updateShiftTime(
  shiftId: string,
  start: string,
  end: string,
): Promise<void> {
  const { error } = await supabase.rpc('update_shift_time', {
    p_shift_id: shiftId,
    p_start: start,
    p_end: end,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}

// -------------------------------------------------------------------------
// 5. cancel_shift (diálogo de cancelación — SHIFT-011)
// -------------------------------------------------------------------------

/** Cancela un turno con motivo obligatorio (`06` sección 7: `cancel_shift`, capacidad `cancel_shifts`). */
export async function cancelShift(
  shiftId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.rpc('cancel_shift', {
    p_shift_id: shiftId,
    p_reason: reason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}

// -------------------------------------------------------------------------
// 6. reload_shift_tasks (uso de ADM-06, F11 — se deja lista para esa fase)
// -------------------------------------------------------------------------

/**
 * Recarga el checklist vigente de un turno (`06` sección 7:
 * `reload_shift_tasks`, capacidad `edit_checklists`). Ninguna pantalla de
 * este paquete la usa todavía (el detalle del turno, ADM-06, es de F11);
 * se agrega acá porque `src/api/shifts.ts` es el único módulo del dominio y
 * `06` sección 7 la incluye entre las cinco RPC de turnos.
 */
export async function reloadShiftTasks(shiftId: string): Promise<void> {
  const { error } = await supabase.rpc('reload_shift_tasks', {
    p_shift_id: shiftId,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}
