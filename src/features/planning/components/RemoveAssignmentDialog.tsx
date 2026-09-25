import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { isApiError } from '@/api/errors'
import { useRemoveAssignmentMutation } from '@/features/planning/queries'

/**
 * Quita una asignación con motivo obligatorio (ASSIGN-013, `06` sección 8:
 * `remove_assignment`; regla común de la capa: "acciones con motivo
 * obligatorio → diálogo de confirmación", mismo componente que
 * `CancelShiftDialog`).
 */
interface RemoveAssignmentDialogProps {
  assignmentId: string
  employeeName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRemoved?: () => void
}

function RemoveAssignmentDialog({
  assignmentId,
  employeeName,
  open,
  onOpenChange,
  onRemoved,
}: RemoveAssignmentDialogProps) {
  const removeAssignment = useRemoveAssignmentMutation()

  async function handleConfirm(reason: string) {
    try {
      await removeAssignment.mutateAsync({ assignmentId, reason })
      toast.success(`Quitamos a ${employeeName} del turno.`)
      onOpenChange(false)
      onRemoved?.()
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos quitar la asignación.',
      )
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Quitar a ${employeeName} del turno`}
      description="La asignación queda registrada para el historial; el turno vuelve a Programado si la dotación queda incompleta."
      reasonLabel="Motivo"
      reasonPlaceholder="Por ejemplo: pidió el cambio la propia persona"
      confirmLabel="Quitar del turno"
      cancelLabel="Volver"
      variant="destructive"
      isLoading={removeAssignment.isPending}
      onConfirm={(reason) => void handleConfirm(reason)}
    />
  )
}

export { RemoveAssignmentDialog }
