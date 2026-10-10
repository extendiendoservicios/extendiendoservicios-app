import { Link } from 'react-router'
import { ClipboardList } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/status'
import { formatCalendarDate } from '@/lib/format'
import { useMySupervisionsPendingQuery } from '@/api/mySupervisions'
import { formatSupervisionRange } from '@/features/employee/shiftRange'

/**
 * SUP-07 · Supervisiones (tab) (MOB-SUP-003, `06` sección 12, `05` fila
 * SUP-07): todas las supervisiones asignadas y en curso, futuras incluidas,
 * ordenadas por fecha (`useMySupervisionsPendingQuery`, sin acotar a los
 * próximos 7 días como SUP-02 -- una supervisión asignada de hace varios
 * días que nadie canceló también tiene que verse acá).
 */
export default function SupervisionsPage() {
  const { data, isLoading, isError } = useMySupervisionsPendingQuery()

  if (isLoading) {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }
  if (isError || !data) {
    return (
      <Alert variant="crit">
        <AlertDescription>
          No pudimos cargar tus supervisiones. Probá de nuevo en un momento.
        </AlertDescription>
      </Alert>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No tenés supervisiones asignadas"
        className="mt-4"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((supervision) => (
        <Link
          key={supervision.id}
          to={`/sup/supervisiones/${supervision.id}`}
          className="block"
        >
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
                {formatSupervisionRange(supervision)}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  )
}
