import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ClipboardList } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import { canEditChecklists } from '@/features/checklists/permissions'
import {
  useChecklistItemsQuery,
  useChecklistTemplateQuery,
  useCloneChecklistTemplateMutation,
} from '@/features/checklists/queries'

/**
 * Bloque "Plantilla de tareas" de ADM-22 (TASK-007, `05` línea 76: "usa la
 * del cliente o plantilla propia"): resumen, botón para crear la propia
 * (`clone_checklist_template`) y enlace a ADM-26 para editar los ítems.
 */
function SiteTemplateSummary({
  clientId,
  siteId,
}: {
  clientId: string
  siteId: string
}) {
  const auth = useAuth()
  const canEdit = canEditChecklists(auth)
  const navigate = useNavigate()

  const clientTemplateQuery = useChecklistTemplateQuery(clientId, null)
  const siteTemplateQuery = useChecklistTemplateQuery(clientId, siteId)
  const itemsQuery = useChecklistItemsQuery(siteTemplateQuery.data?.id)
  const cloneTemplate = useCloneChecklistTemplateMutation()

  function goToTemplates() {
    void navigate(`/admin/tareas?cliente=${clientId}&sede=${siteId}`)
  }

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
    return <Skeleton className="h-24" />
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
            ? 'Podés crear una plantilla propia si esta sede necesita tareas distintas.'
            : 'El cliente todavía no tiene una plantilla de tareas: creala primero desde Plantillas de tareas.'
        }
        action={
          <div className="flex flex-wrap gap-2">
            {canEdit && clientTemplate && (
              <Button
                loading={cloneTemplate.isPending}
                onClick={() => void handleClone()}
              >
                Crear plantilla propia
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={goToTemplates}>
              Ir a plantillas de tareas
            </Button>
          </div>
        }
      />
    )
  }

  const itemsCount = itemsQuery.data?.length ?? 0
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-text">{siteTemplate.name}</p>
        <Badge variant="primary">Plantilla propia</Badge>
      </div>
      <p className="text-[12px] text-text-3">
        {itemsCount === 0
          ? 'Todavía sin ítems cargados.'
          : `${itemsCount} ${itemsCount === 1 ? 'ítem' : 'ítems'} en el checklist.`}
      </p>
      <div>
        <Button variant="ghost" size="sm" onClick={goToTemplates}>
          Ir a plantillas de tareas
        </Button>
      </div>
    </div>
  )
}

export { SiteTemplateSummary }
