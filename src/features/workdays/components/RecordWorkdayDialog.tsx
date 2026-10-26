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
import {
  dateTimeLocalToIso,
  toDateTimeLocal,
} from '@/features/attendance/dateTimeLocal'
import { useRecordWorkdayMutation } from '../queries'
import { recordWorkdaySchema, type RecordWorkdayFormValues } from '../schemas'

interface RecordWorkdayDialogProps {
  supervisorId: string
  supervisorName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Registrar jornada» en nombre del coordinador (P24.3, CJ-32,
 * `admin_record_workday`), para cuando se olvidó de iniciarla. El día sale
 * de la hora de inicio. El fin se puede dejar vacío solo si la jornada es
 * de hoy (queda abierta); el servidor lo exige para días anteriores
 * (`ENDED_AT_REQUIRED`). Una jornada por coordinador y por día
 * (`WORKDAY_ALREADY_EXISTS`: en ese caso se corrige la existente).
 */
function RecordWorkdayDialog({
  supervisorId,
  supervisorName,
  open,
  onOpenChange,
}: RecordWorkdayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <RecordWorkdayForm
            supervisorId={supervisorId}
            supervisorName={supervisorName}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RecordWorkdayForm({
  supervisorId,
  supervisorName,
  onClose,
}: Omit<RecordWorkdayDialogProps, 'open' | 'onOpenChange'> & {
  onClose: () => void
}) {
  const record = useRecordWorkdayMutation()
  const [nowValue] = useState(() => toDateTimeLocal())

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RecordWorkdayFormValues>({
    resolver: zodResolver(recordWorkdaySchema),
    defaultValues: { startedAt: '', endedAt: '', reason: '' },
  })

  async function onSubmit(values: RecordWorkdayFormValues) {
    const current = toDateTimeLocal()
    if (values.startedAt > current) {
      setError('startedAt', {
        message: 'La hora de inicio no puede ser futura.',
      })
      return
    }
    if (values.endedAt && values.endedAt > current) {
      setError('endedAt', { message: 'La hora de fin no puede ser futura.' })
      return
    }
    try {
      await record.mutateAsync({
        supervisorId,
        workDate: values.startedAt.slice(0, 10),
        startedAt: dateTimeLocalToIso(values.startedAt),
        endedAt: values.endedAt
          ? dateTimeLocalToIso(values.endedAt)
          : undefined,
        reason: values.reason,
      })
      toast.success('Registramos la jornada.')
      onClose()
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos registrar la jornada.',
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
        <DialogTitle>Registrar jornada de {supervisorName}</DialogTitle>
        <DialogDescription>
          Para cuando se olvidó de iniciarla. La jornada no puede pasar la
          medianoche, queda marcada como corregida y se guarda el motivo.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.startedAt) || undefined}>
          <FieldLabel htmlFor="record-workday-start">Inicio</FieldLabel>
          <Input
            id="record-workday-start"
            type="datetime-local"
            max={nowValue}
            aria-invalid={Boolean(errors.startedAt)}
            {...register('startedAt')}
          />
          {errors.startedAt && (
            <FieldError>{errors.startedAt.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.endedAt) || undefined}>
          <FieldLabel htmlFor="record-workday-end">
            Fin (opcional hoy)
          </FieldLabel>
          <Input
            id="record-workday-end"
            type="datetime-local"
            max={nowValue}
            aria-invalid={Boolean(errors.endedAt)}
            {...register('endedAt')}
          />
          {errors.endedAt && <FieldError>{errors.endedAt.message}</FieldError>}
        </Field>
      </div>
      <Field data-invalid={Boolean(errors.reason) || undefined}>
        <FieldLabel htmlFor="record-workday-reason">Motivo</FieldLabel>
        <Textarea
          id="record-workday-reason"
          rows={3}
          placeholder="Por ejemplo: trabajó el día completo y no pudo iniciar la jornada desde el celular"
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
          disabled={record.isPending}
        >
          Volver
        </Button>
        <Button type="submit" loading={record.isPending}>
          Registrar jornada
        </Button>
      </DialogFooter>
    </form>
  )
}

export { RecordWorkdayDialog }
