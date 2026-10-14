import { Link } from 'react-router'
import { History } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/EmptyState'
import { formatCalendarDate } from '@/lib/format'
import type { MyDayAssignment } from '@/api/myDay'
import { useMyHistoryQuery } from '@/features/employee/queries'
import { StatusBadge } from '@/components/status'
import { AssignmentStatusBadge } from '@/features/employee/components/AssignmentStatusBadge'
import { formatAssignmentRange } from '@/features/employee/shiftRange'
import { formatMediaCounts } from '@/features/employee/mediaCounts'
import { AttendanceMarkRow } from '@/features/employee/components/AttendanceMarkRow'

/**
 * EMP-HIS · Mis servicios anteriores (AJ4-06): los servicios propios ya
 * pasados, sin límite de antigüedad y de a 20 (`v_my_history`), con la fecha
 * más reciente arriba y una tarjeta por asignación. Tocar una tarjeta abre el
 * comprobante (EMP-11) con `?desde=historial`, para que el botón final vuelva
 * acá. Los turnos cancelados y las ausencias se listan igual, con su estado.
 *
 * Módulo B1 (B-19, B-28): cada fichaje muestra si quedó «Validado», «Fuera de
 * zona» o «Sin validar» y la marca «Corregido» si la administración cambió la
 * hora (sin el motivo).
 */
export default function HistoryPage() {
  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useMyHistoryQuery()

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !data) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar tus servicios anteriores. Probá de nuevo en un
          momento.
        </AlertDescription>
      </Alert>
    )
  }

  const items = data.pages.flat()
  if (items.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Todavía no tenés servicios anteriores"
        className="mt-4"
      />
    )
  }

  const groups = groupByDate(items)

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([date, rows]) => (
        <section key={date} className="flex flex-col gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-text-3">
            {formatCalendarDate(date)}
          </h2>
          {rows.map((assignment) => (
            <HistoryCard
              key={assignment.assignmentId}
              assignment={assignment}
            />
          ))}
        </section>
      ))}
      {hasNextPage && (
        <Button
          size="mobile"
          variant="ghost"
          onClick={() => void fetchNextPage()}
          loading={isFetchingNextPage}
        >
          Ver más
        </Button>
      )}
    </div>
  )
}

/** Agrupa por `shiftDate` conservando el orden que ya trae la consulta (más reciente primero). */
function groupByDate(
  items: MyDayAssignment[],
): Array<[string, MyDayAssignment[]]> {
  const groups = new Map<string, MyDayAssignment[]>()
  for (const item of items) {
    const list = groups.get(item.shiftDate)
    if (list) list.push(item)
    else groups.set(item.shiftDate, [item])
  }
  return [...groups.entries()]
}

function HistoryCard({ assignment }: { assignment: MyDayAssignment }) {
  const cancelled = assignment.shiftStatus === 'cancelled'
  return (
    <Link
      to={`/app/resumen/${assignment.assignmentId}?desde=historial`}
      className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      <Card>
        <CardContent className="flex flex-col gap-[6px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-text">
                {assignment.clientName}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {assignment.siteName}
              </p>
            </div>
            {assignment.status === 'expected' &&
            assignment.shiftStatus !== 'cancelled' ? (
              // Un día pasado que sigue «Esperado» no se registró nunca.
              <StatusBadge domain="assignment" status="no_record" />
            ) : (
              <AssignmentStatusBadge assignment={assignment} />
            )}
          </div>
          <p className="text-[12.5px] text-text-2">
            {formatAssignmentRange(assignment)}
          </p>
          <AttendanceMarkRow
            label="Inicio"
            at={assignment.checkInAt}
            geo={assignment.checkInGeo}
            timeCorrected={assignment.checkInTimeCorrected}
          />
          <AttendanceMarkRow
            label="Fin"
            at={assignment.checkOutAt}
            geo={assignment.checkOutGeo}
            timeCorrected={assignment.checkOutTimeCorrected}
          />
          {!cancelled && !assignment.photosNotAllowed && (
            <p className="text-[12px] text-text-3">
              Fotos y videos:{' '}
              {formatMediaCounts(
                assignment.myPhotosCount,
                assignment.myVideosCount,
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
