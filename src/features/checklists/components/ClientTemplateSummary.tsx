import { useNavigate } from 'react-router'
import { ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import {
  useChecklistItemsQuery,
  useChecklistTemplateQuery,
} from '@/features/checklists/queries'

/**
 * Pestaña "Tareas" de ADM-21 (TASK-007, `05` línea 75: "Tareas (plantilla
 * del cliente, enlace a ADM-26)"): resumen de solo lectura -- alta y
 * edición de la plantilla se hacen en ADM-26, no acá.
 */
function ClientTemplateSummary({ clientId }: { clientId: string }) {
  const navigate = useNavigate()
  const templateQuery = useChecklistTemplateQuery(clientId, null)
  const itemsQuery = useChecklistItemsQuery(templateQuery.data?.id)

  function goToTemplates() {
    void navigate(`/admin/tareas?cliente=${clientId}`)
  }

  if (templateQuery.isLoading) {
    return <Skeleton className="h-24" />
  }

  const template = templateQuery.data
  if (!template) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Este cliente todavía no tiene una plantilla de tareas"
        description="Creala desde Plantillas de tareas para que se copie a cada turno nuevo."
        action={
          <Button variant="ghost" size="sm" onClick={goToTemplates}>
            Ir a plantillas de tareas
          </Button>
        }
      />
    )
  }

  const itemsCount = itemsQuery.data?.length ?? 0
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
      <p className="font-semibold text-text">{template.name}</p>
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

export { ClientTemplateSummary }
