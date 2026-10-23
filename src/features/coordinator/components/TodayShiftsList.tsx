import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CalendarX, Search, Users } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/EmptyState'
import { useSupervisorTodayQuery, type TodayShift } from '@/api/supervisorToday'
import { formatSupervisionRange } from '@/features/employee/shiftRange'
import {
  SHIFT_STATE_LABELS,
  effectiveShiftState,
  splitTodayShifts,
  supervisorsLabels,
} from '../shifts'

const STATE_VARIANTS = {
  in_progress: 'primary',
  pending: 'neutral',
  finished: 'success',
} as const

/**
 * Lista de turnos del día de SUP-02 (P24.2, CJ-02, CJ-04, CJ-25): dos bloques,
 * «Mis sedes» y «Otras sedes». En cada uno van primero los turnos en curso,
 * después los que faltan y al final los terminados. Cada turno muestra quién
 * lo supervisa o ya lo supervisó («Supervisando: Ana») para que no se pisen.
 * «Otras sedes» tiene buscador por cliente o sede. Cualquier turno se puede
 * tomar: las sedes propias solo ordenan.
 */
/** Reloj de la pantalla: se actualiza cada 30 s para que los turnos pasen de estado solos. */
function useNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return nowMs
}

export function TodayShiftsList() {
  const nowMs = useNowMs()
  const { data, isLoading, isError } = useSupervisorTodayQuery()
  const [search, setSearch] = useState('')

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !data) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar los turnos de hoy. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }
  if (data.length === 0) {
    return (
      <EmptyState
        icon={CalendarX}
        title="No hay turnos hoy"
        description="Cuando haya turnos para hoy, los vas a ver acá."
        className="mt-2"
      />
    )
  }

  const { mine, others } = splitTodayShifts(data, search, nowMs)
  const searching = search.trim() !== ''

  return (
    <div className="flex flex-col gap-5">
      <ShiftsBlock
        title="Mis sedes"
        shifts={mine}
        nowMs={nowMs}
        emptyText="Hoy no hay turnos en tus sedes preferenciales."
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
      />
    </div>
  )
}

function ShiftsBlock({
  title,
  shifts,
  nowMs,
  emptyText,
  search,
}: {
  title: string
  shifts: TodayShift[]
  nowMs: number
  emptyText: string
  search?: { value: string; onChange: (value: string) => void }
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
        {title}
      </p>
      {search && (
        <Input
          mobile
          type="search"
          icon={Search}
          value={search.value}
          onChange={(event) => search.onChange(event.target.value)}
          placeholder="Buscar por cliente o sede…"
          aria-label="Buscar por cliente o sede"
        />
      )}
      {shifts.length === 0 ? (
        <p className="py-2 text-center text-[12.5px] text-text-3">
          {emptyText}
        </p>
      ) : (
        shifts.map((shift) => (
          <ShiftCard key={shift.shiftId} shift={shift} nowMs={nowMs} />
        ))
      )}
    </section>
  )
}

function ShiftCard({ shift, nowMs }: { shift: TodayShift; nowMs: number }) {
  const state = effectiveShiftState(shift, nowMs)
  const supervisors = supervisorsLabels(shift)
  const employeesCount = shift.assignedEmployees.length
  return (
    <Link to={`/sup/turnos/${shift.shiftId}`} className="block">
      <Card>
        <CardContent className="flex flex-col gap-[6px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-text">
                {shift.clientName}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {shift.siteName}
              </p>
            </div>
            <Badge variant={STATE_VARIANTS[state]} dot>
              {SHIFT_STATE_LABELS[state]}
            </Badge>
          </div>
          <p className="text-[13px] font-semibold text-text-2">
            {formatSupervisionRange({
              startTime: shift.startTime,
              endTime: shift.endTime,
              shiftOpenEnded: shift.openEnded,
            })}
          </p>
          {employeesCount > 0 && (
            <p className="flex items-center gap-[6px] text-[11.5px] text-text-3">
              <Users aria-hidden="true" className="size-[13px] shrink-0" />
              <span className="truncate">
                {employeesCount}{' '}
                {employeesCount === 1 ? 'empleado' : 'empleados'}
              </span>
            </p>
          )}
          {supervisors.map((label) => (
            <p
              key={label}
              className="text-[11.5px] font-semibold text-info-800"
            >
              {label}
            </p>
          ))}
        </CardContent>
      </Card>
    </Link>
  )
}
