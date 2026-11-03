import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'

export interface GenerationMonth {
  year: number
  month: number
}

/**
 * OD-27: mes que se ofrece generar al crear o reactivar un servicio. Es el mes
 * en curso, salvo que la fecha de inicio caiga en un mes futuro: entonces es
 * el mes de esa fecha. Compara por texto (`"YYYY-MM-DD"`), sin pasar por `Date`.
 */
export function generationMonthFor(
  validFrom: string | null | undefined,
  today: string = todayInBuenosAires(),
): GenerationMonth {
  const base =
    validFrom && validFrom.slice(0, 7) > today.slice(0, 7) ? validFrom : today
  return {
    year: Number(base.slice(0, 4)),
    month: Number(base.slice(5, 7)),
  }
}

/** «noviembre 2026». */
export function formatGenerationMonth({
  year,
  month,
}: GenerationMonth): string {
  return format(new Date(year, month - 1, 1), 'MMMM yyyy', { locale: es })
}
