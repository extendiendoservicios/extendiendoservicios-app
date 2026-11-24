import { useState } from 'react'
import { CalendarX } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { useSupervisorUpcomingQuery } from '@/api/supervisorToday'
import { formatCalendarDate } from '@/lib/format'
import { groupShiftsByDay } from '../shifts'
import { ShiftsBlock } from './TodayShiftsList'

/**
 * Lista de SUP-10 · Próximos días (P31, D-09, OI-07): los turnos de los 7 días
 * siguientes, agrupados por día y, dentro de cada día, en «Mis sedes» y «Otras
 * sedes» igual que «Hoy». Es solo de consulta: sin «Supervisar» ni acciones,
 * el turno se toma el día. El buscador por cliente o sede (uno solo, arriba)
 * filtra «Otras sedes» de todos los días, como en «Hoy».
 */
export function UpcomingShiftsList() {
  const { data, isLoading, isError } = useSupervisorUpcomingQuery()
  const [search, setSearch] = useState('')
  // Solo para rotular y ordenar: ninguna regla depende de la hora del dispositivo.
  const [nowMs] = useState(() => Date.now())

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !data) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar los próximos turnos. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }
  if (data.length === 0) {
    return (
      <EmptyState
        icon={CalendarX}
        title="No hay turnos en los próximos días"
        description="Cuando haya turnos en los próximos 7 días, los vas a ver acá."
        className="mt-2"
      />
    )
  }

  const days = groupShiftsByDay(data, search, nowMs)
  const searching = search.trim() !== ''

  return (
    <div className="flex flex-col gap-5">
      <Input
        mobile
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar por cliente o sede…"
        aria-label="Buscar por cliente o sede"
      />
      {days.length === 0 && (
        <p className="py-2 text-center text-[12.5px] text-text-3">
          No encontramos turnos con esa búsqueda.
        </p>
      )}
      {days.map((day) => (
        <section
          key={day.date}
          aria-label={formatCalendarDate(day.date)}
          className="flex flex-col gap-3"
        >
          <h2 className="text-[14px] font-bold text-text">
            {formatCalendarDate(day.date)}
          </h2>
          <ShiftsBlock
            title="Mis sedes"
            shifts={day.mine}
            nowMs={nowMs}
            emptyText="No hay turnos en tus sedes preferenciales."
            consultOnly
          />
          <ShiftsBlock
            title="Otras sedes"
            shifts={day.others}
            nowMs={nowMs}
            emptyText={
              searching
                ? 'No encontramos turnos con esa búsqueda.'
                : 'No hay turnos en otras sedes.'
            }
            consultOnly
          />
        </section>
      ))}
    </div>
  )
}
