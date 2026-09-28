import { Link } from 'react-router'
import { ClipboardCheck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import { StarRating } from '@/components/StarRating'
import { StatusBadge } from '@/components/status'
import { formatCalendarDate } from '@/lib/format'
import {
  useHistoryRatingsSummaryQuery,
  useMySupervisionsHistoryQuery,
  type MySupervision,
  type SupervisionRatingsSummary,
} from '@/api/mySupervisions'

/**
 * SUP-08 · Historial (MOB-SUP-008, `05` fila SUP-08, `06` sección 12): las
 * supervisiones completadas y no realizadas, por fecha, con sede y
 * puntajes -- el promedio de las calificaciones cargadas (`StarRating` de
 * solo lectura) y cuántos empleados quedaron calificados sobre el total del
 * turno. El detalle es de solo lectura ("`05` mapa de navegación: SUP-08 →
 * SUP-03 (lectura)"): SUP-03 no ofrece ningún registro ni cierre para una
 * supervisión ya cerrada, y solo ofrece "Calificar" si el plazo de P-083
 * todavía está abierto (poco común llegando desde el historial, pero no
 * imposible -- se completa y se corrige al toque, por ejemplo).
 */
export default function HistoryPage() {
  const { data, isLoading, isError } = useMySupervisionsHistoryQuery()
  const supervisionIds = (data ?? []).map((s) => s.id)
  const { data: summaries } = useHistoryRatingsSummaryQuery(supervisionIds)

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !data) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar tu historial. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Todavía no cerraste ninguna supervisión"
        className="mt-4"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((supervision) => {
        const summary = summaries?.find(
          (s) => s.supervisionId === supervision.id,
        )
        return (
          <HistoryRow
            key={supervision.id}
            supervision={supervision}
            summary={summary}
          />
        )
      })}
    </div>
  )
}

function HistoryRow({
  supervision,
  summary,
}: {
  supervision: MySupervision
  summary: SupervisionRatingsSummary | undefined
}) {
  const total = supervision.assignedEmployees.length
  return (
    <Link to={`/sup/supervisiones/${supervision.id}`} className="block">
      <Card>
        <CardContent className="flex flex-col gap-[6px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-text">
                {supervision.clientName}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {supervision.siteName}
              </p>
            </div>
            <StatusBadge domain="supervision" status={supervision.status} />
          </div>
          <p className="text-[12.5px] text-text-2">
            {formatCalendarDate(supervision.shiftDate)} ·{' '}
            {formatTimeOfDay(supervision.startTime)}–
            {formatTimeOfDay(supervision.endTime)}
          </p>
          {supervision.status === 'completed' && total > 0 && (
            <div className="flex items-center gap-2">
              <StarRating
                value={
                  summary?.averageScore != null
                    ? Math.round(summary.averageScore)
                    : null
                }
                readOnly
                size="sm"
              />
              <p className="text-[11px] text-text-3">
                {summary?.ratedCount ?? 0} de {total}{' '}
                {total === 1 ? 'calificado' : 'calificados'}
              </p>
            </div>
          )}
          {supervision.status === 'not_done' && supervision.notDoneReason && (
            <p className="truncate text-[11px] text-text-3">
              Motivo: {supervision.notDoneReason}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

/** Mismo criterio que el resto de la vía: `"HH:MM:SS"` es hora de pared, no un instante. */
function formatTimeOfDay(time: string): string {
  return time.slice(0, 5)
}
