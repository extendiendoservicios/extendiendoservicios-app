import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  readCalendarFilters,
  writeCalendarFilters,
  type CalendarFilters,
} from '@/features/planning/calendarFilters'

/**
 * Filtros del calendario (OD-12) guardados en la URL de Planificación:
 * `?cliente=&sede=&empleado=&estado=`. Las tres vistas (mes, semana y día)
 * leen los mismos, así se conservan al cambiar de vista. Cambiar el cliente
 * limpia la sede (una sede pertenece a un cliente).
 */
export function useCalendarFilters(): [
  CalendarFilters,
  (patch: Partial<CalendarFilters>) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(
    () => readCalendarFilters(searchParams),
    [searchParams],
  )
  const update = useCallback(
    (patch: Partial<CalendarFilters>) => {
      setSearchParams(
        (current) => {
          const next = { ...readCalendarFilters(current), ...patch }
          if (patch.clientId !== undefined && patch.siteId === undefined) {
            next.siteId = 'all'
          }
          return writeCalendarFilters(current, next)
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )
  return [filters, update]
}
