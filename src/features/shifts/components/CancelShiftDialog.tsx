import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { isApiError } from '@/api/errors'
import { useCancelShiftMutation } from '@/features/shifts/queries'

/**
 * SHIFT-011: diálogo de cancelación de turno, motivo obligatorio
 * (`07_Design_System.md` sección 2.4, reutiliza `ConfirmDialog` de DS-010 --
 * pensado justo para esta acción). `06_API.md` sección 7: `cancel_shift`,
 * capacidad `cancel_shifts`. Mismo componente que va a reutilizar ADM-06
 * (F11) cuando exista: el motivo por el que vive en `src/features/shifts/`
 * y no en la página, tal como pide el encargo.
 */
interface CancelShiftDialogProps {
  shiftId: string
  /** Fecha del turno (`YYYY-MM-DD`), para invalidar la lista del día correcta. */
  shiftDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancelled?: () => void
}

function CancelShiftDialog({
  shiftId,
  shiftDate,
  open,
  onOpenChange,
  onCancelled,
}: CancelShiftDialogProps) {
  const cancelShift = useCancelShiftMutation(shiftDate)

  async function handleConfirm(reason: string) {
    try {
      await cancelShift.mutateAsync({ shiftId, reason })
      toast.success('Cancelamos el turno.')
      onOpenChange(false)
      onCancelled?.()
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cancelar el turno.',
      )
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancelar turno"
      description="Las asignaciones quedan registradas para el historial; solo cambia el estado del turno."
      reasonLabel="Motivo de la cancelación"
      reasonPlaceholder="Por ejemplo: el cliente suspendió el servicio ese día"
      confirmLabel="Cancelar turno"
      variant="destructive"
      isLoading={cancelShift.isPending}
      onConfirm={(reason) => void handleConfirm(reason)}
    />
  )
}

export { CancelShiftDialog }
