import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { isApiError } from '@/api/errors'
import { useMarkSupervisionNotDoneMutation } from '@/features/supervisions/queries'

/**
 * ADM-15 (SUP-011, `06` sección 12): `mark_supervision_not_done` con motivo
 * obligatorio.
 */
interface MarkSupervisionNotDoneDialogProps {
  supervisionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function MarkSupervisionNotDoneDialog({
  supervisionId,
  open,
  onOpenChange,
}: MarkSupervisionNotDoneDialogProps) {
  const markNotDone = useMarkSupervisionNotDoneMutation()

  async function handleConfirm(reason: string) {
    try {
      await markNotDone.mutateAsync({ supervisionId, reason })
      toast.success('Marcamos la supervisión como no realizada.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos marcar la supervisión como no realizada.',
      )
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Marcar como no realizada"
      description="Usalo cuando la supervisión no se pudo llevar a cabo (por ejemplo, el supervisor no pudo asistir)."
      reasonLabel="Motivo"
      confirmLabel="Marcar como no realizada"
      cancelLabel="Volver"
      variant="destructive"
      isLoading={markNotDone.isPending}
      onConfirm={(reason) => void handleConfirm(reason)}
    />
  )
}

export { MarkSupervisionNotDoneDialog }
