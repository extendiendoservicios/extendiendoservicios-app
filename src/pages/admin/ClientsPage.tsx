import { useMemo, useState } from 'react'
import { Link } from 'react-router'
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
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { StatusBadge } from '@/components/status'
import type { ClientListRow, ClientStatus } from '@/api/clients'
import { CLIENT_STATUS_OPTIONS } from '@/features/clients/schemas'
import { UpdatedAgo } from '@/features/clients/components/UpdatedAgo'
import { useDebouncedValue } from '@/features/clients/useDebouncedValue'
import {
  useClientsQuery,
  usePrimaryContactNamesQuery,
} from '@/features/clients/queries'

/**
 * ADM-19 "Clientes · listado" (CLIENT-002, `05` línea 73): tabla con
 * nombre, CUIT, sedes, servicios activos, contacto principal y estado;
 * filtros de texto y estado; "Nuevo cliente" abre ADM-20.
 *
 * Sin capacidad que lo restrinja (`04` sección 7.2: "O, A: todas"): la
 * ruta ya está protegida por `RequireRole allow={['owner','admin']}`
 * (`router.tsx`), sin un chequeo de rol adicional acá.
 *
 * La pestaña "Mapa" (`?pestana=mapa` → ADM-24, `05` línea 73) todavía no
 * existe: es SITE-005, de un paquete posterior (P08.4) — ver el reporte
 * del encargo.
 */

interface ClientRowView extends ClientListRow {
  primaryContactName: string | null
}

export default function ClientsPage() {
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
