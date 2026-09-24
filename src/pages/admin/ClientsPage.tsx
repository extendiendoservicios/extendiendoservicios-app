import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Building2, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { StatusBadge, getStatusMeta } from '@/components/status'
import { MapView, type MapViewMarker } from '@/components/map'
import type { ClientListRow, ClientStatus } from '@/api/clients'
import { CLIENT_STATUS_OPTIONS } from '@/features/clients/schemas'
import { UpdatedAgo } from '@/features/clients/components/UpdatedAgo'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  useClientsQuery,
  usePrimaryContactNamesQuery,
} from '@/features/clients/queries'
import {
  useClientFilterOptionsQuery,
  useSitesMapQuery,
} from '@/features/sites/queries'

/**
 * ADM-19 "Clientes · listado" (CLIENT-002, `05` línea 73): tabla con
 * nombre, CUIT, sedes, servicios activos, contacto principal y estado;
 * filtros de texto y estado; "Nuevo cliente" abre ADM-20. Pestaña "Mapa"
 * (`?pestana=mapa` → ADM-24, SITE-005/P08.4): mapa de sedes con filtro por
 * cliente.
 *
 * Sin capacidad que lo restrinja (`04` sección 7.2: "O, A: todas"): la
 * ruta ya está protegida por `RequireRole allow={['owner','admin']}`
 * (`router.tsx`), sin un chequeo de rol adicional acá.
 */

const TABS = ['listado', 'mapa'] as const
type ClientsTab = (typeof TABS)[number]

function isClientsTab(value: string | null): value is ClientsTab {
  return TABS.includes(value as ClientsTab)
}

interface ClientRowView extends ClientListRow {
  primaryContactName: string | null
}

export default function ClientsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = isClientsTab(searchParams.get('pestana'))
    ? (searchParams.get('pestana') as ClientsTab)
    : 'listado'

  function handleTabChange(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === 'listado') {
      next.delete('pestana')
    } else {
      next.set('pestana', value)
    }
    setSearchParams(next, { replace: true })
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="listado">Listado</TabsTrigger>
        <TabsTrigger value="mapa">Mapa</TabsTrigger>
      </TabsList>

      <TabsContent value="listado" className="pt-3">
        <ClientsListTab />
      </TabsContent>

      <TabsContent value="mapa" className="pt-3">
        <ClientsMapTab />
      </TabsContent>
    </Tabs>
  )
}

function ClientsListTab() {
  const [statusFilter, setStatusFilter] = useState<ClientStatus | 'all'>(
    'active',
  )
  const [textFilter, setTextFilter] = useState('')
  const debouncedText = useDebouncedValue(textFilter)

  const clientsQuery = useClientsQuery({
    status: statusFilter,
    text: debouncedText,
  })
  const primaryContactsQuery = usePrimaryContactNamesQuery()

  const rows = useMemo<ClientRowView[]>(() => {
    const clients = clientsQuery.data ?? []
    return clients.map((client) => ({
      ...client,
      primaryContactName: primaryContactsQuery.data?.get(client.id) ?? null,
    }))
  }, [clientsQuery.data, primaryContactsQuery.data])

  const columns: DataTableColumnDef<ClientRowView>[] = [
    {
      id: 'name',
      header: 'Nombre',
      meta: { card: 'title' },
      cell: ({ row }) => {
        const client = row.original
        const primaryName = client.tradeName ?? client.legalName
        const secondaryName = client.tradeName ? client.legalName : null
        return (
          <Link
            to={`/admin/clientes/${client.id}`}
            className="font-semibold text-text hover:text-primary-800 hover:underline"
          >
            {primaryName}
            {secondaryName && (
              <span className="block text-[11px] font-normal text-text-3">
                {secondaryName}
              </span>
            )}
          </Link>
        )
      },
    },
    {
      id: 'cuit',
      header: 'CUIT',
      meta: { card: 'meta', cardLabel: 'CUIT' },
      cell: ({ row }) => row.original.cuit ?? '—',
    },
    {
      id: 'sites',
      // `v_clients.sites_count` cuenta las sedes vigentes sin filtrar por
      // estado (comentario de la vista, `0011_views.sql`): la columna dice
      // "Sedes", no "Sedes activas", para no prometer un filtro que la
      // vista no hace (decisión menor, ver el reporte del encargo).
      header: 'Sedes',
      meta: { card: 'meta', cardLabel: 'Sedes', align: 'end' },
      cell: ({ row }) => row.original.sitesCount,
    },
    {
      id: 'activeServices',
      header: 'Servicios activos',
      meta: { card: 'meta', cardLabel: 'Servicios activos', align: 'end' },
      cell: ({ row }) => row.original.activeServicesCount,
    },
    {
      id: 'primaryContact',
      header: 'Contacto principal',
      meta: { card: 'meta', cardLabel: 'Contacto principal' },
      cell: ({ row }) => row.original.primaryContactName ?? '—',
    },
    {
      id: 'status',
      header: 'Estado',
      meta: { card: 'meta', cardLabel: 'Estado' },
      cell: ({ row }) => (
        <StatusBadge domain="client" status={row.original.status} />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {clientsQuery.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={clientsQuery.dataUpdatedAt} />
          )}
          <Input
            icon={Search}
            placeholder="Buscar por nombre o CUIT…"
            value={textFilter}
            onChange={(event) => setTextFilter(event.target.value)}
            className="w-64"
          />
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(value as ClientStatus | 'all')
            }
          >
            <SelectTrigger aria-label="Filtrar por estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {CLIENT_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button asChild icon={Plus}>
          <Link to="/admin/clientes/nuevo">Nuevo cliente</Link>
        </Button>
      </div>

      <DataTable
        caption="Clientes"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        isLoading={clientsQuery.isLoading}
        emptyState={{
          icon: Building2,
          title:
            debouncedText || statusFilter !== 'all'
              ? 'No encontramos clientes con esos filtros'
              : 'Todavía no hay clientes cargados',
          description:
            !debouncedText && statusFilter === 'all'
              ? 'Creá el primero con "Nuevo cliente".'
              : undefined,
        }}
      />
    </div>
  )
}

