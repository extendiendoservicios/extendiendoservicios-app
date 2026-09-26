import { toast } from 'sonner'
import { ClipboardList, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useChecklistTemplateQuery,
  useCreateClientTemplateMutation,
} from '@/features/checklists/queries'
import { ChecklistItemsEditor } from './ChecklistItemsEditor'

/**
 * ADM-26, ámbito "Plantilla del cliente" (TASK-004, TASK-005, `05` línea
 * 85): si el cliente todavía no tiene plantilla, la crea (sin RPC, insert
 * directo, `src/api/checklists.ts`); si ya la tiene, edita sus ítems con
 * `ChecklistItemsEditor`.
 */
function ClientTemplateEditor({
  clientId,
  canEdit,
}: {
  clientId: string
  canEdit: boolean
}) {
  const auth = useAuth()
  const templateQuery = useChecklistTemplateQuery(clientId, null)
  const createTemplate = useCreateClientTemplateMutation()

  async function handleCreate() {
    try {
      await createTemplate.mutateAsync({
        clientId,
        createdBy: auth.userId as string,
      })
      toast.success('Creamos la plantilla del cliente.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos crear la plantilla.',
      )
    }
  }

  if (templateQuery.isLoading) {
    return <Skeleton className="h-40" />
  }

  const template = templateQuery.data
  if (!template) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Este cliente todavía no tiene una plantilla de tareas"
        description="Creala para definir el checklist que se copia a cada turno nuevo de este cliente."
        action={
          canEdit ? (
            <Button
              loading={createTemplate.isPending}
              onClick={() => void handleCreate()}
            >
              Crear plantilla del cliente
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <h3 className="text-[13px] font-semibold text-text">{template.name}</h3>
      <Alert variant="info">
        <Info />
        <AlertDescription>
          Cambiar esta plantilla no modifica los turnos ya generados (P-061).
          Para actualizar un turno puntual, usá «Recargar tareas» desde su
          detalle.
        </AlertDescription>
      </Alert>
      <ChecklistItemsEditor templateId={template.id} canEdit={canEdit} />
    </div>
  )
}

export { ClientTemplateEditor }
