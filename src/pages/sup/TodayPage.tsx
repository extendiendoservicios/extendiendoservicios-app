import { Link } from 'react-router'
import { CalendarX, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/status'
import { formatCalendarDate } from '@/lib/format'
import { useMySupervisionsUpcomingQuery } from '@/api/mySupervisions'
import type { MySupervision } from '@/api/mySupervisions'
import { InstallBanner } from '@/components/InstallBanner'
import { formatSupervisionRange } from '@/features/employee/shiftRange'

/**
 * SUP-02 · Hoy (MOB-SUP-002, `06` sección 12, `05` fila SUP-02): las
 * supervisiones de hoy con cliente, sede, franja, estado y los empleados a
 * supervisar (cantidad y nombres), más el bloque "Próximos días" (7 días) y
 * el estado vacío.
 *
 * Mismo rango que `useMySupervisionsUpcomingQuery` (hoy y los próximos 7
 * días, P-093 aplicado también acá): a diferencia de EMP-03, esta pantalla
 * no tiene un bloque de "cambios desde tu última visita" (`v_my_supervisions`
 * no trae `changed_since_last_seen`, `06` sección 12 no lo pide para el
 * supervisor) ni una tarjeta "destacada" (SUP-02 no la pide, a diferencia de
 * EMP-03): todas las supervisiones de hoy se listan igual, en el orden que
 * ya trae la consulta (fecha y hora).
 */
export default function SupervisorTodayPage() {
  const { data, isLoading, isError } = useMySupervisionsUpcomingQuery()

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

  const today = data.filter((s) => s.isToday)
  const upcoming = data.filter((s) => !s.isToday)

  return (
    <div className="flex flex-col gap-4">
      <InstallBanner />

      {today.length === 0 ? (
        <EmptyState
          icon={CalendarX}
          title="No tenés supervisiones hoy"
          className="mt-4"
        />
      ) : (
        today.map((supervision) => (
          <SupervisionCard key={supervision.id} supervision={supervision} />
        ))
      )}

      {upcoming.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
            Próximos días
          </p>
          {upcoming.map((supervision) => (
            <UpcomingRow key={supervision.id} supervision={supervision} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Nombres de los empleados asignados, para la lista de la tarjeta (`05` fila SUP-02: "cantidad y nombres"). */
export function employeeNames(supervision: MySupervision): string {
  return supervision.assignedEmployees
    .map((e) => `${e.firstName} ${e.lastName}`.trim())
    .join(', ')
}

function SupervisionCard({ supervision }: { supervision: MySupervision }) {
  const names = employeeNames(supervision)
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
          <p className="text-[13px] font-semibold text-text-2">
            {formatSupervisionRange(supervision)}
          </p>
          {supervision.assignedEmployees.length > 0 && (
            <p className="flex items-center gap-[6px] text-[11.5px] text-text-3">
              <Users aria-hidden="true" className="size-[13px] shrink-0" />
              <span className="truncate">
                {supervision.assignedEmployees.length}{' '}
                {supervision.assignedEmployees.length === 1
                  ? 'empleado'
                  : 'empleados'}{' '}
                · {names}
              </span>
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

function UpcomingRow({ supervision }: { supervision: MySupervision }) {
  return (
    <Link
      to={`/sup/supervisiones/${supervision.id}`}
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-[9px]"
    >
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-text">
          {formatCalendarDate(supervision.shiftDate)} · {supervision.siteName}
        </p>
        <p className="truncate text-[11px] text-text-3">
          {formatSupervisionRange(supervision)}
        </p>
      </div>
      <StatusBadge domain="supervision" status={supervision.status} />
    </Link>
  )
}
