import { useQueryClient } from '@tanstack/react-query'
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
  /** P19.10: desde el detalle del turno se llama «Quitar supervisión». */
  title?: string
  confirmLabel?: string
  successMessage?: string
}

function CancelSupervisionDialog({
  supervisionId,
  open,
  onOpenChange,
  title = 'Cancelar supervisión',
  confirmLabel = 'Cancelar supervisión',
  successMessage = 'Cancelamos la supervisión.',
}: CancelSupervisionDialogProps) {
  const cancelSupervision = useCancelSupervisionMutation()
  const queryClient = useQueryClient()

  async function handleConfirm(reason: string) {
    try {
      await cancelSupervision.mutateAsync({ supervisionId, reason })
      toast.success(successMessage)
      // El detalle del turno y la columna «Supervisor» de Planificación
      // cuelgan de otras claves de caché.
      void queryClient.invalidateQueries({ queryKey: ['planning'] })
      void queryClient.invalidateQueries({ queryKey: ['shifts'] })
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
      title={title}
      description="Las calificaciones ya cargadas quedan registradas; solo cambia el estado de la supervisión."
      reasonLabel="Motivo de la cancelación"
      confirmLabel={confirmLabel}
      cancelLabel="Volver"
      variant="destructive"
      isLoading={cancelSupervision.isPending}
      onConfirm={(reason) => void handleConfirm(reason)}
    />
  )
}

export { CancelSupervisionDialog }
