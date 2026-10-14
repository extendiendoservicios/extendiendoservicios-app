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
  dateTimeLocalToIso,
  shiftDayStartAsDateTimeLocal,
  toDateTimeLocal,
} from '@/features/attendance/dateTimeLocal'
import { geoErrorMessage, GEO_ERROR_MESSAGES } from '../errors'
import { useCorrectAttendanceTimeMutation } from '../queries'
import { correctTimeSchema, type CorrectTimeFormValues } from '../schemas'

interface CorrectTimeDialogProps {
  /** Id del fichaje (`attendance_records.id`). */
  recordId: string
  kind: 'check_in' | 'check_out'
  /** Hora registrada hoy (instante), que se propone como punto de partida. */
  currentTime: string
  /** Fecha del turno (`YYYY-MM-DD`): la hora nueva no puede ser anterior a sus 0:00. */
  shiftDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * «Corregir hora» (B-28, `correct_attendance_time`): cambia la hora de un
 * inicio o fin ya registrado, con motivo obligatorio. Queda el valor anterior,
 * quién y cuándo. La hora tiene que caer dentro del día del turno y no puede
 * ser futura (misma regla que «Registrar en nombre»).
 */
function CorrectTimeDialog({
  recordId,
  kind,
  currentTime,
  shiftDate,
  open,
  onOpenChange,
}: CorrectTimeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* El formulario se monta al abrir: arranca con la hora vigente y sin motivo. */}
        {open && (
          <CorrectTimeForm
            recordId={recordId}
            kind={kind}
            currentTime={currentTime}
            shiftDate={shiftDate}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CorrectTimeForm({
  recordId,
  kind,
  currentTime,
  shiftDate,
  onClose,
}: Omit<CorrectTimeDialogProps, 'open' | 'onOpenChange'> & {
  onClose: () => void
}) {
  const correct = useCorrectAttendanceTimeMutation()
  // «Ahora» se congela al abrir, para que el máximo del campo no se corra mientras se escribe.
  const [nowValue] = useState(() => toDateTimeLocal())
  const minValue = shiftDayStartAsDateTimeLocal(shiftDate)
  const label = kind === 'check_in' ? 'inicio' : 'fin'

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<CorrectTimeFormValues>({
    resolver: zodResolver(correctTimeSchema),
    defaultValues: {
      at: toDateTimeLocal(new Date(currentTime)),
      reason: '',
    },
  })

  async function onSubmit(values: CorrectTimeFormValues) {
    if (values.at < minValue || values.at > toDateTimeLocal()) {
      setError('at', { message: GEO_ERROR_MESSAGES.AT_OUT_OF_RANGE })
      return
    }
    try {
      await correct.mutateAsync({
        recordId,
        newTime: dateTimeLocalToIso(values.at),
        reason: values.reason,
      })
      toast.success(`Corregimos la hora de ${label}.`)
      onClose()
    } catch (error) {
      toast.error(geoErrorMessage(error, 'No pudimos corregir la hora.'))
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>Corregir hora de {label}</DialogTitle>
        <DialogDescription>
          Queda guardada la hora anterior, quién la corrigió y el motivo. El
          empleado ve que fue corregida, sin el motivo.
        </DialogDescription>
      </DialogHeader>
      <Field data-invalid={Boolean(errors.at) || undefined}>
        <FieldLabel htmlFor="correct-time-at">Hora nueva</FieldLabel>
        <Input
          id="correct-time-at"
          type="datetime-local"
          min={minValue}
          max={nowValue}
          aria-invalid={Boolean(errors.at)}
          {...register('at')}
        />
        {errors.at && <FieldError>{errors.at.message}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.reason) || undefined}>
        <FieldLabel htmlFor="correct-time-reason">Motivo</FieldLabel>
        <Textarea
          id="correct-time-reason"
          rows={3}
          placeholder="Por ejemplo: fichó la entrada con retraso por un problema de señal"
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

export { CorrectTimeDialog }
