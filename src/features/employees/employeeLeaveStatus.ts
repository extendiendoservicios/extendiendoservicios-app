import { format } from 'date-fns'
import { tz } from '@date-fns/tz'
import { BUENOS_AIRES_TIME_ZONE } from '@/lib/format'

/**
 * EMP-008: estado derivado de una licencia (pestaña Licencias de ADM-17),
 * sin React -- así se testea sin fechas del sistema operativo de por medio.
 * Mismo criterio que `v_employees.effective_status` (`0011_views.sql`):
 * "vigente" es `starts_on <= hoy <= coalesce(ends_on, hoy)`, pero acá hace
 * falta distinguir además "futura" (todavía no empezó) de "terminada" (ya
 * terminó) para mostrarlas en la lista -- la vista solo necesita el booleano
 * "hay alguna vigente", no la clasificación completa de cada una.
 */
export type EmployeeLeaveDerivedStatus = 'upcoming' | 'current' | 'ended'

export const EMPLOYEE_LEAVE_STATUS_LABELS: Record<
  EmployeeLeaveDerivedStatus,
  string
> = {
  upcoming: 'Futura',
  current: 'Vigente',
  ended: 'Terminada',
}

/** Fecha de hoy en Buenos Aires (ADR-019), como `"YYYY-MM-DD"`. */
export function todayInBuenosAires(): string {
  return format(new Date(), 'yyyy-MM-dd', { in: tz(BUENOS_AIRES_TIME_ZONE) })
}

/**
 * Compara por texto (`"YYYY-MM-DD"` ordena igual que la fecha real): sin
 * pasar por `Date`, evita el corrimiento de zona horaria que documenta
 * `formatCalendarDate` en `src/lib/format.ts`.
 */
export function deriveEmployeeLeaveStatus(
  leave: { startsOn: string; endsOn: string | null },
  today: string = todayInBuenosAires(),
): EmployeeLeaveDerivedStatus {
  if (leave.startsOn > today) {
    return 'upcoming'
  }
  if (leave.endsOn != null && leave.endsOn < today) {
    return 'ended'
  }
  return 'current'
}
