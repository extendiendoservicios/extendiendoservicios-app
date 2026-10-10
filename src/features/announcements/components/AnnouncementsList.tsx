import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Megaphone, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { SegmentedControl } from '@/components/SegmentedControl'
import {
  ANNOUNCEMENT_STATUS_LABELS,
  type AnnouncementRow,
  type AnnouncementStatus,
} from '@/api/announcements'
import { UpdatedAgo } from '@/features/supervisions/components/UpdatedAgo'
import { useAnnouncementsQuery } from '@/features/announcements/queries'
import {
  ANNOUNCEMENT_STATUS_VARIANT,
  audienceText,
  readByText,
  validityText,
} from '@/features/announcements/helpers'

type StatusFilter = AnnouncementStatus | 'all'

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Activos' },
  { value: 'expired', label: 'Vencidos' },
  { value: 'archived', label: 'Archivados' },
  { value: 'all', label: 'Todos' },
]

const EMPTY_TITLES: Record<StatusFilter, string> = {
  active: 'No hay anuncios activos',
  expired: 'No hay anuncios vencidos',
  archived: 'No hay anuncios archivados',
  all: 'Todavía no publicaste anuncios',
}

/**
 * Listado de «Avisos y anuncios» (AJ2-03, `/admin/anuncios`): título,
 * destinatarios, vigencia, estado y «Leído por X de Y». Filtro por estado
 * (por defecto, activos). Polling de 60 s.
 */
export function AnnouncementsList() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<StatusFilter>('active')
  const query = useAnnouncementsQuery(filter)

  const columns: DataTableColumnDef<AnnouncementRow>[] = [
    {
      id: 'title',
      header: 'Título',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <Link
          to={`/admin/anuncios/${row.original.id}`}
          className="font-semibold text-text hover:text-primary-800"
        >
          {row.original.title}
        </Link>
      ),
    },
    {
      id: 'audience',
      header: 'Destinatarios',
      meta: { card: 'subtitle' },
      cell: ({ row }) =>
        audienceText(row.original.audience, row.original.recipientCount),
    },
    {
      id: 'validity',
      header: 'Vigencia',
      meta: { card: 'meta', cardLabel: 'Vigencia' },
      cell: ({ row }) => validityText(row.original.visibleUntil),
    },
    {
      id: 'status',
      header: 'Estado',
      meta: { card: 'trailing' },
      cell: ({ row }) => (
        <Badge variant={ANNOUNCEMENT_STATUS_VARIANT[row.original.status]}>
          {ANNOUNCEMENT_STATUS_LABELS[row.original.status]}
        </Badge>
      ),
    },
    {
      id: 'reads',
      header: 'Lecturas',
      meta: { card: 'meta', cardLabel: 'Lecturas' },
      cell: ({ row }) =>
        readByText(row.original.readCount, row.original.recipientCount),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          aria-label="Filtrar anuncios por estado"
          options={FILTER_OPTIONS}
          value={filter}
          onValueChange={setFilter}
        />
        <div className="flex items-center gap-3">
          {query.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={query.dataUpdatedAt} />
          )}
          <Button
            icon={Plus}
            size="sm"
            onClick={() => void navigate('/admin/anuncios/nuevo')}
          >
            Nuevo anuncio
          </Button>
        </div>
      </div>

      {query.isError && (
        <p role="alert" className="text-[12.5px] text-danger">
          No pudimos cargar los anuncios. Probá de nuevo en unos segundos.
        </p>
      )}

      <DataTable
        caption="Anuncios"
        columns={columns}
        data={query.data ?? []}
        getRowId={(row) => row.id}
        isLoading={query.isLoading}
        emptyState={{
          icon: Megaphone,
          title: EMPTY_TITLES[filter],
          description:
            'Los anuncios les aparecen a empleados y supervisores en el celular.',
        }}
      />
    </div>
  )
}
