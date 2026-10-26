import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { isApiError } from '@/api/errors'
import { useCorrectWorkdayEventMutation } from '../queries'

interface RemoveWorkdayPauseDialogProps {
  /** Id del evento `pause` (el servidor da de baja la pausa junto con su reanudación). */
  pauseEventId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Quitar pausa» (P24.3, CJ-32): `admin_correct_workday_event` con
 * `remove = true`. Motivo obligatorio; la pausa no se borra, queda dada de
 * baja con su traza (P-014).
 */
function RemoveWorkdayPauseDialog({
  pauseEventId,
  open,
  onOpenChange,
}: RemoveWorkdayPauseDialogProps) {
  const correct = useCorrectWorkdayEventMutation()

  async function handleConfirm(reason: string) {
    try {
      await correct.mutateAsync({ eventId: pauseEventId, reason, remove: true })
      toast.success('Quitamos la pausa.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos quitar la pausa.',
      )
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Quitar pausa"
      description="Esas horas vuelven a contar como trabajadas. La pausa queda registrada como dada de baja, con el motivo y quién la quitó."
      reasonLabel="Motivo"
      confirmLabel="Quitar pausa"
      cancelLabel="Volver"
      variant="destructive"
      isLoading={correct.isPending}
      onConfirm={(reason) => void handleConfirm(reason)}
    />
  )
}

export { RemoveWorkdayPauseDialog }
