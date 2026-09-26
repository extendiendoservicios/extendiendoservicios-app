import { toast } from 'sonner'
import { ClipboardList, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import {
  useChecklistTemplateQuery,
  useCloneChecklistTemplateMutation,
} from '@/features/checklists/queries'
import { ChecklistItemsEditor } from './ChecklistItemsEditor'

/**
 * ADM-26, ámbito "sede" (TASK-004, TASK-005, `05` línea 85): "usa la del
 * cliente" (sin plantilla propia todavía) o plantilla propia (creada con
 * `clone_checklist_template`, P-058). Si el cliente todavía no tiene
 * plantilla para copiar, lo explica en vez de dejar que la RPC devuelva el
 * error crudo (regla del encargo) -- aunque el servidor igual la traduce en
 * voseo (`CLIENT_TEMPLATE_NOT_FOUND`), acá se anticipa deshabilitando el
 * botón con el motivo a la vista.
 */
function SiteTemplateEditor({
  clientId,
  siteId,
  canEdit,
}: {
  clientId: string
  siteId: string
  canEdit: boolean
}) {
  const clientTemplateQuery = useChecklistTemplateQuery(clientId, null)
  const siteTemplateQuery = useChecklistTemplateQuery(clientId, siteId)
  const cloneTemplate = useCloneChecklistTemplateMutation()

  async function handleClone() {
    try {
      await cloneTemplate.mutateAsync({ clientId, siteId })
      toast.success('Creamos la plantilla propia de la sede.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos crear la plantilla.',
      )
    }
  }

  if (clientTemplateQuery.isLoading || siteTemplateQuery.isLoading) {
    return <Skeleton className="h-40" />
  }

  const clientTemplate = clientTemplateQuery.data
  const siteTemplate = siteTemplateQuery.data

  if (!siteTemplate) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Esta sede usa la plantilla del cliente"
        description={
          clientTemplate
            ? 'Si esta sede necesita tareas distintas, creá una plantilla propia (copia editable de la del cliente).'
            : 'El cliente todavía no tiene una plantilla de tareas: creá primero la del cliente para poder copiarla acá.'
        }
        action={
          canEdit && clientTemplate ? (
            <Button
              loading={cloneTemplate.isPending}
              onClick={() => void handleClone()}
            >
              Crear plantilla propia para esta sede
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold text-text">
          {siteTemplate.name}
        </h3>
        <Badge variant="primary">Plantilla propia de la sede</Badge>
      </div>
      <Alert variant="info">
        <Info />
        <AlertDescription>
          Cambiar esta plantilla no modifica los turnos ya generados. Para
          actualizar un turno puntual, usá «Recargar tareas» desde su detalle.
        </AlertDescription>
      </Alert>
      <ChecklistItemsEditor templateId={siteTemplate.id} canEdit={canEdit} />
    </div>
  )
}

export { SiteTemplateEditor }
