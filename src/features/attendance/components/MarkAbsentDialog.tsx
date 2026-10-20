import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AbsenceNoticeForm } from './AbsenceNoticeForm'

/**
 * Popup «Ausente» del detalle del turno (P19.11d, ADM-06): la administración
 * avisa la ausencia de una persona asignada, eligiendo con o sin certificado
 * (obligatorio) y, si quiere, el motivo. Llama a `notify_absence`.
 */
interface MarkAbsentDialogProps {
  assignmentId: string
  employeeName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function MarkAbsentDialog({
  assignmentId,
  employeeName,
  open,
  onOpenChange,
}: MarkAbsentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar a {employeeName} como ausente</DialogTitle>
          <DialogDescription>
            Elegí si presenta certificado. El motivo es opcional.
          </DialogDescription>
        </DialogHeader>
        <AbsenceNoticeForm
          assignmentId={assignmentId}
          submitLabel="Marcar ausente"
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

export { MarkAbsentDialog }
