import { useState } from 'react'
import { Link } from 'react-router'
import {
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Eraser,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/IconButton'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/status'
import type { ServiceSummary } from '@/api/services'
import { isShiftUncovered, type ServiceCoverage } from '@/api/serviceCoverage'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { useServicesCoverageQuery } from '@/features/services/coverageQueries'
import {
  useServicesByClientQuery,
  useServicesBySiteQuery,
} from '@/features/services/queries'
import { formatServiceDays } from '@/features/services/weekdays'
import { OPEN_ENDED_LABEL } from '@/features/shifts/openEnded'
import { ChangeServiceStatusDialog } from './ChangeServiceStatusDialog'
import { DeleteServiceShiftsDialog } from './DeleteServiceShiftsDialog'
import { useAuth } from '@/features/auth/AuthProvider'
import { OwnerDeleteDialog } from '@/features/ownerDelete/components/OwnerDeleteDialog'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { canOwnerDelete } from '@/features/ownerDelete/matching'

/** `"HH:mm:ss"` (columna `time` de Postgres) → `"HH:mm"`. */
function shortTime(time: string): string {
  return time.slice(0, 5)
}

/**
 * Fijos y turno de hoy o el próximo del servicio (OF-04). «Sin cubrir»
 * cuando al turno le falta dotación.
 */
function ServiceCoverageInfo({
  service,
  coverage,
}: {
  service: ServiceSummary
  coverage: ServiceCoverage | undefined
}) {
  if (!coverage) return null
  const shift = coverage.nextShift
  return (
    <div className="mt-2 flex flex-col gap-1 text-[12px] text-text-2">
      <p>
        <span className="text-text-3">Fijos: </span>
        {coverage.fixedEmployees.length === 0
          ? 'ninguno'
          : coverage.fixedEmployees.map((e) => e.name).join(', ')}
      </p>
      {shift ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              <span className="text-text-3">
                {shift.shiftDate === todayInBuenosAires() ? 'Hoy' : 'Próximo'}
                :{' '}
              </span>
              {formatDateOnly(shift.shiftDate)} · {shortTime(shift.startTime)} a{' '}
              {shift.openEnded ? OPEN_ENDED_LABEL : shortTime(shift.endTime)}
            </span>
            <StatusBadge domain="shift" status={shift.status} />
            {isShiftUncovered(shift) && shift.status !== 'uncovered' && (
              <span className="rounded-full bg-danger/10 px-2 py-[1px] text-[11px] font-medium text-danger">
                Sin cubrir
              </span>
            )}
          </div>
          {shift.assignments.length === 0 ? (
            <p className="text-text-3">Sin nadie asignado.</p>
          ) : (
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {shift.assignments.map((a) => (
                <li key={a.employeeId} className="flex items-center gap-1">
                  {a.name}
                  <StatusBadge domain="assignment" status={a.status} />
                </li>
              ))}
            </ul>
          )}
          {shift.assignedCount < shift.requiredStaff && (
            <p className="text-[11px] text-danger">
              Faltan {shift.requiredStaff - shift.assignedCount} de{' '}
              {shift.requiredStaff}.
            </p>
          )}
        </div>
      ) : (
        service.status === 'active' && (
          <p className="text-text-3">Sin turnos en los próximos 35 días.</p>
        )
      )}
    </div>
  )
}

/**
 * Lista de servicios (SERVICE-003), reutilizada en la pestaña "Servicios"
 * de ADM-21 (`clientId`, muestra la sede de cada servicio porque un cliente
 * puede tener varias) y en la sección "Servicios" de ADM-22 (`siteId`, no
 * hace falta repetir la sede: ya se sabe cuál es).
 */
