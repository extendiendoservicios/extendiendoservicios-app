import { toast } from 'sonner'
import { isApiError } from '@/api/errors'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { useReloadShiftTasksMutation } from '@/features/planning/queries'

/**
 * "Recargar tareas" de ADM-06 (TASK-006, `06_API.md` sección 7:
 * `reload_shift_tasks`, capacidad `edit_checklists`): reemplaza las tareas
 * del turno por las de la plantilla vigente (la de la sede si existe, si
 * no la del cliente). Sin motivo obligatorio (no está en la lista de `07`
 * sección 2.4 que sí lo exige): confirmación simple, pero con la
 * advertencia de que reemplaza lo ya cargado (regla del encargo).
 */
function ReloadTasksDialog({
  shiftId,
  open,
  onOpenChange,
}: {
  shiftId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const reloadTasks = useReloadShiftTasksMutation()

  async function handleConfirm() {
    try {
      await reloadTasks.mutateAsync(shiftId)
      toast.success('Recargamos las tareas del turno.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos recargar las tareas.',
      )
    }
  }

  return (
    <SimpleConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Recargar las tareas de este turno"
      description="Reemplaza las tareas actuales por las de la plantilla vigente (la de la sede, o si no tiene, la del cliente). Los estados ya cargados en las tareas actuales se pierden."
      confirmLabel="Recargar tareas"
      isLoading={reloadTasks.isPending}
      onConfirm={() => void handleConfirm()}
    />
  )
}

export { ReloadTasksDialog }
