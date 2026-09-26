import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { isApiError } from '@/api/errors'
import type { AttendanceAction } from '@/features/attendance/derive'
import {
  dateTimeLocalToIso,
  shiftDayStartAsDateTimeLocal,
  toDateTimeLocal,
} from '@/features/attendance/dateTimeLocal'
import { ABSENCE_REASON_LABELS } from '@/features/attendance/reasonLabels'
import {
  useAdminNotifyAbsenceMutation,
  useAdminNotifyDelayMutation,
  useAdminRecordAttendanceMutation,
  useCloseAssignmentMutation,
} from '@/features/attendance/queries'
import {
  notifyAbsenceSchema,
  notifyDelayFormValuesToMinutes,
  notifyDelaySchema,
  recordAttendanceSchema,
  type NotifyAbsenceFormValues,
  type NotifyDelayFormValues,
  type RecordAttendanceFormValues,
} from '@/features/attendance/schemas'

/** Etiqueta de cada acción del selector (`05` línea 50: "inicio, fin, cierre manual, demora, ausencia"). */
const ACTION_LABELS: Record<AttendanceAction, string> = {
  check_in: 'Inicio',
  check_out: 'Fin',
  close: 'Cierre manual',
  delay: 'Demora',
  absence: 'Ausencia',
}

const ABSENCE_REASON_OPTIONS = Object.entries(ABSENCE_REASON_LABELS) as [
  keyof typeof ABSENCE_REASON_LABELS,
  string,
][]

/**
 * ADM-11 "Registrar en nombre del empleado" (ATT-010, ABS-008, `05`
 * línea 50): sin ruta propia (drawer de ADM-06/ADM-10, mismo criterio que
 * `AssignEmployeeSheet` -- ver `adminRoutes.tsx`). El `Sheet` se autoajusta
 * a pantalla completa por debajo de 768 px (P-094).
 *
 * `actions`: las que tiene sentido ofrecer para esta asignación
 * (`getAvailableAttendanceActions`, calculado por quien abre el panel con
 * los datos ya cargados de `v_assignments_board`). Si no hay ninguna
 * disponible, no se muestra el botón que abriría este panel (regla del
 * encargo: "solo las que tengan sentido según el estado").
 */
interface RecordAttendanceSheetProps {
  assignmentId: string
  employeeName: string
  shiftDate: string
  actions: AttendanceAction[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

function RecordAttendanceSheet({
  assignmentId,
  employeeName,
  shiftDate,
  actions,
  open,
  onOpenChange,
}: RecordAttendanceSheetProps) {
  const [selectedAction, setSelectedAction] = useState<AttendanceAction | null>(
    actions[0] ?? null,
  )

  // Reinicia la acción elegida cada vez que se abre (mismo patrón que
  // `ConfirmDialog`/`AssignEmployeeSheet`: ajuste de estado durante el
  // render, no un `useEffect`).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSelectedAction(actions[0] ?? null)
    }
  }

