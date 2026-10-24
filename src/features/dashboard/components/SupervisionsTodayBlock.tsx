import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { formatMinutes, formatTime } from '@/lib/format'
import type { SupervisorStatusRow } from '@/api/supervisorStatus'
import {
  coordinatorName,
  coordinatorStatusDetail,
  coordinatorWorkdayPath,
  SUPERVISOR_STATUS_LABELS,
  SUPERVISOR_STATUS_VARIANTS,
} from '@/features/geo/coordinators'
import { summarizeCoordinatorWorkdays } from '../coordinatorWorkdays'

function WorkdayRow({ row }: { row: SupervisorStatusRow }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <Link
        to={coordinatorWorkdayPath(row.supervisorId)}
        className="min-w-0 text-[13px] text-text hover:text-primary-800 max-md:flex max-md:min-h-11 max-md:items-center"
      >
        <span className="min-w-0">
          <span className="font-semibold">{coordinatorName(row)}</span>
          <span className="block text-[12px] text-text-3">
            {coordinatorStatusDetail(row)}
            {row.startedAt ? ` · desde las ${formatTime(row.startedAt)}` : ''}
            {row.endedAt ? ` hasta las ${formatTime(row.endedAt)}` : ''}
            {` · ${formatMinutes(row.workedMinutes)}`}
          </span>
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-1.5">
        {row.autoClosed && !row.corrected && (
          <Badge variant="warning">Cerrada automáticamente</Badge>
        )}
        {row.corrected && <Badge variant="neutral">Corregida</Badge>}
        <Badge variant={SUPERVISOR_STATUS_VARIANTS[row.status]}>
          {SUPERVISOR_STATUS_LABELS[row.status]}
        </Badge>
      </div>
    </li>
  )
}

/**
 * Supervisiones de hoy (DASH-007, reformulado en P24.4): ya no hay
 * supervisiones «asignadas», así que el bloque muestra las jornadas de los
 * coordinadores: las abiertas ahora y las que se cerraron solas (CJ-31), con
 * enlace a la jornada. El tiempo de cada supervisión es informativo y no suma
 * horas (CJ-14); el detalle sigue en «Supervisiones».
 */
function SupervisionsTodayBlock({
  rows,
  isLoading,
}: {
  rows: SupervisorStatusRow[]
  isLoading: boolean
}) {
  const { open, autoClosed } = summarizeCoordinatorWorkdays(rows)
  return (
    <section
      aria-label="Supervisiones de hoy"
      className="rounded-lg border border-border bg-surface p-4 shadow-card"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">
          Supervisiones de hoy
        </h2>
        <Link
          to="/admin/supervisiones"
          className="inline-flex items-center text-[12.5px] font-medium text-primary-800 hover:underline max-md:min-h-11"
        >
          Ver todas
        </Link>
      </div>
      {isLoading ? (
        <p className="text-[12.5px] text-text-3">Cargando…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-[12.5px] font-semibold text-text-2">
              Jornadas abiertas: {open.length}
            </h3>
            {open.length === 0 ? (
              <p className="text-[12.5px] text-text-3">
                No hay coordinadores con la jornada abierta.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {open.map((row) => (
                  <WorkdayRow key={row.supervisorId} row={row} />
                ))}
              </ul>
            )}
          </div>
          {autoClosed.length > 0 && (
            <div>
              <h3 className="text-[12.5px] font-semibold text-text-2">
                Cerradas automáticamente: {autoClosed.length}
              </h3>
              <ul className="divide-y divide-border">
                {autoClosed.map((row) => (
                  <WorkdayRow key={row.supervisorId} row={row} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export { SupervisionsTodayBlock }
