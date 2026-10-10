import type {
  CreateShiftAssigned,
  CreateShiftRejected,
  GenerateShiftsResult,
  GenerateUnassigned,
} from '@/api/shifts'

/**
 * AJ2-17: lógica pura de asignar empleados al crear un turno suelto y de los
 * empleados fijos del servicio (tope de selección, textos de rechazados y
 * advertencias, resumen de la generación mensual). Sin React ni red, para
 * poder probarla sola.
 */

export type ToggleResult =
  { ok: true; next: string[] } | { ok: false; next: string[]; reason: 'limit' }

/** Aviso cuando ya se llegó al tope (dotación pedida). */
export function selectionLimitMessage(max: number): string {
  return max === 1
    ? 'La dotación es de 1 persona: no podés elegir más.'
    : `La dotación es de ${max} personas: no podés elegir más.`
}

/** Agrega o saca un empleado de la selección, sin pasar el tope. Sacar siempre se puede. */
export function toggleEmployee(
  selected: string[],
  id: string,
  max: number,
): ToggleResult {
  if (selected.includes(id)) {
    return { ok: true, next: selected.filter((item) => item !== id) }
  }
  if (selected.length >= max) {
    return { ok: false, next: selected, reason: 'limit' }
  }
  return { ok: true, next: [...selected, id] }
}

/** Si la dotación baja por debajo de lo elegido, se recorta el sobrante (los últimos). */
export function clampSelection(selected: string[], max: number): string[] {
  return selected.length > max ? selected.slice(0, Math.max(max, 0)) : selected
}

/** Validación del formulario de servicio: replica `FIXED_EXCEEDS_STAFF` del servidor. */
export function fixedEmployeesError(
  selectedCount: number,
  requiredStaff: number,
): string | null {
  if (Number.isFinite(requiredStaff) && selectedCount > requiredStaff) {
    return `Los empleados fijos no pueden ser más que la dotación del servicio (${requiredStaff}).`
  }
  return null
}

/** Una línea por empleado rechazado, con el `message` del servidor tal cual. */
export function rejectedLines(rejected: CreateShiftRejected[]): string[] {
  return rejected.map((item) => `${item.employeeName}: ${item.message}`)
}

/** Título del aviso cuando hay rechazados. */
export function rejectedTitle(count: number): string {
  return count === 1
    ? 'Creamos el turno, pero a una persona no se la pudo asignar:'
    : `Creamos el turno, pero a ${count} personas no se las pudo asignar:`
}

export interface AssignedWarningLine {
  employeeId: string
  employeeName: string
  messages: string[]
}

/**
 * Advertencias de los asignados (no bloquean), con los mismos textos que la
 * asignación manual (`WARNING_MESSAGES` de `AssignEmployeeSheet`).
 */
export function assignedWarningLines(
  assigned: CreateShiftAssigned[],
  names: Record<string, string>,
  messages: Record<string, string>,
): AssignedWarningLine[] {
  return assigned
    .filter((item) => item.warnings.length > 0)
    .map((item) => ({
      employeeId: item.employeeId,
      employeeName: names[item.employeeId] ?? 'Empleado',
      messages: item.warnings.map((code) => messages[code] ?? code),
    }))
}

// -------------------------------------------------------------------------
// Resumen de la generación mensual (ADM-09)
// -------------------------------------------------------------------------

/** «3 asignaciones de empleados fijos». */
export function fixedAssignmentsText(count: number): string {
  return count === 1
    ? '1 asignación de empleados fijos'
    : `${count} asignaciones de empleados fijos`
}

/** «N turnos de días que ya empezaron quedaron sin los empleados fijos». */
export function pastWithoutFixedText(count: number): string | null {
  if (count <= 0) {
    return null
  }
  return count === 1
    ? '1 turno de un día que ya empezó quedó sin los empleados fijos.'
    : `${count} turnos de días que ya empezaron quedaron sin los empleados fijos.`
}

/** `"2026-10-13"` → `"13/10"`. */
export function formatDayMonth(isoDate: string): string {
  const [, month, day] = isoDate.split('-')
  return `${day}/${month}`
}

export interface UnassignedRow {
  key: string
  date: string
  serviceLabel: string
  employeeName: string
  reason: string
}

/** Filas de «no se pudieron asignar», ordenadas por fecha y nombre. `labels`: id de servicio → «Cliente · Sede · Servicio». */
export function unassignedRows(
  unassigned: GenerateUnassigned[],
  labels: Record<string, string>,
): UnassignedRow[] {
  return [...unassigned]
    .sort(
      (a, b) =>
        a.shiftDate.localeCompare(b.shiftDate) ||
        a.employeeName.localeCompare(b.employeeName, 'es'),
    )
    .map((item) => ({
      key: `${item.shiftId}-${item.employeeId}`,
      date: formatDayMonth(item.shiftDate),
      serviceLabel: labels[item.serviceId] ?? 'Servicio',
      employeeName: item.employeeName,
      reason: item.message,
    }))
}

export interface GenerationSummary {
  fixedAssignments: string
  pastWithoutFixed: string | null
  hasUnassigned: boolean
}

export function summarizeGeneration(
  result: GenerateShiftsResult,
): GenerationSummary {
  return {
    fixedAssignments: fixedAssignmentsText(result.assigned),
    pastWithoutFixed: pastWithoutFixedText(result.pastWithoutFixed),
    hasUnassigned: result.unassigned.length > 0,
  }
}