  function handleDone() {
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Registrar en nombre de {employeeName}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          <Field>
            <FieldLabel htmlFor="attendance-action">Acción</FieldLabel>
            <Select
              value={selectedAction ?? undefined}
              onValueChange={(value) =>
                setSelectedAction(value as AttendanceAction)
              }
            >
              <SelectTrigger id="attendance-action" aria-label="Elegir acción">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {actions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {ACTION_LABELS[action]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {(selectedAction === 'check_in' ||
            selectedAction === 'check_out' ||
            selectedAction === 'close') && (
            <RecordCheckForm
              key={selectedAction}
              assignmentId={assignmentId}
              shiftDate={shiftDate}
              action={selectedAction}
              onDone={handleDone}
            />
          )}

          {selectedAction === 'delay' && (
            <NotifyDelayForm assignmentId={assignmentId} onDone={handleDone} />
          )}

          {selectedAction === 'absence' && (
            <NotifyAbsenceForm
              assignmentId={assignmentId}
              onDone={handleDone}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Inicio, fin (`admin_record_attendance`) o cierre manual (`close_assignment`): misma forma, hora y motivo. */
function RecordCheckForm({
  assignmentId,
  shiftDate,
  action,
  onDone,
}: {
  assignmentId: string
  shiftDate: string
  action: 'check_in' | 'check_out' | 'close'
  onDone: () => void
}) {
  const adminRecordAttendance = useAdminRecordAttendanceMutation()
  const closeAssignment = useCloseAssignmentMutation()
  const isPending = adminRecordAttendance.isPending || closeAssignment.isPending

  // Se congela "ahora" al montar el formulario (no en cada render): así el
  // `max` del campo y el valor por defecto no se corren mientras la persona
  // completa el motivo.
  const [nowValue] = useState(() => toDateTimeLocal())
  const minValue = shiftDayStartAsDateTimeLocal(shiftDate)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RecordAttendanceFormValues>({
    resolver: zodResolver(recordAttendanceSchema),
    defaultValues: { at: nowValue, reason: '' },
  })

  async function onSubmit(values: RecordAttendanceFormValues) {
    const at = dateTimeLocalToIso(values.at)
    try {
      if (action === 'close') {
        await closeAssignment.mutateAsync({
          assignmentId,
          reason: values.reason,
          at,
        })
      } else {
        await adminRecordAttendance.mutateAsync({
          assignmentId,
          kind: action,
          reason: values.reason,
          at,
        })
      }
      toast.success(
        action === 'check_in'
          ? 'Registramos el inicio.'
          : 'Registramos el fin.',
      )
      onDone()
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos registrar la asistencia.',
      )
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-4"
    >
      <Field data-invalid={Boolean(errors.at) || undefined}>
        <FieldLabel htmlFor="attendance-at">Hora</FieldLabel>
        <Input
          id="attendance-at"
          type="datetime-local"
          min={minValue}
          max={nowValue}
          aria-invalid={Boolean(errors.at)}
          {...register('at')}
        />
        {errors.at && <FieldError>{errors.at.message}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.reason) || undefined}>
        <FieldLabel htmlFor="attendance-reason">Motivo</FieldLabel>
        <Textarea
          id="attendance-reason"
          rows={3}
          placeholder="Por ejemplo: se olvidó de fichar la entrada"
          aria-invalid={Boolean(errors.reason)}
          {...register('reason')}
        />
        {errors.reason && <FieldError>{errors.reason.message}</FieldError>}
      </Field>
      <SheetFooter className="p-0">
        <Button type="submit" loading={isPending}>
          {action === 'check_in'
            ? 'Registrar inicio'
            : action === 'check_out'
              ? 'Registrar fin'
              : 'Cerrar asignación'}
        </Button>
      </SheetFooter>
    </form>
  )
}

/** Aviso de demora en nombre del empleado (`notify_delay`, P-072). */
function NotifyDelayForm({
  assignmentId,
  onDone,
}: {
  assignmentId: string
  onDone: () => void
}) {
  const notifyDelay = useAdminNotifyDelayMutation()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NotifyDelayFormValues>({
    resolver: zodResolver(notifyDelaySchema),
    defaultValues: { minutes: '', reasonText: '' },
  })

  async function onSubmit(values: NotifyDelayFormValues) {
    try {
      await notifyDelay.mutateAsync({
        assignmentId,
        minutes: notifyDelayFormValuesToMinutes(values),
        reasonText: values.reasonText?.trim() || undefined,
      })
      toast.success('Avisamos la demora.')
      onDone()
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos avisar la demora.',
      )
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-4"
    >
      <Field data-invalid={Boolean(errors.minutes) || undefined}>
        <FieldLabel htmlFor="delay-minutes">
          Minutos de demora estimados
        </FieldLabel>
        <Input
          id="delay-minutes"
          type="number"
          min={1}
          max={600}
          aria-invalid={Boolean(errors.minutes)}
          {...register('minutes')}
        />
        {errors.minutes && <FieldError>{errors.minutes.message}</FieldError>}
      </Field>
      <Field data-invalid={Boolean(errors.reasonText) || undefined}>
        <FieldLabel htmlFor="delay-reason">Motivo (opcional)</FieldLabel>
        <Textarea
          id="delay-reason"
          rows={3}
          placeholder="Por ejemplo: colectivo demorado"
          {...register('reasonText')}
        />
      </Field>
      <SheetFooter className="p-0">
        <Button type="submit" loading={notifyDelay.isPending}>
          Avisar demora
        </Button>
      </SheetFooter>
    </form>
  )
}

/** Aviso de ausencia en nombre del empleado (`notify_absence`, P-073, ABS-008). */
function NotifyAbsenceForm({
  assignmentId,
  onDone,
}: {
  assignmentId: string
  onDone: () => void
}) {
  const notifyAbsence = useAdminNotifyAbsenceMutation()

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<NotifyAbsenceFormValues>({
    resolver: zodResolver(notifyAbsenceSchema),
    defaultValues: { reasonText: '' },
  })
  const reasonCode = watch('reasonCode')

  async function onSubmit(values: NotifyAbsenceFormValues) {
    try {
      await notifyAbsence.mutateAsync({
        assignmentId,
        reasonCode: values.reasonCode,
        reasonText: values.reasonText?.trim() || undefined,
      })
      toast.success('Avisamos la ausencia.')
      onDone()
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos avisar la ausencia.',
      )
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-4"
    >
      <Field data-invalid={Boolean(errors.reasonCode) || undefined}>
        <FieldLabel htmlFor="absence-reason-code">Motivo</FieldLabel>
        <Controller
          control={control}
          name="reasonCode"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger
                id="absence-reason-code"
                aria-label="Elegir motivo"
              >
                <SelectValue placeholder="Elegí un motivo" />
              </SelectTrigger>
              <SelectContent>
                {ABSENCE_REASON_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.reasonCode && (
          <FieldError>{errors.reasonCode.message}</FieldError>
        )}
      </Field>
      <Field data-invalid={Boolean(errors.reasonText) || undefined}>
        <FieldLabel htmlFor="absence-reason-text">
          Detalle{reasonCode === 'other' ? '' : ' (opcional)'}
        </FieldLabel>
        <Textarea
          id="absence-reason-text"
          rows={3}
          placeholder="Por ejemplo: turno médico de urgencia"
          aria-invalid={Boolean(errors.reasonText)}
          {...register('reasonText')}
        />
        {errors.reasonText && (
          <FieldError>{errors.reasonText.message}</FieldError>
        )}
      </Field>
      <SheetFooter className="p-0">
        <Button type="submit" loading={notifyAbsence.isPending}>
          Avisar ausencia
        </Button>
      </SheetFooter>
    </form>
  )
}

export { RecordAttendanceSheet, ACTION_LABELS }
