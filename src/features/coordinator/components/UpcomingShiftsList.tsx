import { useState } from 'react'
import { CalendarX } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import type { TodayShift } from '@/api/supervisorToday'
import { dayLabel } from '@/features/upcomingDays/dates'
import { splitTodayShifts } from '../shifts'
import { ShiftsBlock } from './TodayShiftsList'

/**
 * Detalle del día elegido en SUP-10 · Próximos días (P32, D-06): los turnos de
 * ese día en «Mis sedes» y «Otras sedes», con el mismo armado de «Hoy» y el
 * buscador por cliente o sede en «Otras sedes». Es solo de consulta: sin
 * «Supervisar» ni acciones, el turno se toma el día. Recibe los turnos ya
 * cargados (los del mes) y se queda con los del día `date`.
 */
export function UpcomingShiftsList({
  date,
  shifts,
  isLoading,
  isError,
}: {
  /** Día elegido, `"YYYY-MM-DD"`. */
  date: string
  shifts: TodayShift[] | undefined
  isLoading: boolean
  isError: boolean
}) {
  const [search, setSearch] = useState('')
  // Solo para ordenar: ninguna regla depende de la hora del dispositivo.
  const [nowMs] = useState(() => Date.now())

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !shifts) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar los próximos turnos. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }

  const ofDay = shifts.filter((shift) => shift.shiftDate === date)
  if (ofDay.length === 0) {
    return (
      <EmptyState
        icon={CalendarX}
        title={`No hay turnos el ${dayLabel(date)}`}
        description="Elegí otro día del calendario para ver sus turnos."
        className="mt-2"
      />
    )
  }

  const { mine, others } = splitTodayShifts(ofDay, search, nowMs)
  const searching = search.trim() !== ''

  return (
    <div className="flex flex-col gap-5">
      <ShiftsBlock
        title="Mis sedes"
        shifts={mine}
        nowMs={nowMs}
        emptyText="No hay turnos en tus sedes preferenciales."
        consultOnly
      />
      <ShiftsBlock
        title="Otras sedes"
        shifts={others}
        nowMs={nowMs}
        emptyText={
          searching
            ? 'No encontramos turnos con esa búsqueda.'
            : 'No hay turnos en otras sedes.'
        }
        search={{ value: search, onChange: setSearch }}
        consultOnly
      />
    </div>
  )
}
