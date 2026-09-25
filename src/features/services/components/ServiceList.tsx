import { useState } from 'react'
import { Link } from 'react-router'
import {
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
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
import {
  useServicesByClientQuery,
  useServicesBySiteQuery,
} from '@/features/services/queries'
import { formatWeekdays } from '@/features/services/weekdays'
import { ChangeServiceStatusDialog } from './ChangeServiceStatusDialog'

/** `"HH:mm:ss"` (columna `time` de Postgres) → `"HH:mm"`. */
function shortTime(time: string): string {
  return time.slice(0, 5)
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

  const services = query.data ?? []

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
                  {formatWeekdays(service.weekdays)} ·{' '}
                  {shortTime(service.startTime)} a {shortTime(service.endTime)}
                </p>
                <p className="mt-1 flex items-center gap-1 text-[11px] text-text-3">
                  <Users aria-hidden="true" className="size-[12px]" />
                  {service.requiredStaff}{' '}
                  {service.requiredStaff === 1 ? 'persona' : 'personas'}
                </p>
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
