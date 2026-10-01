import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { isApiError } from '@/api/errors'
import { useCancelSupervisionMutation } from '@/features/supervisions/queries'

/**
 * ADM-15 (SUP-011, `06` sección 12): `cancel_supervision` con motivo
 * obligatorio, mismo patrón que `CancelShiftDialog` (`src/features/shifts/`).
 */
interface CancelSupervisionDialogProps {
  supervisionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function CancelSupervisionDialog({
  supervisionId,
  open,
  onOpenChange,
}: CancelSupervisionDialogProps) {
  const cancelSupervision = useCancelSupervisionMutation()

  async function handleConfirm(reason: string) {
    try {
      await cancelSupervision.mutateAsync({ supervisionId, reason })
      toast.success('Cancelamos la supervisión.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos cancelar la supervisión.',
      )
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cancelar supervisión"
      description="Las calificaciones ya cargadas quedan registradas; solo cambia el estado de la supervisión."
      reasonLabel="Motivo de la cancelación"
      confirmLabel="Cancelar supervisión"
      cancelLabel="Volver"
      variant="destructive"
      isLoading={cancelSupervision.isPending}
      onConfirm={(reason) => void handleConfirm(reason)}
    />
  )
}

export { CancelSupervisionDialog }
