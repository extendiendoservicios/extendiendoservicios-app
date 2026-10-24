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
import { dateTimeLocalToIso } from '@/features/attendance/dateTimeLocal'
import { useAddWorkdayPauseMutation } from '../queries'
import {
  addWorkdayPauseSchema,
  type AddWorkdayPauseFormValues,
} from '../schemas'
import { isWithinWorkdayBounds, workdayTimeBounds } from '../time'

const OUT_OF_RANGE_MESSAGE =
  'La hora tiene que estar entre las 0:00 del día de la jornada y este momento, y no puede pasar la medianoche.'

interface AddWorkdayPauseDialogProps {
  workdayId: string
  /** Día de la jornada (`YYYY-MM-DD`). */
  workDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Agregar pausa» (P24.3, CJ-32, `admin_add_workday_pause`): suma una pausa
 * que el coordinador no registró. Lleva dos motivos: el de la pausa
 * (opcional, CJ-16) y el de la corrección (obligatorio). El servidor valida
 * que caiga dentro de la jornada y no pise otra pausa ni una supervisión
 * (`INVALID_EVENT_ORDER`).
 */
function AddWorkdayPauseDialog({
  workdayId,
  workDate,
  open,
  onOpenChange,
}: AddWorkdayPauseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <AddWorkdayPauseForm
            workdayId={workdayId}
            workDate={workDate}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddWorkdayPauseForm({
  workdayId,
  workDate,
  onClose,
}: Omit<AddWorkdayPauseDialogProps, 'open' | 'onOpenChange'> & {
  onClose: () => void
}) {
  const addPause = useAddWorkdayPauseMutation()
  const [bounds] = useState(() => workdayTimeBounds(workDate))

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<AddWorkdayPauseFormValues>({
    resolver: zodResolver(addWorkdayPauseSchema),
    defaultValues: {
      startsAt: `${workDate}T12:00`,
      endsAt: `${workDate}T12:30`,
      pauseReason: '',
      reason: '',
    },
  })

  async function onSubmit(values: AddWorkdayPauseFormValues) {
    const currentBounds = workdayTimeBounds(workDate)
    if (!isWithinWorkdayBounds(values.startsAt, currentBounds)) {
      setError('startsAt', { message: OUT_OF_RANGE_MESSAGE })
      return
    }
    if (!isWithinWorkdayBounds(values.endsAt, currentBounds)) {
      setError('endsAt', { message: OUT_OF_RANGE_MESSAGE })
      return
    }
    try {
      await addPause.mutateAsync({
        workdayId,
        startsAt: dateTimeLocalToIso(values.startsAt),
        endsAt: dateTimeLocalToIso(values.endsAt),
        pauseReason: values.pauseReason || undefined,
        reason: values.reason,
      })
      toast.success('Agregamos la pausa.')
      onClose()
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos agregar la pausa.',
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
        <DialogTitle>Agregar pausa</DialogTitle>
        <DialogDescription>
          Esas horas se descuentan de la jornada. Queda registrado quién la
          agregó y por qué.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.startsAt) || undefined}>
          <FieldLabel htmlFor="add-pause-starts">Desde</FieldLabel>
          <Input
            id="add-pause-starts"
            type="datetime-local"
            min={bounds.min}
            max={bounds.max}
            aria-invalid={Boolean(errors.startsAt)}
            {...register('startsAt')}
          />
          {errors.startsAt && (
            <FieldError>{errors.startsAt.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.endsAt) || undefined}>
          <FieldLabel htmlFor="add-pause-ends">Hasta</FieldLabel>
          <Input
            id="add-pause-ends"
            type="datetime-local"
            min={bounds.min}
            max={bounds.max}
            aria-invalid={Boolean(errors.endsAt)}
            {...register('endsAt')}
          />
          {errors.endsAt && <FieldError>{errors.endsAt.message}</FieldError>}
        </Field>
      </div>
      <Field data-invalid={Boolean(errors.pauseReason) || undefined}>
        <FieldLabel htmlFor="add-pause-pause-reason">
          Motivo de la pausa (opcional)
        </FieldLabel>
        <Input
          id="add-pause-pause-reason"
          placeholder="Por ejemplo: almuerzo"
          aria-invalid={Boolean(errors.pauseReason)}
          {...register('pauseReason')}
        />
        {errors.pauseReason && (
          <FieldError>{errors.pauseReason.message}</FieldError>
        )}
      </Field>
      <Field data-invalid={Boolean(errors.reason) || undefined}>
        <FieldLabel htmlFor="add-pause-reason">
          Motivo de la corrección
        </FieldLabel>
        <Textarea
          id="add-pause-reason"
          rows={3}
          placeholder="Por ejemplo: pausó para almorzar y no lo registró"
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
          disabled={addPause.isPending}
        >
          Volver
        </Button>
        <Button type="submit" loading={addPause.isPending}>
          Agregar pausa
        </Button>
      </DialogFooter>
    </form>
  )
}

export { AddWorkdayPauseDialog }
