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
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { StarRating } from '@/components/StarRating'
import { isApiError } from '@/api/errors'
import { useRateEmployeeMutation } from '@/features/supervisions/queries'

/**
 * Edición administrativa de una calificación (ADM-15, SUP-011, `06` sección
 * 13: `rate_employee`, capacidad `edit_ratings`). Upsert: sirve tanto para
 * cargar la primera calificación de un empleado como para corregir una ya
 * cargada -- el título y el mensaje de éxito cambian según haya o no una
 * calificación previa.
 */
interface RateEmployeeDialogProps {
  supervisionId: string
  assignmentId: string
  employeeName: string
  currentScore: number | null
  currentComment: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function RateEmployeeDialog({
  supervisionId,
  assignmentId,
  employeeName,
  currentScore,
  currentComment,
  open,
  onOpenChange,
}: RateEmployeeDialogProps) {
  const rateEmployee = useRateEmployeeMutation()
  const [score, setScore] = useState<number | null>(currentScore)
  const [comment, setComment] = useState(currentComment ?? '')
  const [showScoreError, setShowScoreError] = useState(false)

  // Empieza con el valor actual cada vez que se abre (mismo patrón que
  // `AssignmentTimeDialog`: ajuste de estado durante el render).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setScore(currentScore)
      setComment(currentComment ?? '')
      setShowScoreError(false)
    }
  }

  async function handleSubmit() {
    if (score === null) {
      setShowScoreError(true)
      return
    }
    try {
      await rateEmployee.mutateAsync({
        supervisionId,
        assignmentId,
        score,
        comment: comment.trim() ? comment.trim() : null,
      })
      toast.success(
        currentScore === null
          ? `Calificamos a ${employeeName}.`
          : `Actualizamos la calificación de ${employeeName}.`,
      )
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos guardar la calificación.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {currentScore === null ? 'Calificar' : 'Editar calificación'} a{' '}
            {employeeName}
          </DialogTitle>
          <DialogDescription>
            Puntaje de 1 a 5 estrellas y un comentario opcional.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field data-invalid={showScoreError || undefined}>
            <FieldLabel>Puntaje</FieldLabel>
            <StarRating
              aria-label="Puntaje"
              value={score}
              onValueChange={(value) => {
                setScore(value)
                setShowScoreError(false)
              }}
            />
            {showScoreError && (
              <FieldError>Elegí un puntaje de 1 a 5.</FieldError>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="rate-employee-comment">
              Comentario (opcional)
            </FieldLabel>
            <Textarea
              id="rate-employee-comment"
              rows={3}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            loading={rateEmployee.isPending}
            onClick={() => void handleSubmit()}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { RateEmployeeDialog }
