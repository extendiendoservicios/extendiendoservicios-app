import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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
import { toDateTimeLocal } from '@/features/attendance/dateTimeLocal'
import { workdayActionSchema, type WorkdayActionFormValues } from '../schemas'
import { actionTimeBounds, actionTimeToIso } from '../time'

const OUT_OF_RANGE_MESSAGE =
  'La hora no puede ser futura ni anterior al comienzo que corresponde. Revisá lo que elegiste.'

interface WorkdayActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  timeLabel: string
  confirmLabel: string
  reasonPlaceholder?: string
  destructive?: boolean
  /** Día de la jornada (`YYYY-MM-DD`). */
  workDate: string
  /** Desde cuándo vale la hora (inicio de la jornada o de la pausa). */
  since: string | null
  isPending: boolean
  /** `at` es `undefined` si quien confirma dejó «ahora»: el servidor usa su hora. */
  onSubmit: (input: { at: string | undefined; reason: string }) => void
}

/**
 * Diálogo de una acción de la administración sobre la jornada de un
 * coordinador que pide una hora y un motivo (OD-06 «Finalizar jornada», OD-07
 * «Cerrar pausa»). La hora viene por defecto en «ahora»; si no se toca, no se
 * manda `p_at`. No se admite futura. Quien lo usa hace la llamada y cierra el
 * diálogo: si el servidor rechaza, queda abierto.
 */
function WorkdayActionDialog({
  open,
  onOpenChange,
  ...rest
}: WorkdayActionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <WorkdayActionForm onClose={() => onOpenChange(false)} {...rest} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function WorkdayActionForm({
  title,
  description,
  timeLabel,
  confirmLabel,
  reasonPlaceholder,
  destructive,
  workDate,
  since,
  isPending,
  onSubmit,
  onClose,
}: Omit<WorkdayActionDialogProps, 'open' | 'onOpenChange'> & {
  onClose: () => void
}) {
  // «Ahora» se congela al abrir, para saber si se dejó la hora por defecto.
  const [initial] = useState(() => toDateTimeLocal(new Date()))
  const [bounds] = useState(() => actionTimeBounds(workDate, since))
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<WorkdayActionFormValues>({
    resolver: zodResolver(workdayActionSchema),
    defaultValues: { at: initial, reason: '' },
  })

  function submit(values: WorkdayActionFormValues) {
    const current = actionTimeBounds(workDate, since)
    // Dejar la hora por defecto es válido aunque pasen unos minutos mientras se escribe el motivo.
    const unchanged = values.at === initial
    if (!unchanged && (values.at < current.min || values.at > current.max)) {
      setError('at', { message: OUT_OF_RANGE_MESSAGE })
      return
    }
    onSubmit({
      at: actionTimeToIso(values.at, initial),
      reason: values.reason,
    })
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(submit)(event)}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-2">{description}</div>
        </DialogDescription>
      </DialogHeader>
      <Field data-invalid={Boolean(errors.at) || undefined}>
        <FieldLabel htmlFor="workday-action-at">{timeLabel}</FieldLabel>
        <Input
          id="workday-action-at"
          type="datetime-local"
          min={bounds.min}
          max={bounds.max}
          aria-invalid={Boolean(errors.at)}
          {...register('at')}
        />
        {errors.at && <FieldError>{errors.at.message}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.reason) || undefined}>
        <FieldLabel htmlFor="workday-action-reason">Motivo</FieldLabel>
        <Textarea
          id="workday-action-reason"
          rows={3}
          placeholder={reasonPlaceholder}
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
          disabled={isPending}
        >
          Volver
        </Button>
        <Button
          type="submit"
          variant={destructive ? 'destructive' : 'primary'}
          loading={isPending}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

export { WorkdayActionDialog }
