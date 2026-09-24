import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Building2, Pencil, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/status'
import { MapView } from '@/components/map'
import { useSiteDetailQuery } from '@/features/sites/queries'
import { ChangeSiteStatusDialog } from '@/features/sites/components/ChangeSiteStatusDialog'
import { SiteInfo } from '@/features/sites/components/SiteInfo'

/**
 * ADM-22 "Sede · detalle" (SITE-002, `05` línea 76): cabecera con estado y
 * secciones (datos y restricciones con `SiteInfo`, mapa, servicios,
 * plantilla de tareas, próximos turnos). Sin pestañas, a diferencia de
 * ADM-21: `05` describe ADM-22 como una lista de secciones, no como
 * pestañas separadas, y acá ninguna sección tiene contenido pesado que
 * convenga ocultar hasta que se la elija (servicios y próximos turnos
 * quedan vacíos hasta F10 y P08.6/P08.7). Esto además evita el problema de
 * `MapView` dentro de una pestaña oculta (`invalidateSize`, ver el reporte
 * del encargo): acá el mapa está siempre montado.
 */
export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [isChangeStatusOpen, setChangeStatusOpen] = useState(false)

  const siteQuery = useSiteDetailQuery(id)

  if (!id) {
    return null
  }

  if (siteQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const site = siteQuery.data
  if (!site) {
    return (
      <EmptyState
        icon={Building2}
        title="No encontramos esta sede"
        description="Puede que se haya movido o que el enlace esté roto."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-text">{site.name}</h2>
            <StatusBadge domain="site" status={site.status} />
          </div>
          <Link
            to={`/admin/clientes/${site.clientId}`}
            className="text-[12px] text-text-3 hover:text-primary-800 hover:underline"
          >
            {site.clientName}
          </Link>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            onClick={() => setChangeStatusOpen(true)}
          >
            Cambiar estado
          </Button>
          <Button asChild size="sm" icon={Pencil}>
            <Link to={`/admin/sedes/${site.id}/editar`}>Editar</Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-text">Datos</h3>
        <SiteInfo site={site} />
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-text">Ubicación</h3>
        <MapView
          markers={
            site.latitude != null && site.longitude != null
              ? [
                  {
                    id: site.id,
                    position: { lat: site.latitude, lng: site.longitude },
                    variant: site.status === 'active' ? 'success' : 'neutral',
                    label: site.name,
                  },
                ]
              : []
          }
          scrollWheelZoom={false}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-text">Servicios</h3>
        <EmptyState
          title="Todavía no hay servicios para mostrar"
          description="Los servicios de esta sede se van a ver acá cuando esté habilitada la gestión de servicios."
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-text">
          Plantilla de tareas
        </h3>
        <EmptyState
          title="Plantilla de tareas de la sede"
          description="Definila en Plantillas de tareas, o dejá que la sede use la del cliente."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigate(`/admin/tareas?sede=${site.id}`)}
            >
              Ir a plantillas de tareas
            </Button>
          }
        />
      </div>

      <div className="rounded-lg border border-border bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-text">
          Próximos turnos
        </h3>
        <EmptyState
          title="Todavía no hay turnos para mostrar"
          description="Los próximos turnos de esta sede se van a ver acá."
        />
      </div>

      <ChangeSiteStatusDialog
        site={site}
        open={isChangeStatusOpen}
        onOpenChange={setChangeStatusOpen}
      />
    </div>
  )
}
