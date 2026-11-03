import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  workdayAdminErrorMessage,
  type WorkdaySupervision,
} from '@/api/workdaysAdmin'
import {
  dateTimeLocalToIso,
  toDateTimeLocal,
} from '@/features/attendance/dateTimeLocal'
import { useCorrectSupervisionTimeMutation } from '../queries'
import {
  correctSupervisionTimeSchema,
  type CorrectSupervisionTimeFormValues,
} from '../schemas'
import { isWithinWorkdayBounds, workdayTimeBounds } from '../time'

const OUT_OF_RANGE_MESSAGE =
  'La hora tiene que estar entre las 0:00 del día de la jornada y este momento, y no puede pasar la medianoche.'
const NOTHING_TO_CHANGE_MESSAGE =
  'Las horas son iguales a las actuales: cambiá al menos una.'

interface CorrectSupervisionTimeDialogProps {
  supervision: WorkdaySupervision
  /** Día de la jornada (`YYYY-MM-DD`). */
  workDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Corregir horas» de una supervisión (OD-07, `admin_correct_supervision_time`):
 * la hora de inicio y, si la supervisión ya tiene fin, la de fin. Motivo
 * obligatorio; queda la hora anterior y quién corrigió. Las horas tienen que
 * caer dentro del día de la jornada y no ser futuras. Solo se mandan las que
 * cambiaron.
 */
function CorrectSupervisionTimeDialog({
  supervision,
  workDate,
  open,
  onOpenChange,
}: CorrectSupervisionTimeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <CorrectSupervisionTimeForm
            supervision={supervision}
            workDate={workDate}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CorrectSupervisionTimeForm({
  supervision,
  workDate,
  onClose,
}: Omit<CorrectSupervisionTimeDialogProps, 'open' | 'onOpenChange'> & {
  onClose: () => void
}) {
  const correct = useCorrectSupervisionTimeMutation()
  const [bounds] = useState(() => workdayTimeBounds(workDate))
  const initialStart = supervision.checkInAt
    ? toDateTimeLocal(new Date(supervision.checkInAt))
    : ''
  const initialEnd = supervision.checkOutAt
    ? toDateTimeLocal(new Date(supervision.checkOutAt))
    : ''

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CorrectSupervisionTimeFormValues>({
    resolver: zodResolver(correctSupervisionTimeSchema),
    defaultValues: { startAt: initialStart, endAt: initialEnd, reason: '' },
  })

  async function onSubmit(values: CorrectSupervisionTimeFormValues) {
    const startChanged = values.startAt !== initialStart
    const endChanged = Boolean(values.endAt) && values.endAt !== initialEnd
    if (!startChanged && !endChanged) {
      setError('startAt', { message: NOTHING_TO_CHANGE_MESSAGE })
      return
    }
    const currentBounds = workdayTimeBounds(workDate)
    if (startChanged && !isWithinWorkdayBounds(values.startAt, currentBounds)) {
      setError('startAt', { message: OUT_OF_RANGE_MESSAGE })
      return
    }
    if (
      endChanged &&
      values.endAt &&
      !isWithinWorkdayBounds(values.endAt, currentBounds)
    ) {
      setError('endAt', { message: OUT_OF_RANGE_MESSAGE })
      return
    }
    try {
      await correct.mutateAsync({
        supervisionId: supervision.supervisionId,
        reason: values.reason,
        startAt: startChanged ? dateTimeLocalToIso(values.startAt) : undefined,
        endAt:
          endChanged && values.endAt
            ? dateTimeLocalToIso(values.endAt)
            : undefined,
      })
      toast.success('Corregimos las horas de la supervisión.')
      onClose()
    } catch (error) {
      toast.error(
        workdayAdminErrorMessage(
          error,
          'No pudimos corregir las horas de la supervisión.',
        ),
      )
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>
          Corregir horas: {supervision.clientName} · {supervision.siteName}
        </DialogTitle>
        <DialogDescription>
          Queda guardada la hora anterior, quién la corrigió y el motivo. La
          jornada pasa a figurar como corregida.
        </DialogDescription>
      </DialogHeader>
      <Field data-invalid={Boolean(errors.startAt) || undefined}>
        <FieldLabel htmlFor="correct-supervision-start">
          Hora de inicio
        </FieldLabel>
        <Input
          id="correct-supervision-start"
          type="datetime-local"
          min={bounds.min}
          max={bounds.max}
          aria-invalid={Boolean(errors.startAt)}
          {...register('startAt')}
        />
        {errors.startAt && <FieldError>{errors.startAt.message}</FieldError>}
      </Field>
      {initialEnd && (
        <Field data-invalid={Boolean(errors.endAt) || undefined}>
          <FieldLabel htmlFor="correct-supervision-end">Hora de fin</FieldLabel>
          <Input
            id="correct-supervision-end"
            type="datetime-local"
            min={bounds.min}
            max={bounds.max}
            aria-invalid={Boolean(errors.endAt)}
            {...register('endAt')}
          />
          {errors.endAt && <FieldError>{errors.endAt.message}</FieldError>}
        </Field>
      )}
      <Field data-invalid={Boolean(errors.reason) || undefined}>
        <FieldLabel htmlFor="correct-supervision-reason">Motivo</FieldLabel>
        <Textarea
          id="correct-supervision-reason"
          rows={3}
          placeholder="Por ejemplo: cerró la supervisión mucho después de salir de la sede"
          aria-invalid={Boolean(errors.reason)}
          {...register('reason')}
        />
        {errors.reason && <FieldError>{errors.reason.message}</FieldError>}
      </Field>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={correct.isPending}
        >
          Volver
        </Button>
        <Button type="submit" loading={correct.isPending}>
          Corregir horas
        </Button>
      </DialogFooter>
    </form>
  )
}

export { CorrectSupervisionTimeDialog }
