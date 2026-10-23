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
import { isApiError } from '@/api/errors'
import { WORKDAY_EVENT_LABELS, type WorkdayEvent } from '@/api/workdaysAdmin'
import {
  dateTimeLocalToIso,
  toDateTimeLocal,
} from '@/features/attendance/dateTimeLocal'
import { useCorrectWorkdayEventMutation } from '../queries'
import {
  correctWorkdayEventSchema,
  type CorrectWorkdayEventFormValues,
} from '../schemas'
import { isWithinWorkdayBounds, workdayTimeBounds } from '../time'

const OUT_OF_RANGE_MESSAGE =
  'La hora tiene que estar entre las 0:00 del día de la jornada y este momento, y no puede pasar la medianoche.'

interface CorrectWorkdayEventDialogProps {
  event: WorkdayEvent
  /** Día de la jornada (`YYYY-MM-DD`). */
  workDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Corregir hora» de un evento de la jornada de un coordinador (P24.3,
 * CJ-32, `admin_correct_workday_event`): cambia la hora de un inicio,
 * pausa, reanudación, fin o reapertura, con motivo obligatorio. Queda la
 * hora anterior, quién y cuándo corrigió. Mismo patrón que
 * `CorrectTimeDialog` de B1. La hora tiene que caer dentro del día de la
 * jornada y no ser futura.
 */
function CorrectWorkdayEventDialog({
  event,
  workDate,
  open,
  onOpenChange,
}: CorrectWorkdayEventDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <CorrectWorkdayEventForm
            event={event}
            workDate={workDate}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CorrectWorkdayEventForm({
  event,
  workDate,
  onClose,
}: Omit<CorrectWorkdayEventDialogProps, 'open' | 'onOpenChange'> & {
  onClose: () => void
}) {
  const correct = useCorrectWorkdayEventMutation()
  // «Ahora» se congela al abrir, para que el máximo del campo no se corra mientras se escribe.
  const [bounds] = useState(() => workdayTimeBounds(workDate))
  const label = WORKDAY_EVENT_LABELS[event.kind].toLowerCase()

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CorrectWorkdayEventFormValues>({
    resolver: zodResolver(correctWorkdayEventSchema),
    defaultValues: {
      at: toDateTimeLocal(new Date(event.recordedAt)),
      reason: '',
    },
  })

  async function onSubmit(values: CorrectWorkdayEventFormValues) {
    const currentBounds = workdayTimeBounds(workDate)
    if (!isWithinWorkdayBounds(values.at, currentBounds)) {
      setError('at', { message: OUT_OF_RANGE_MESSAGE })
      return
    }
    try {
      await correct.mutateAsync({
        eventId: event.id,
        newTime: dateTimeLocalToIso(values.at),
        reason: values.reason,
      })
      toast.success(`Corregimos la hora: ${label}.`)
      onClose()
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos corregir la hora.',
      )
    }
  }

  return (
    <form
      noValidate
      onSubmit={(submitEvent) => void handleSubmit(onSubmit)(submitEvent)}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>Corregir hora: {label}</DialogTitle>
        <DialogDescription>
          Queda guardada la hora anterior, quién la corrigió y el motivo. La
          jornada pasa a figurar como corregida.
        </DialogDescription>
      </DialogHeader>
      <Field data-invalid={Boolean(errors.at) || undefined}>
        <FieldLabel htmlFor="correct-workday-at">Hora nueva</FieldLabel>
        <Input
          id="correct-workday-at"
          type="datetime-local"
          min={bounds.min}
          max={bounds.max}
          aria-invalid={Boolean(errors.at)}
          {...register('at')}
        />
        {errors.at && <FieldError>{errors.at.message}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.reason) || undefined}>
        <FieldLabel htmlFor="correct-workday-reason">Motivo</FieldLabel>
        <Textarea
          id="correct-workday-reason"
          rows={3}
          placeholder="Por ejemplo: finalizó la jornada a las 18:00 y se olvidó de registrarlo"
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
          Corregir hora
        </Button>
      </DialogFooter>
    </form>
  )
}

export { CorrectWorkdayEventDialog }
