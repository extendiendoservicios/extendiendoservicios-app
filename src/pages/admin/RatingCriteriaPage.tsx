import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Eye,
  Pencil,
  Plus,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumnDef } from '@/components/DataTable'
import { IconButton } from '@/components/IconButton'
import { useAuth } from '@/features/auth/AuthProvider'
import { isApiError } from '@/api/errors'
import type { RatingCriterion } from '@/api/settings'
import { ConfigNav } from '@/features/settings/components/ConfigNav'
import { OwnerOnlyNotice } from '@/features/settings/components/OwnerOnlyNotice'
import { RatingCriterionFormSheet } from '@/features/settings/components/RatingCriterionFormSheet'
import { RatingCriteriaPreviewDialog } from '@/features/settings/components/RatingCriteriaPreviewDialog'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { formatDateOnlyWithYear } from '@/features/settings/dateOnly'
import { canViewOwnerOnlyConfig } from '@/features/settings/permissions'
import {
  useCloseRatingCriterionMutation,
  useRatingCriteriaQuery,
  useReorderRatingCriteriaMutation,
} from '@/features/settings/queries'

/**
 * ADM-30 "Criterios de calificación" (USERS-015, `05` línea 94): lista
 * ordenable (flechas, mismo patrón que ADM-26), alta, edición, cerrar (pone
 * `valid_to`, no borra) y la vista de "cómo lo ve el supervisor". Solo dueño.
 */
export default function RatingCriteriaPage() {
  const auth = useAuth()
  const isOwnerViewer = canViewOwnerOnlyConfig(auth)
  const actorId = auth.userId as string

  const criteriaQuery = useRatingCriteriaQuery()
  const reorderCriteria = useReorderRatingCriteriaMutation()
  const closeCriterion = useCloseRatingCriterionMutation()

  const [formState, setFormState] = useState<{
    open: boolean
    criterion: RatingCriterion | null
  }>({ open: false, criterion: null })
  const [criterionToClose, setCriterionToClose] =
    useState<RatingCriterion | null>(null)
  const [isPreviewOpen, setPreviewOpen] = useState(false)

  const criteria = useMemo(
    () =>
      [...(criteriaQuery.data ?? [])].sort((a, b) => a.position - b.position),
    [criteriaQuery.data],
  )
  const openCriteria = criteria.filter((criterion) => criterion.validTo == null)
  const nextPosition =
    criteria.length === 0 ? 0 : Math.max(...criteria.map((c) => c.position)) + 1

  function openNewCriterionForm() {
    setFormState({ open: true, criterion: null })
  }

  function openEditCriterionForm(criterion: RatingCriterion) {
    setFormState({ open: true, criterion })
  }

  async function handleMove(criterion: RatingCriterion, direction: -1 | 1) {
    const index = criteria.findIndex((c) => c.id === criterion.id)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= criteria.length) {
      return
    }
    const reordered = [...criteria]
    const [moved] = reordered.splice(index, 1)
    if (!moved) {
      return
    }
    reordered.splice(targetIndex, 0, moved)
    try {
      await reorderCriteria.mutateAsync({
        orderedIds: reordered.map((c) => c.id),
        updatedBy: actorId,
      })
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos reordenar la guía.',
      )
    }
  }

  async function handleClose() {
    if (!criterionToClose) {
      return
    }
    try {
      await closeCriterion.mutateAsync({
        id: criterionToClose.id,
        updatedBy: actorId,
      })
      toast.success('Cerramos el criterio.')
      setCriterionToClose(null)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cerrar el criterio.',
      )
    }
  }

  const columns: DataTableColumnDef<RatingCriterion>[] = [
    {
      id: 'title',
      header: 'Título',
      meta: { card: 'title' },
      cell: ({ row }) => (
        <span className="font-medium text-text">{row.original.title}</span>
      ),
    },
    {
      id: 'description',
      header: 'Descripción',
      meta: { card: 'subtitle' },
      cell: ({ row }) => row.original.description ?? '—',
    },
    {
      id: 'validity',
      header: 'Vigencia',
      meta: { card: 'meta', cardLabel: 'Vigencia' },
      cell: ({ row }) =>
        row.original.validTo == null ? (
          <Badge variant="success">Vigente</Badge>
        ) : (
          <Badge variant="neutral">
            Cerrado el {formatDateOnlyWithYear(row.original.validTo)}
          </Badge>
        ),
    },
    {
      id: 'actions',
      header: '',
      meta: { card: 'trailing', align: 'end' },
      cell: ({ row }) => {
        const criterion = row.original
        const isOpen = criterion.validTo == null
        return (
          <div className="flex items-center gap-1">
            {isOpen && (
              <>
                <IconButton
                  icon={ArrowUp}
                  aria-label={`Subir "${criterion.title}"`}
                  disabled={reorderCriteria.isPending}
                  onClick={() => void handleMove(criterion, -1)}
                />
                <IconButton
                  icon={ArrowDown}
                  aria-label={`Bajar "${criterion.title}"`}
                  disabled={reorderCriteria.isPending}
                  onClick={() => void handleMove(criterion, 1)}
                />
                <IconButton
                  icon={Pencil}
                  aria-label={`Editar "${criterion.title}"`}
                  onClick={() => openEditCriterionForm(criterion)}
                />
                <IconButton
                  icon={XCircle}
                  aria-label={`Cerrar "${criterion.title}"`}
                  onClick={() => setCriterionToClose(criterion)}
                />
              </>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <ConfigNav roles={auth.roles} />

      {!isOwnerViewer ? (
        <OwnerOnlyNotice />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-text-3">
              Guía de texto para calificar: el supervisor la ve como ayuda, no
              se puntúa por criterio.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                icon={Eye}
                size="sm"
                onClick={() => setPreviewOpen(true)}
              >
                Ver como supervisor
              </Button>
              <Button icon={Plus} size="sm" onClick={openNewCriterionForm}>
                Nuevo criterio
              </Button>
            </div>
          </div>

          <DataTable
            caption="Criterios de calificación"
            columns={columns}
            data={criteria}
            getRowId={(row) => row.id}
            isLoading={criteriaQuery.isLoading}
            emptyState={{
              icon: ClipboardList,
              title: 'Todavía no hay ningún criterio cargado',
              description: 'Agregá el primero con "Nuevo criterio".',
            }}
          />

          <RatingCriterionFormSheet
            criterion={formState.criterion}
            nextPosition={nextPosition}
            actorId={actorId}
            open={formState.open}
            onOpenChange={(open) =>
              setFormState((state) => ({ ...state, open }))
            }
          />

          <RatingCriteriaPreviewDialog
            criteria={openCriteria}
            open={isPreviewOpen}
            onOpenChange={setPreviewOpen}
          />

          <SimpleConfirmDialog
            open={criterionToClose != null}
            onOpenChange={(open) => !open && setCriterionToClose(null)}
            title="Cerrar este criterio"
            description={
              criterionToClose
                ? `"${criterionToClose.title}" deja de mostrarse como vigente, pero se conserva en el historial.`
                : undefined
            }
            confirmLabel="Cerrar criterio"
            isLoading={closeCriterion.isPending}
            onConfirm={() => void handleClose()}
          />
        </>
      )}
    </div>
  )
}