/**
 * ADM-24 (SITE-005): mapa de sedes con filtro por cliente. Radix ya
 * desmonta el contenido de la pestaña inactiva (`TabsContent` sin
 * `forceMount`), así que este componente -- y el `MapView` que tiene
 * adentro -- recién se monta la primera vez que se elige la pestaña, con el
 * tamaño final del contenedor: no hace falta `invalidateSize()` (ver el
 * reporte del encargo).
 */
function ClientsMapTab() {
  const [clientId, setClientId] = useState<string>('all')
  const clientOptionsQuery = useClientFilterOptionsQuery()
  const sitesQuery = useSitesMapQuery({
    clientId: clientId === 'all' ? undefined : clientId,
  })

  const sites = sitesQuery.data ?? []
  const sitesWithCoordinates = sites.filter(
    (site) => site.latitude != null && site.longitude != null,
  )
  const sitesWithoutCoordinatesCount =
    sites.length - sitesWithCoordinates.length

  const markers = useMemo<MapViewMarker[]>(
    () =>
      sitesWithCoordinates.map((site) => ({
        id: site.id,
        position: {
          lat: site.latitude as number,
          lng: site.longitude as number,
        },
        variant: getStatusMeta({ domain: 'site', status: site.status }).variant,
        label: `${site.clientName} — ${site.name}`,
        popup: (
          <div className="flex flex-col gap-1 text-[12px]">
            <p className="font-semibold text-text">{site.clientName}</p>
            <p className="text-text-2">{site.name}</p>
            <p className="text-text-3">
              {site.address}
              {site.city ? `, ${site.city}` : ''}
            </p>
            <Link
              to={`/admin/sedes/${site.id}`}
              className="font-semibold text-primary-800 hover:underline"
            >
              Ver sede
            </Link>
          </div>
        ),
      })),
    [sitesWithCoordinates],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {sitesQuery.dataUpdatedAt > 0 && (
          <UpdatedAgo dataUpdatedAt={sitesQuery.dataUpdatedAt} />
        )}
        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger aria-label="Filtrar por cliente" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los clientes</SelectItem>
            {(clientOptionsQuery.data ?? []).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sitesWithoutCoordinatesCount > 0 && (
          <p className="text-[11.5px] text-text-3">
            {sitesWithoutCoordinatesCount === 1
              ? 'Hay 1 sede sin ubicación cargada, no se ve en el mapa.'
              : `Hay ${sitesWithoutCoordinatesCount} sedes sin ubicación cargada, no se ven en el mapa.`}
          </p>
        )}
      </div>

      <MapView
        markers={markers}
        height={480}
        className="w-full"
        emptyTitle="Sin sedes con ubicación para mostrar"
        emptyDescription="Cargá coordenadas en las sedes para verlas acá."
      />
    </div>
  )
}
