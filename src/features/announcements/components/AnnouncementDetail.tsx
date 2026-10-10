import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Archive, Megaphone, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { PersonCell } from '@/components/PersonCell'
import {
  ANNOUNCEMENT_STATUS_LABELS,
  type AnnouncementRecipient,
} from '@/api/announcements'
import { isApiError } from '@/api/errors'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import {
  useAnnouncementQuery,
  useAnnouncementRecipientsQuery,
  useArchiveAnnouncementMutation,
} from '@/features/announcements/queries'
import {
  ANNOUNCEMENT_STATUS_VARIANT,
  audienceText,
  readAtText,
  readByText,
  rolesText,
  sortRecipients,
  validityText,
} from '@/features/announcements/helpers'

/**
 * Detalle de un anuncio (AJ2-03, `/admin/anuncios/:id`): el anuncio como lo
 * vería la persona y «Quién lo leyó» (primero quienes no lo leyeron).
 * Editar y Archivar solo si no está archivado.
 */
export function AnnouncementDetail({
  announcementId,
}: {
  announcementId: string
}) {
  const navigate = useNavigate()
  const announcementQuery = useAnnouncementQuery(announcementId)
  const recipientsQuery = useAnnouncementRecipientsQuery(announcementId)
  const archiveMutation = useArchiveAnnouncementMutation()
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  const sortedRecipients = useMemo(
    () => sortRecipients(recipientsQuery.data ?? []),
    [recipientsQuery.data],
  )

  const columns: DataTableColumnDef<AnnouncementRecipient>[] = [
    {
      id: 'name',
      header: 'Nombre',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <PersonCell
          id={row.original.profileId}
          name={`${row.original.firstName} ${row.original.lastName}`}
          size="compact"
        />
      ),
    },
    {
      id: 'role',
      header: 'Rol',
      meta: { card: 'subtitle' },
      cell: ({ row }) => rolesText(row.original.roles),
    },
    {
      id: 'readAt',
      header: 'Lectura',
      meta: { card: 'trailing' },
      cell: ({ row }) => (
        <span
          className={
            row.original.readAt ? 'text-text' : 'font-semibold text-warning-800'
          }
        >
          {readAtText(row.original.readAt)}
        </span>
      ),
    },
  ]

  async function handleArchive() {
    try {
      await archiveMutation.mutateAsync(announcementId)
      toast.success('Archivamos el anuncio.')
      setConfirmingArchive(false)
      void navigate('/admin/anuncios')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos archivar el anuncio.',
      )
    }
  }

  if (announcementQuery.isLoading) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-40" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  const announcement = announcementQuery.data
  if (!announcement) {
    return (
      <EmptyState
        icon={Megaphone}
        title="No encontramos este anuncio"
        description="Puede que se haya movido o que el enlace esté roto."
        action={
          <Button asChild variant="ghost">
            <Link to="/admin/anuncios">Volver a los anuncios</Link>
          </Button>
        }
      />
    )
  }

  const isArchived = announcement.status === 'archived'

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={ANNOUNCEMENT_STATUS_VARIANT[announcement.status]}>
            {ANNOUNCEMENT_STATUS_LABELS[announcement.status]}
          </Badge>
          <span className="text-[12.5px] text-text-2">
            {audienceText(announcement.audience, announcement.recipientCount)}
            {' · '}
            {validityText(announcement.visibleUntil)}
            {' · '}
            {readByText(announcement.readCount, announcement.recipientCount)}
          </span>
        </div>
        {!isArchived && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              onClick={() =>
                void navigate(`/admin/anuncios/${announcement.id}/editar`)
              }
            >
              Editar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Archive}
              onClick={() => setConfirmingArchive(true)}
            >
              Archivar
            </Button>
          </div>
        )}
      </div>

      <article
        aria-label="Así lo ve la persona"
        className="rounded-lg border border-border bg-surface p-5"
      >
        <p className="mb-2 text-[11px] font-semibold text-text-3">
          Así lo ve la persona
        </p>
        <div className="rounded-md border-l-4 border-primary bg-primary-100/40 p-4">
          <h2 className="text-[15px] font-semibold text-text">
            {announcement.title}
          </h2>
          <p className="mt-2 text-[13px] whitespace-pre-line text-text">
            {announcement.body}
          </p>
        </div>
        {announcement.createdByName && (
          <p className="mt-3 text-[11px] text-text-3">
            Publicado por {announcement.createdByName}
          </p>
        )}
      </article>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold text-text">Quién lo leyó</h2>
        <DataTable
          caption="Quién leyó el anuncio"
          compact
          columns={columns}
          data={sortedRecipients}
          getRowId={(row) => row.profileId}
          isLoading={recipientsQuery.isLoading}
          emptyState={{
            icon: Megaphone,
            title: 'No hay destinatarios',
            description:
              'Ninguna persona activa le corresponde a este anuncio.',
          }}
        />
      </section>

      <SimpleConfirmDialog
        open={confirmingArchive}
        onOpenChange={setConfirmingArchive}
        title="Archivar este anuncio"
        description="Deja de mostrarse en el celular de todas las personas. Podés seguir viendo quién lo leyó."
        confirmLabel="Archivar"
        isLoading={archiveMutation.isPending}
        onConfirm={() => void handleArchive()}
      />
    </div>
  )
}
