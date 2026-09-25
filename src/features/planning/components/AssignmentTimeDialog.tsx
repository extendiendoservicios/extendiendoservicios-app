import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import { useUpdateAssignmentTimeMutation } from '@/features/planning/queries'
import {
  assignmentTimeSchema,
  type AssignmentTimeFormValues,
} from '@/features/planning/schemas'

/**
 * Cambia la franja propia de una asignación (ASSIGN-013, `06` sección 8:
 * `update_assignment_time`, P-046). Las dos horas en blanco quiere decir
 * "sin franja propia": vuelve a heredar la del turno.
 */
interface AssignmentTimeDialogProps {
  assignmentId: string
  employeeName: string
  currentStartTime: string | null
  currentEndTime: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function AssignmentTimeDialog({
  assignmentId,
  employeeName,
  currentStartTime,
  currentEndTime,
  open,
  onOpenChange,
}: AssignmentTimeDialogProps) {
  const updateAssignmentTime = useUpdateAssignmentTimeMutation()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AssignmentTimeFormValues>({
    resolver: zodResolver(assignmentTimeSchema),
    defaultValues: {
      startTime: currentStartTime?.slice(0, 5) ?? '',
      endTime: currentEndTime?.slice(0, 5) ?? '',
    },
  })

  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      reset({
        startTime: currentStartTime?.slice(0, 5) ?? '',
        endTime: currentEndTime?.slice(0, 5) ?? '',
      })
    }
  }

  async function onSubmit(values: AssignmentTimeFormValues) {
    try {
      await updateAssignmentTime.mutateAsync({
        assignmentId,
        start: values.startTime || undefined,
        end: values.endTime || undefined,
      })
      toast.success('Actualizamos la franja de la asignación.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos actualizar la franja.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Franja propia de {employeeName}</DialogTitle>
          <DialogDescription>
            Dejá las dos horas en blanco para que la asignación vuelva a heredar
            la franja del turno.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field data-invalid={Boolean(errors.startTime) || undefined}>
              <FieldLabel htmlFor="assignment-start-time">Desde</FieldLabel>
              <Input
                id="assignment-start-time"
                type="time"
                aria-invalid={Boolean(errors.startTime)}
                {...register('startTime')}
              />
              {errors.startTime && (
                <FieldError>{errors.startTime.message}</FieldError>
              )}
            </Field>
            <Field data-invalid={Boolean(errors.endTime) || undefined}>
              <FieldLabel htmlFor="assignment-end-time">Hasta</FieldLabel>
              <Input
                id="assignment-end-time"
                type="time"
                aria-invalid={Boolean(errors.endTime)}
                {...register('endTime')}
              />
              {errors.endTime && (
                <FieldError>{errors.endTime.message}</FieldError>
              )}
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={updateAssignmentTime.isPending}>
              Guardar franja
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { AssignmentTimeDialog }