function ServiceList(
  props:
    | { clientId: string; siteId?: undefined }
    | { siteId: string; clientId?: undefined },
) {
  const byClient = useServicesByClientQuery(props.clientId)
  const bySite = useServicesBySiteQuery(props.siteId)
  const query = props.clientId ? byClient : bySite
  const showSiteName = props.clientId != null

  const [serviceToChangeStatus, setServiceToChangeStatus] =
    useState<ServiceSummary | null>(null)

  // OD-22: eliminar servicios y turnos es solo del dueño.
  const auth = useAuth()
  const ownerCanDelete = canOwnerDelete(auth)
  const [serviceToDelete, setServiceToDelete] = useState<ServiceSummary | null>(
    null,
  )
  const [serviceToDeleteShifts, setServiceToDeleteShifts] =
    useState<ServiceSummary | null>(null)

  const services = query.data ?? []
  // OF-04: una sola consulta por lista para fijos y próximo turno.
  const coverageQuery = useServicesCoverageQuery(services.map((s) => s.id))
  const coverage = coverageQuery.data

  return (
    <div className="flex flex-col gap-3">
      {query.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : services.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Todavía no hay servicios cargados"
          description='Agregá el primero con "Nuevo servicio".'
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {services.map((service) => (
            <li
              key={service.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-[14px]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-text">{service.name}</p>
                  <StatusBadge domain="service" status={service.status} />
                </div>
                {showSiteName && (
                  <p className="text-[11px] text-text-3">{service.siteName}</p>
                )}
                <p className="mt-1 text-[12px] text-text-2">
                  {formatServiceDays(service.weekdays, service.weeksOfMonth)} ·{' '}
                  {shortTime(service.startTime)} a{' '}
                  {service.openEnded
                    ? OPEN_ENDED_LABEL
                    : shortTime(service.endTime)}
                </p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-text-3">
                  <Users aria-hidden="true" className="size-[12px]" />
                  {service.requiredStaff}{' '}
                  {service.requiredStaff === 1 ? 'persona' : 'personas'}
                </p>
                <ServiceCoverageInfo
                  service={service}
                  coverage={coverage?.[service.id]}
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={MoreHorizontal}
                    aria-label={`Acciones para ${service.name}`}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to={`/admin/servicios/${service.id}/editar`}>
                      <Pencil aria-hidden="true" />
                      Editar
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setServiceToChangeStatus(service)}
                  >
                    <RefreshCw aria-hidden="true" />
                    Cambiar estado
                  </DropdownMenuItem>
                  {ownerCanDelete && (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setServiceToDeleteShifts(service)}
                    >
                      <Eraser aria-hidden="true" />
                      Eliminar turnos sin historia…
                    </DropdownMenuItem>
                  )}
                  {ownerCanDelete && (
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => setServiceToDelete(service)}
                    >
                      <Trash2 aria-hidden="true" />
                      Eliminar
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      {serviceToChangeStatus && (
        <ChangeServiceStatusDialog
          service={serviceToChangeStatus}
          open={serviceToChangeStatus != null}
          onOpenChange={(open) => !open && setServiceToChangeStatus(null)}
        />
      )}

      {serviceToDelete && (
        <OwnerDeleteDialog
          kind="service"
          id={serviceToDelete.id}
          open
          onOpenChange={(open) => !open && setServiceToDelete(null)}
        />
      )}

      {serviceToDeleteShifts && (
        <DeleteServiceShiftsDialog
          serviceId={serviceToDeleteShifts.id}
          serviceName={serviceToDeleteShifts.name}
          open
          onOpenChange={(open) => !open && setServiceToDeleteShifts(null)}
        />
      )}
    </div>
  )
}

/** Botón "Nuevo servicio" (ADM-21 y ADM-22), con el contexto ya elegido. */
function NewServiceButton({
  clientId,
  siteId,
}: {
  clientId?: string
  siteId?: string
}) {
  const to = siteId
    ? `/admin/servicios/nuevo?sede=${siteId}`
    : `/admin/servicios/nuevo?cliente=${clientId}`
  return (
    <Button asChild size="sm" icon={Plus}>
      <Link to={to}>Nuevo servicio</Link>
    </Button>
  )
}

export { ServiceList, NewServiceButton }
