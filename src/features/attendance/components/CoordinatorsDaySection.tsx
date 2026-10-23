import { useMemo } from 'react'
import { Link } from 'react-router'
import { TriangleAlert, UserCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { formatMinutes, formatTime } from '@/lib/format'
import {
  SUPERVISOR_STATUS_LABELS,
  SUPERVISOR_STATUS_VARIANTS,
  coordinatorWorkdayPath,
} from '@/features/geo/coordinators'
import { useSupervisorStatusQuery } from '@/features/geo/queries'
import { useWorkdaysByDateQuery } from '../queries'
import {
  rowFromStatus,
  rowFromWorkday,
  sortCoordinatorRows,
  type CoordinatorDayRow,
} from '../coordinatorDay'

/**
 * Sección «Coordinadores» de «Asistencia de hoy» (ADM-10, P24.4, CJ-13,
 * CJ-31): el estado de la jornada de cada coordinador, sus horas netas del
 * día (las supervisiones no suman) y la advertencia si la jornada se cerró
 * sola. Hoy se refresca cada 60 s con el estado de los coordinadores; en otras
 * fechas es solo lectura de las jornadas de ese día.
 */
function CoordinatorsDaySection({
  date,
  isToday,
}: {
  date: string
  isToday: boolean
}) {
  const statusQuery = useSupervisorStatusQuery(isToday)
  const workdaysQuery = useWorkdaysByDateQuery(date, !isToday)

  const rows = useMemo(
    () =>
      sortCoordinatorRows(
        isToday
          ? (statusQuery.data ?? []).map(rowFromStatus)
          : (workdaysQuery.data ?? []).map(rowFromWorkday),
      ),
    [isToday, statusQuery.data, workdaysQuery.data],
  )
  const query = isToday ? statusQuery : workdaysQuery

  const columns: DataTableColumnDef<CoordinatorDayRow>[] = useMemo(
    () => [
      {
        id: 'name',
        header: 'Coordinador',
        meta: { card: 'title' },
        cell: ({ row }) => (
          <Link
            to={coordinatorWorkdayPath(row.original.supervisorId)}
            className="font-semibold text-text hover:text-primary-800"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'status',
        header: 'Jornada',
        meta: { card: 'trailing' },
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={SUPERVISOR_STATUS_VARIANTS[row.original.status]}>
              {SUPERVISOR_STATUS_LABELS[row.original.status]}
            </Badge>
            {row.original.onLeave && (
              <Badge variant="neutral">De licencia</Badge>
            )}
          </div>
        ),
      },
      {
        id: 'start',
        header: 'Inicio',
        meta: { card: 'meta', cardLabel: 'Inicio' },
        cell: ({ row }) =>
          row.original.startedAt ? formatTime(row.original.startedAt) : '—',
      },
      {
        id: 'end',
        header: 'Fin',
        meta: { card: 'meta', cardLabel: 'Fin' },
        cell: ({ row }) =>
          row.original.endedAt ? formatTime(row.original.endedAt) : '—',
      },
      {
        id: 'hours',
        header: 'Horas',
        meta: { card: 'meta', cardLabel: 'Horas' },
        cell: ({ row }) =>
          row.original.startedAt
            ? formatMinutes(row.original.workedMinutes)
            : '—',
      },
      {
        id: 'notes',
        header: 'Novedad',
        meta: { card: 'meta', cardLabel: 'Novedad' },
        cell: ({ row }) => {
          const item = row.original
          const pause = item.status === 'paused' ? item.pauseReason : null
          if (!item.autoCloseWarning && !item.corrected && !pause) {
            return '—'
          }
          return (
            <div className="flex flex-col gap-0.5 text-[12.5px]">
              {item.autoCloseWarning && (
                <span className="flex items-center gap-1 font-medium text-warning-800">
                  <TriangleAlert aria-hidden="true" className="size-3.5" />
                  Se cerró sola: revisá el horario de fin
                </span>
              )}
              {item.corrected && (
                <span className="text-text-2">
                  Corregida por la administración
                </span>
              )}
              {pause && <span className="text-text-2">Pausa: {pause}</span>}
            </div>
          )
        },
      },
    ],
    [],
  )

  return (
    <section aria-label="Coordinadores" className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold text-text">Coordinadores</h2>
      {query.error && (
        <p role="alert" className="text-[13px] text-danger-800">
          {query.error.message}
        </p>
      )}
      <DataTable
        caption="Jornada de los coordinadores"
        columns={columns}
        data={rows}
        getRowId={(row) => row.supervisorId}
        isLoading={query.isLoading}
        emptyState={{
          icon: UserCheck,
          title: 'No hay jornadas de coordinadores para este día',
        }}
      />
    </section>
  )
}

export { CoordinatorsDaySection }
