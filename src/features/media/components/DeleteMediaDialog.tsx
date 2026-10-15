import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { deleteTitle, keepWarning } from '@/features/media/bulk'

/**
 * Confirmación de «Eliminar» de a varios en ADM-32 (P21.8b). No pide motivo:
 * lo que queda es la constancia de quién y cuándo. Avisa aparte si entre lo
 * elegido hay archivos marcados «Conservar», que también se eliminan.
 */
interface DeleteMediaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Cuántos archivos se van a eliminar. */
  count: number
  /** Cuántos de ellos están marcados «Conservar». */
  keepCount: number
  isLoading?: boolean
  onConfirm: () => void
}

function DeleteMediaDialog({
  open,
  onOpenChange,
  count,
  keepCount,
  isLoading = false,
  onConfirm,
}: DeleteMediaDialogProps) {
  const warning = keepWarning(keepCount)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{deleteTitle(count)}</DialogTitle>
          <DialogDescription>
            Esto no se puede deshacer: los archivos se borran y no hay forma de
            recuperarlos. En el turno queda la constancia de que se eliminaron,
            con tu nombre y el día.
          </DialogDescription>
        </DialogHeader>
        {warning && (
          <p
            role="alert"
            className="rounded-md border border-warning-border bg-warning-bg p-3 text-[12.5px] font-semibold text-warning-800"
          >
            {warning}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={isLoading}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={isLoading}
            onClick={onConfirm}
          >
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { DeleteMediaDialog }
