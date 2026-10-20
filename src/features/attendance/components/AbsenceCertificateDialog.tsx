import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup } from '@/components/ui/radio-group'
import { OptionCard } from '@/components/OptionCard'
import { absenceErrorMessage } from '@/features/attendance/absenceErrors'
import { useSetAbsenceCertificateMutation } from '@/features/attendance/queries'

/**
 * «Marcar certificado» / «Cambiar» sobre una ausencia ya avisada (P19.11d):
 * llama a `set_absence_certificate`. La ausencia no se vuelve a avisar.
 */
interface AbsenceCertificateDialogProps {
  assignmentId: string
  employeeName: string
  /** Valor actual: `null` si todavía no se indicó. */
  current: boolean | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function AbsenceCertificateDialog({
  assignmentId,
  employeeName,
  current,
  open,
  onOpenChange,
}: AbsenceCertificateDialogProps) {
  const setCertificate = useSetAbsenceCertificateMutation()
  const [choice, setChoice] = useState<string>(
    current == null ? '' : current ? 'yes' : 'no',
  )
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (choice === '') {
      setError('Indicá si la ausencia tiene certificado.')
      return
    }
    try {
      await setCertificate.mutateAsync({
        assignmentId,
        hasCertificate: choice === 'yes',
      })
      toast.success('Guardamos el certificado de la ausencia.')
      onOpenChange(false)
    } catch (err) {
      toast.error(
        absenceErrorMessage(err, 'No pudimos guardar el certificado.'),
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Certificado de la ausencia de {employeeName}
          </DialogTitle>
          <DialogDescription>
            Podés corregirlo cuando quieras; queda registrado quién lo cambió.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={choice}
          onValueChange={(value) => {
            setChoice(value)
            setError(null)
          }}
          aria-label="Certificado"
          className="gap-2"
        >
          <OptionCard value="yes" title="Con certificado" />
          <OptionCard value="no" title="Sin certificado" />
        </RadioGroup>
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Volver
          </Button>
          <Button
            loading={setCertificate.isPending}
            onClick={() => void handleSave()}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { AbsenceCertificateDialog }
