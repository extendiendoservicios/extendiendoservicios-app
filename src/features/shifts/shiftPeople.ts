import type { AttendanceBoardRow } from '@/api/attendance'
import type { SupervisionListRow } from '@/api/supervisions'

/**
 * AJ2-18: quiénes están asignados a cada turno (empleados vigentes y
 * supervisor designado), para la vista por día de la planificación. Lógica
 * sin React. Se arma con dos consultas por día (no una por turno):
 * `v_assignments_board` del día y `v_supervisions_admin` del día.
 */

export interface ShiftPeople {
  /** «Nombre Apellido» de cada empleado vigente, ordenados por apellido. */
  employees: string[]
  /** Supervisor designado (supervisión no cancelada), si existe. */
  supervisors: string[]
}

const EMPTY: ShiftPeople = { employees: [], supervisors: [] }

function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim()
}

/** Agrupa por turno. Ignora asignaciones quitadas y supervisiones canceladas. */
export function groupShiftPeople(
  assignments: AttendanceBoardRow[],
  supervisions: SupervisionListRow[],
): Map<string, ShiftPeople> {
  const byShift = new Map<
    string,
    { employees: { sort: string; name: string }[]; supervisors: string[] }
  >()
  const entry = (shiftId: string) => {
    let value = byShift.get(shiftId)
    if (!value) {
      value = { employees: [], supervisors: [] }
      byShift.set(shiftId, value)
    }
    return value
  }

  for (const row of assignments) {
    if (row.removedAt != null) {
      continue
    }
    entry(row.shiftId).employees.push({
      sort: `${row.employeeLastName} ${row.employeeFirstName}`,
      name: fullName(row.employeeFirstName, row.employeeLastName),
    })
  }
  for (const row of supervisions) {
    if (row.status === 'cancelled') {
      continue
    }
    entry(row.shiftId).supervisors.push(
      fullName(row.supervisorFirstName, row.supervisorLastName),
    )
  }

  const result = new Map<string, ShiftPeople>()
  for (const [shiftId, value] of byShift) {
    result.set(shiftId, {
      employees: value.employees
        .sort((a, b) => a.sort.localeCompare(b.sort, 'es'))
        .map((employee) => employee.name),
      supervisors: value.supervisors,
    })
  }
  return result
}

export function peopleOfShift(
  people: Map<string, ShiftPeople> | undefined,
  shiftId: string,
): ShiftPeople {
  return people?.get(shiftId) ?? EMPTY
}

/**
 * Resumen en una línea: los primeros `max` nombres y «+N» con el resto.
 * `full` es la lista completa (para el `title` y los lectores de pantalla).
 */
export function summarizeNames(
  names: string[],
  max = 2,
): { text: string; extra: number; full: string } {
  const shown = names.slice(0, max)
  const extra = Math.max(0, names.length - shown.length)
  return {
    text: shown.join(', ') + (extra > 0 ? ` +${extra}` : ''),
    extra,
    full: names.join(', '),
  }
}
