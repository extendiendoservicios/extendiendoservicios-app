import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/IconButton'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import type { ChecklistTemplateItem } from '@/api/checklists'
import { useAuth } from '@/features/auth/AuthProvider'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import {
  useChecklistItemsQuery,
  useDeactivateTemplateItemMutation,
  useReorderTemplateItemsMutation,
} from '@/features/checklists/queries'
import { ChecklistItemFormDialog } from './ChecklistItemFormDialog'

/**
 * ADM-26 (TASK-005, `05` línea 85): lista de ítems de una plantilla
 * (cliente o sede), ordenable con flechas (sin arrastre obligatorio), con
 * alta, edición y baja lógica con confirmación. Mismo patrón que la lista
 * de criterios de calificación de `RatingCriteriaPage`
 * (`src/pages/admin/RatingCriteriaPage.tsx`).
 *
 * `canEdit` en `false` (sin `edit_checklists`): lista de solo lectura, sin
 * botones de acción (regla del encargo, `features/checklists/permissions.ts`).
 */
interface ChecklistItemsEditorProps {
  templateId: string
  canEdit: boolean
}

function ChecklistItemsEditor({
  templateId,
  canEdit,
}: ChecklistItemsEditorProps) {
  const auth = useAuth()
  const actorId = auth.userId as string

  const itemsQuery = useChecklistItemsQuery(templateId)
  const reorderItems = useReorderTemplateItemsMutation()
  const deactivateItem = useDeactivateTemplateItemMutation()

  const [formState, setFormState] = useState<{
    open: boolean
    item: ChecklistTemplateItem | null
  }>({ open: false, item: null })
  const [itemToDeactivate, setItemToDeactivate] =
    useState<ChecklistTemplateItem | null>(null)

  const items = useMemo(
    () => [...(itemsQuery.data ?? [])].sort((a, b) => a.position - b.position),
    [itemsQuery.data],
  )
  const nextPosition =
    items.length === 0 ? 0 : Math.max(...items.map((item) => item.position)) + 1

  function openNewItemForm() {
    setFormState({ open: true, item: null })
  }

  function openEditItemForm(item: ChecklistTemplateItem) {
    setFormState({ open: true, item })
  }

  async function handleMove(item: ChecklistTemplateItem, direction: -1 | 1) {
    const index = items.findIndex((candidate) => candidate.id === item.id)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= items.length) {
      return
    }
    const reordered = [...items]
    const [moved] = reordered.splice(index, 1)
    if (!moved) {
      return
    }
    reordered.splice(targetIndex, 0, moved)
    try {
      await reorderItems.mutateAsync({ items: reordered, updatedBy: actorId })
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos reordenar los ítems.',
      )
    }
  }

  async function handleDeactivate() {
    if (!itemToDeactivate) {
      return
    }
    try {
      await deactivateItem.mutateAsync({
        id: itemToDeactivate.id,
        updatedBy: actorId,
      })
      toast.success(`Dimos de baja "${itemToDeactivate.title}".`)
      setItemToDeactivate(null)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos dar de baja el ítem.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" icon={Plus} onClick={openNewItemForm}>
            Agregar ítem
          </Button>
        </div>
      )}

      {itemsQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Todavía no hay ítems cargados"
          description={
            canEdit
              ? 'Agregá el primero con "Agregar ítem".'
              : 'Esta plantilla no tiene ítems cargados.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-[14px]"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-[6px] font-semibold text-text">
                  {item.title}
                  {!item.isRequired && (
                    <Badge variant="neutral">Opcional</Badge>
                  )}
                </p>
                {item.description && (
                  <p className="mt-1 text-[12px] text-text-3">
                    {item.description}
                  </p>
                )}
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    icon={ArrowUp}
                    aria-label={`Subir "${item.title}"`}
                    disabled={index === 0 || reorderItems.isPending}
                    onClick={() => void handleMove(item, -1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    aria-label={`Bajar "${item.title}"`}
                    disabled={
                      index === items.length - 1 || reorderItems.isPending
                    }
                    onClick={() => void handleMove(item, 1)}
                  />
                  <IconButton
                    icon={Pencil}
                    aria-label={`Editar "${item.title}"`}
                    onClick={() => openEditItemForm(item)}
                  />
                  <IconButton
                    icon={Trash2}
                    aria-label={`Dar de baja "${item.title}"`}
                    onClick={() => setItemToDeactivate(item)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <ChecklistItemFormDialog
            templateId={templateId}
            item={formState.item}
            nextPosition={nextPosition}
            open={formState.open}
            onOpenChange={(open) =>
              setFormState((state) => ({ ...state, open }))
            }
          />

          <SimpleConfirmDialog
            open={itemToDeactivate != null}
            onOpenChange={(open) => !open && setItemToDeactivate(null)}
            title="Dar de baja este ítem"
            description={
              itemToDeactivate
                ? `"${itemToDeactivate.title}" deja de copiarse a los turnos nuevos. Los turnos ya generados no cambian.`
                : undefined
            }
            confirmLabel="Dar de baja"
            isLoading={deactivateItem.isPending}
            onConfirm={() => void handleDeactivate()}
          />
        </>
      )}
    </div>
  )
}

export { ChecklistItemsEditor }
