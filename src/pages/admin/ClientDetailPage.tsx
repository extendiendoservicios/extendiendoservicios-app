import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { Building2, Pencil, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/status'
import {
  useClientDetailQuery,
  useClientSitesQuery,
} from '@/features/clients/queries'
import { ClientContactsPanel } from '@/features/clients/components/ClientContactsPanel'
import { ChangeClientStatusDialog } from '@/features/clients/components/ChangeClientStatusDialog'

const TABS = ['sedes', 'contactos', 'servicios', 'tareas'] as const
type ClientDetailTab = (typeof TABS)[number]

function isClientDetailTab(value: string | null): value is ClientDetailTab {
  return TABS.includes(value as ClientDetailTab)
}

/**
 * ADM-21 "Cliente · detalle" (CLIENT-004, `05` línea 75): cabecera con
 * estado y pestañas Sedes, Contactos, Servicios (placeholder hasta F10) y
 * Tareas (enlace a ADM-26).
 *
 * El alta y el detalle de sede (ADM-22, ADM-23) son de SITE-001 a SITE-003
 * (P08.4, `src/pages/admin/SiteDetailPage.tsx`/`SiteFormPage.tsx`): la
 * pestaña Sedes solo lista y enlaza a esas rutas.
 */
export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isChangeStatusOpen, setChangeStatusOpen] = useState(false)

  const activeTab = isClientDetailTab(searchParams.get('pestana'))
    ? (searchParams.get('pestana') as ClientDetailTab)
    : 'sedes'

  function handleTabChange(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === 'sedes') {
      next.delete('pestana')
    } else {
      next.set('pestana', value)
    }
    setSearchParams(next, { replace: true })
  }

  const clientQuery = useClientDetailQuery(id)
  const sitesQuery = useClientSitesQuery(activeTab === 'sedes' ? id : undefined)

  if (!id) {
    return null
  }

  if (clientQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const client = clientQuery.data
  if (!client) {
    return (
      <EmptyState
        icon={Building2}
        title="No encontramos este cliente"
        description="Puede que se haya movido o que el enlace esté roto."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-text">
              {client.tradeName ?? client.legalName}
            </h2>
            <StatusBadge domain="client" status={client.status} />
          </div>
          {client.tradeName && (
            <p className="text-[12px] text-text-3">{client.legalName}</p>
          )}
          <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] text-text-2 sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold">CUIT: </dt>
              <dd className="inline">{client.cuit ?? '—'}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">
                Dirección administrativa:{' '}
              </dt>
              <dd className="inline">{client.adminAddress ?? '—'}</dd>
            </div>
          </dl>
          {client.notes && (
            <p className="mt-2 text-[12px] text-text-3">{client.notes}</p>
          )}
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
            <Link to={`/admin/clientes/${client.id}/editar`}>Editar</Link>
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="sedes">Sedes</TabsTrigger>
          <TabsTrigger value="contactos">Contactos</TabsTrigger>
          <TabsTrigger value="servicios">Servicios</TabsTrigger>
          <TabsTrigger value="tareas">Tareas</TabsTrigger>
        </TabsList>

        <TabsContent value="sedes" className="pt-3">
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <Button asChild size="sm" icon={Plus}>
                <Link to={`/admin/sedes/nueva?cliente=${client.id}`}>
                  Nueva sede
                </Link>
              </Button>
            </div>
            {sitesQuery.isLoading ? (
              <Skeleton className="h-24" />
            ) : (sitesQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon={Building2}
                title="Todavía no hay sedes cargadas"
                description='Agregá la primera con "Nueva sede".'
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {(sitesQuery.data ?? []).map((site) => (
                  <li key={site.id}>
                    <Link
                      to={`/admin/sedes/${site.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-[14px] hover:border-primary"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-text">{site.name}</p>
                        <p className="truncate text-[11px] text-text-3">
                          {site.address}
                          {site.city ? `, ${site.city}` : ''}
                        </p>
                      </div>
                      <StatusBadge domain="site" status={site.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="contactos" className="pt-3">
          <ClientContactsPanel clientId={client.id} />
        </TabsContent>

        <TabsContent value="servicios" className="pt-3">
          <EmptyState
            title="Todavía no hay servicios para mostrar"
            description="Los servicios del cliente se van a ver acá cuando esté habilitada la gestión de servicios."
          />
        </TabsContent>

        <TabsContent value="tareas" className="pt-3">
          <EmptyState
            title="Plantilla de tareas del cliente"
            description="Las tareas de este cliente se definen en Plantillas de tareas."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigate(`/admin/tareas?cliente=${client.id}`)
                }
              >
                Ir a plantillas de tareas
              </Button>
            }
          />
        </TabsContent>
      </Tabs>

      <ChangeClientStatusDialog
        client={client}
        open={isChangeStatusOpen}
        onOpenChange={setChangeStatusOpen}
      />
    </div>
  )
}
