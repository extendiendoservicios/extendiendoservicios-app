import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { CalendarClock, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { RepeatFields } from '@/features/services/components/RepeatFields'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { ShiftObservationField } from '@/features/shifts/components/ShiftObservationField'
import { OpenEndedToggle } from '@/features/shifts/components/OpenEndedToggle'
import { RequiresPhotosToggle } from '@/features/shifts/components/RequiresPhotosToggle'
import { OPEN_ENDED_LABEL } from '@/features/shifts/openEnded'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { Combobox } from '@/components/Combobox'
import { DatePicker } from '@/components/DatePicker'
import { StatusBadge } from '@/components/status'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  newClientPickerOptions,
  newSitePickerOptions,
} from '@/features/clients/pickerOptions'
import {
  useClientsQuery,
  useClientSitesQuery,
} from '@/features/clients/queries'
import {
  useActiveEmployeeOptionsQuery,
  useLeavesInRangeQuery,
} from '@/features/employees/queries'
import { EmployeeMultiPicker } from '@/features/planning/components/EmployeeMultiPicker'
import { WARNING_MESSAGES } from '@/features/planning/components/AssignEmployeeSheet'
import {
  assignedWarningLines,
  clampSelection,
  rejectedLines,
  rejectedTitle,
} from '@/features/shifts/assignOnCreate'
import {
  canEditShiftDate,
  DATE_CHANGE_NOTICE,
  dateWarningLines,
  shiftDateErrorMessage,
} from '@/features/shifts/dateChange'
import { employeesOnLeaveIn } from '@/features/shifts/leaveBlocking'
import { SimpleConfirmDialog } from '@/features/settings/components/SimpleConfirmDialog'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { useHolidaysQuery } from '@/features/settings/queries'
import {
  formatDateOnly,
  localDateToIsoDate,
} from '@/features/settings/dateOnly'
import { canManageShiftTime } from '@/features/shifts/permissions'
import {
  useCreateShiftMutation,
  useCreateShiftSeriesMutation,
  useShiftForEditQuery,
  useShiftSeriesPreviewQuery,
  useShiftDateWarningsMutation,
  useUpdateShiftTimeMutation,
} from '@/features/shifts/queries'
import {
  describeSeriesPreview,
  seriesIssuesByDate,
  seriesIssuesTitle,
  seriesSuccessMessage,
} from '@/features/shifts/series'
import {
  defaultWeekdayForDate,
  maxSeriesDate,
  shiftEditFormSchema,
  shiftEditFormValuesToInputs,
  shiftFormSchema,
  shiftFormValuesToCreateInput,
  shiftFormValuesToSeriesRule,
  type ShiftEditFormValues,
  type ShiftFormValues,
} from '@/features/shifts/schemas'
import { useUpdateShiftDetailsMutation } from '@/features/planning/queries'
import { useLeaveForm } from '@/app/shells/backNavigation'

/** `"YYYY-MM-DD"` → `Date` para `DatePicker` (mismo criterio que `ServiceFormPage`). */
function isoDateToDate(isoDate: string | undefined): Date | undefined {
  return isoDate ? new Date(`${isoDate}T00:00:00`) : undefined
}

/**
 * ADM-07 "Formulario de turno" (SHIFT-008, `05` línea 41): alta puntual
 * (`/admin/turnos/nuevo`, con `?fecha=` opcional desde ADM-05) y edición
 * (`/admin/turnos/:id/editar`).
 *
 * En edición, `05` línea 41 pide "franja, dotación y notas, según estado":
 * hasta P11.2 solo existía `update_shift_time` (franja); `update_shift_details`
 * llegó en P11.1 (`0024_rpc_assignments.sql`) y cierra el pendiente que
 * dejaba anotado `12_Registro_de_Progreso.md` (ASSIGN-013, P11.3) -- el
 * formulario llama a las dos RPC al guardar. Cliente, sede y fecha siguen de
 * solo lectura en edición (no hay endpoint para cambiarlas).
 */
export default function ShiftFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id != null
  const [searchParams] = useSearchParams()
  const dateFromQuery = !isEditMode ? searchParams.get('fecha') : null
  const navigate = useNavigate()
  const auth = useAuth()
  const canManage = canManageShiftTime({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })

  if (isEditMode) {
    return (
      <EditShiftTimeForm id={id} navigate={navigate} canManage={canManage} />
    )
  }
  return (
    <CreateShiftForm
      dateFromQuery={dateFromQuery}
      navigate={navigate}
      canManage={canManage}
    />
  )
}

function CreateShiftForm({
  dateFromQuery,
  navigate,
  canManage,
}: {
  dateFromQuery: string | null
  navigate: ReturnType<typeof useNavigate>
  canManage: boolean
}) {
  const leaveForm = useLeaveForm()
  const createShift = useCreateShiftMutation()
  const createShiftSeries = useCreateShiftSeriesMutation()
  const employeeOptionsQuery = useActiveEmployeeOptionsQuery()
  // AJ2-17: empleados que quedan asignados al crear el turno.
  const [pickedEmployeeIds, setPickedEmployeeIds] = useState<string[]>([])

  const defaultValues: ShiftFormValues = {
    clientId: '',
    siteId: '',
    date: dateFromQuery ?? '',
    startTime: '',
    endTime: '',
    openEnded: false,
    requiredStaff: '1',
    notes: '',
    showInPrint: true,
    requiresPhotos: false,
    // AJ3-08: «Repetir este turno» apagado = alta de un solo turno, como siempre.
    repeat: false,
    weekdays: [],
    weeksMode: 'all',
    weeksOfMonth: [],
    repeatTo: '',
    worksOnHolidays: false,
  }

  const {
    control,
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ShiftFormValues>({
    resolver: zodResolver(shiftFormSchema),
    defaultValues,
  })

  const watchedClientId = watch('clientId')
  const watchedDate = watch('date')
  const watchedOpenEnded = watch('openEnded') ?? false
  const watchedRequiredStaff = watch('requiredStaff')
  const watchedRepeat = watch('repeat') ?? false
  const watchedWeekdays = watch('weekdays') ?? []
  const watchedWeeksMode = watch('weeksMode') ?? 'all'
  const watchedWeeksOfMonth = watch('weeksOfMonth') ?? []
  const watchedRepeatTo = watch('repeatTo') ?? ''
  const watchedWorksOnHolidays = watch('worksOnHolidays') ?? false
  // Mientras no toquen los días, siguen al día de la semana de la fecha.
  const [weekdaysTouched, setWeekdaysTouched] = useState(false)

  // Vista previa en vivo (AJ3-08): solo con la regla completa y dentro del
  // tope, y con debounce. Se debouncea la clave en texto, no el objeto (que
  // cambia de identidad en cada render).
  const liveRule = shiftFormValuesToSeriesRule({
    repeat: watchedRepeat,
    date: watchedDate,
    repeatTo: watchedRepeatTo,
    weekdays: watchedWeekdays,
    weeksMode: watchedWeeksMode,
    weeksOfMonth: watchedWeeksOfMonth,
    worksOnHolidays: watchedWorksOnHolidays,
  })
  const liveRuleKey = liveRule ? JSON.stringify(liveRule) : ''
  const debouncedRuleKey = useDebouncedValue(liveRuleKey, 400)
  const previewQuery = useShiftSeriesPreviewQuery(
    debouncedRuleKey ? (JSON.parse(debouncedRuleKey) as typeof liveRule) : null,
  )
  const previewPending =
    liveRuleKey !== '' &&
    (liveRuleKey !== debouncedRuleKey || previewQuery.isFetching)
  const previewText =
    liveRuleKey !== '' && !previewPending && previewQuery.data
      ? describeSeriesPreview(previewQuery.data)
      : null
  const noDatesMatch = watchedRepeat && previewText?.kind === 'none'
  const clientsQuery = useClientsQuery({})
  const sitesQuery = useClientSitesQuery(watchedClientId || undefined)

  // Tope = dotación pedida; si la dotación baja, se recorta lo elegido de más.
  const staffNumber = Number(watchedRequiredStaff)
  const staffLimit =
    Number.isInteger(staffNumber) && staffNumber >= 1 && staffNumber <= 10
      ? staffNumber
      : 10

  // P19.11d: la licencia bloquea. Quien está de licencia el día del turno no
  // se puede elegir (y si ya estaba elegido y la fecha cambió, se saca de la
  // selección y se avisa); con una repetición, quien tiene licencia en parte
  // del período se puede elegir, pero el servidor no lo asigna esas fechas.
  const leaveRangeEnd =
    watchedRepeat && watchedRepeatTo && watchedRepeatTo >= watchedDate
      ? watchedRepeatTo
      : watchedDate
  const leavesQuery = useLeavesInRangeQuery(
    watchedDate || undefined,
    leaveRangeEnd || undefined,
  )
  const blockedEmployeeIds = employeesOnLeaveIn(
    leavesQuery.data ?? [],
    watchedDate,
    watchedDate,
  )
  const partialLeaveEmployeeIds = new Set(
    [
      ...employeesOnLeaveIn(leavesQuery.data ?? [], watchedDate, leaveRangeEnd),
    ].filter((employeeId) => !blockedEmployeeIds.has(employeeId)),
  )
  const employeeIds = clampSelection(
    pickedEmployeeIds.filter(
      (employeeId) => !blockedEmployeeIds.has(employeeId),
    ),
    staffLimit,
  )
  const droppedForLeave = pickedEmployeeIds.filter((employeeId) =>
    blockedEmployeeIds.has(employeeId),
  )

  const holidayYear = watchedDate ? Number(watchedDate.slice(0, 4)) : undefined
  const holidaysQuery = useHolidaysQuery(
    holidayYear ?? new Date().getFullYear(),
  )
  const isHoliday =
    holidayYear != null &&
    (holidaysQuery.data ?? []).some(
      (holiday) => holiday.holidayDate === watchedDate && !holiday.deletedAt,
    )

  // P19.11d: al crear un turno no se ofrecen clientes ni sedes inactivos
  // (la base los rechaza con CLIENT_NOT_ACTIVE / SITE_NOT_ACTIVE).
  const clientOptions = newClientPickerOptions(clientsQuery.data ?? [])
  const siteOptions = newSitePickerOptions(sitesQuery.data ?? [])

  function handleClientChange(value: string) {
    setValue('clientId', value, { shouldValidate: true, shouldDirty: true })
    setValue('siteId', '', { shouldValidate: true, shouldDirty: true })
  }

  function handleDateChange(iso: string) {
    setValue('date', iso, { shouldValidate: true, shouldDirty: true })
    if (!weekdaysTouched) {
      setValue('weekdays', defaultWeekdayForDate(iso), { shouldDirty: true })
    }
  }

  function handleRepeatChange(checked: boolean) {
    setValue('repeat', checked, { shouldDirty: true })
    if (checked && !weekdaysTouched && watchedWeekdays.length === 0) {
      setValue('weekdays', defaultWeekdayForDate(watchedDate), {
        shouldDirty: true,
      })
    }
  }

  async function onSubmitSeries(values: ShiftFormValues) {
    const rule = shiftFormValuesToSeriesRule(values)
    if (!rule) {
      toast.error('Revisá los días y la fecha «hasta» de la repetición.')
      return
    }
    const { date: _date, ...single } = shiftFormValuesToCreateInput(values)
    try {
      const result = await createShiftSeries.mutateAsync({
        ...single,
        ...rule,
        employeeIds,
      })
      const names: Record<string, string> = Object.fromEntries(
        (employeeOptionsQuery.data ?? []).map((option) => [
          option.profileId,
          option.name,
        ]),
      )
      const issues = seriesIssuesByDate(result.created, names, WARNING_MESSAGES)
      const hasRejected = result.created.some(
        (item) => item.rejected.length > 0,
      )
      if (issues.length > 0) {
        // Los turnos se crearon todos: lo que no se pudo asignar queda a la
        // vista, fecha por fecha (no bloquea).
        toast.warning(seriesIssuesTitle(result.created.length, hasRejected), {
          duration: 30_000,
          description: (
            <ul className="list-disc pl-4">
              {issues.map((issue) => (
                <li key={issue.date}>
                  {formatDateOnly(issue.date)}: {issue.lines.join(' · ')}
                </li>
              ))}
            </ul>
          ),
        })
      } else {
        toast.success(
          seriesSuccessMessage(
            result.created.length,
            result.holidaysSkipped.length,
          ),
        )
      }
      // Se vuelve a Planificación, en la lista del día del primer turno creado.
      leaveForm(
        `/admin/planificacion?vista=dia&fecha=${result.created[0]?.shiftDate ?? rule.from}`,
        'create',
      )
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos crear los turnos.',
      )
    }
  }

  async function onSubmit(values: ShiftFormValues) {
    if (values.repeat) {
      await onSubmitSeries(values)
      return
    }
    const input = {
      ...shiftFormValuesToCreateInput(values),
      employeeIds,
    }
    try {
      const result = await createShift.mutateAsync(input)
      const names: Record<string, string> = Object.fromEntries(
        (employeeOptionsQuery.data ?? []).map((option) => [
          option.profileId,
          option.name,
        ]),
      )
      const warningLines = assignedWarningLines(
        result.assigned,
        names,
        WARNING_MESSAGES,
      )
      if (result.rejected.length > 0 || warningLines.length > 0) {
        // El turno se creó siempre: lo que no se pudo asignar o salió con
        // advertencias queda a la vista unos segundos (no bloquea).
        toast.warning(
          result.rejected.length > 0
            ? rejectedTitle(result.rejected.length)
            : 'Creamos el turno y asignamos, con advertencias:',
          {
            duration: 20_000,
            description: (
              <ul className="list-disc pl-4">
                {rejectedLines(result.rejected).map((line) => (
                  <li key={line}>{line}</li>
                ))}
                {warningLines.map((line) => (
                  <li key={line.employeeId}>
                    {line.employeeName}: {line.messages.join(' ')}
                  </li>
                ))}
              </ul>
            ),
          },
        )
      } else if (result.warnings.includes('HOLIDAY')) {
        toast.warning('Creamos el turno. Ojo: la fecha elegida es feriado.')
      } else {
        toast.success(
          result.assigned.length > 0
            ? 'Creamos el turno y asignamos a los empleados.'
            : 'Creamos el turno.',
        )
      }
      leaveForm(`/admin/planificacion?vista=dia&fecha=${input.date}`, 'create')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos crear el turno.',
      )
    }
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No tenés permiso para crear turnos"
        description="Pedile a la dueña o a un administrador que lo haga."
      />
    )
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex max-w-2xl flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.clientId) || undefined}>
          <FieldLabel>Cliente</FieldLabel>
          <Combobox
            aria-label="Cliente"
            options={clientOptions}
            value={watchedClientId}
            onValueChange={handleClientChange}
            placeholder="Elegí un cliente"
            searchPlaceholder="Buscar cliente…"
          />
          {errors.clientId && (
            <FieldError>{errors.clientId.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.siteId) || undefined}>
          <FieldLabel>Sede</FieldLabel>
          <Controller
            control={control}
            name="siteId"
            render={({ field }) => (
              <Combobox
                aria-label="Sede"
                options={siteOptions}
                value={field.value}
                onValueChange={field.onChange}
                placeholder={
                  watchedClientId
                    ? 'Elegí una sede'
                    : 'Elegí primero un cliente'
                }
                searchPlaceholder="Buscar sede…"
              />
            )}
          />
          {errors.siteId && <FieldError>{errors.siteId.message}</FieldError>}
        </Field>

        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(errors.date) || undefined}
        >
          <FieldLabel htmlFor="shift-date">
            {watchedRepeat ? 'Desde' : 'Fecha'}
          </FieldLabel>
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <DatePicker
                aria-label={
                  watchedRepeat
                    ? 'Primera fecha de la repetición'
                    : 'Fecha del turno'
                }
                value={isoDateToDate(field.value)}
                onValueChange={(date) =>
                  handleDateChange(date ? localDateToIsoDate(date) : '')
                }
              />
            )}
          />
          {errors.date && <FieldError>{errors.date.message}</FieldError>}
          {isHoliday && !watchedRepeat && (
            <Alert variant="warn" className="mt-1">
              <TriangleAlert />
              <AlertDescription>
                Esta fecha es feriado. El turno se crea igual; es solo un aviso.
              </AlertDescription>
            </Alert>
          )}
        </Field>

        {/* AJ3-08: repetir el turno con la misma regla que los servicios. */}
        <div className="flex flex-col gap-4 sm:col-span-2">
          <label
            htmlFor="shift-repeat"
            className="flex items-center justify-between gap-3 text-[13px] font-medium text-text"
          >
            Repetir este turno
            <Switch
              id="shift-repeat"
              checked={watchedRepeat}
              onCheckedChange={handleRepeatChange}
            />
          </label>
          {watchedRepeat && (
            <div className="flex flex-col gap-4 rounded-md border border-border p-4">
              <RepeatFields
                idPrefix="shift"
                weekdays={watchedWeekdays}
                onWeekdaysChange={(next) => {
                  setWeekdaysTouched(true)
                  setValue('weekdays', next, {
                    shouldDirty: true,
                    shouldValidate: Boolean(errors.weekdays),
                  })
                }}
                weeksMode={watchedWeeksMode}
                onWeeksModeChange={(next) =>
                  setValue('weeksMode', next, { shouldDirty: true })
                }
                weeksOfMonth={watchedWeeksOfMonth}
                onWeeksOfMonthChange={(next) =>
                  setValue('weeksOfMonth', next, {
                    shouldDirty: true,
                    shouldValidate: Boolean(errors.weeksOfMonth),
                  })
                }
                weekdaysError={errors.weekdays?.message}
                weeksOfMonthError={errors.weeksOfMonth?.message}
              />

              <Field data-invalid={Boolean(errors.repeatTo) || undefined}>
                <FieldLabel htmlFor="shift-repeat-to">Hasta</FieldLabel>
                <Controller
                  control={control}
                  name="repeatTo"
                  render={({ field }) => (
                    <DatePicker
                      aria-label="Repetir hasta"
                      disabled={!watchedDate}
                      minDate={isoDateToDate(watchedDate)}
                      maxDate={
                        watchedDate
                          ? isoDateToDate(maxSeriesDate(watchedDate))
                          : undefined
                      }
                      value={isoDateToDate(field.value)}
                      onValueChange={(date) =>
                        field.onChange(date ? localDateToIsoDate(date) : '')
                      }
                    />
                  )}
                />
                <p className="text-[11px] text-text-3">
                  {watchedDate
                    ? 'Como máximo 3 meses después de la fecha «Desde».'
                    : 'Elegí primero la fecha «Desde».'}
                </p>
                {errors.repeatTo && (
                  <FieldError>{errors.repeatTo.message}</FieldError>
                )}
              </Field>

              <label
                htmlFor="shift-works-on-holidays"
                className="flex items-center justify-between gap-3 text-[13px] font-medium text-text"
              >
                Crear también en feriados
                <Switch
                  id="shift-works-on-holidays"
                  checked={watchedWorksOnHolidays}
                  onCheckedChange={(checked) =>
                    setValue('worksOnHolidays', checked, { shouldDirty: true })
                  }
                />
              </label>

              <div aria-live="polite" className="text-[13px]">
                {liveRuleKey === '' && (
                  <p className="text-text-3">
                    Completá los días y la fecha «hasta» para ver cuántos turnos
                    se crean.
                  </p>
                )}
                {previewPending && (
                  <p className="text-text-3">Calculando las fechas…</p>
                )}
                {!previewPending &&
                  previewQuery.isError &&
                  liveRuleKey !== '' && (
                    <Alert variant="crit">
                      <TriangleAlert />
                      <AlertDescription>
                        {isApiError(previewQuery.error)
                          ? previewQuery.error.message
                          : 'No pudimos calcular las fechas.'}
                      </AlertDescription>
                    </Alert>
                  )}
                {previewText && (
                  <Alert
                    variant={previewText.kind === 'none' ? 'warn' : 'info'}
                  >
                    <AlertDescription>
                      <p className="font-medium">{previewText.headline}</p>
                      {previewText.datesLine && <p>{previewText.datesLine}</p>}
                      {previewText.holidaysLine && (
                        <p>{previewText.holidaysLine}</p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:col-span-2">
          <Field data-invalid={Boolean(errors.startTime) || undefined}>
            <FieldLabel htmlFor="shift-start-time">Desde</FieldLabel>
            <Input
              id="shift-start-time"
              type="time"
              aria-invalid={Boolean(errors.startTime)}
              {...register('startTime')}
            />
            {errors.startTime && (
              <FieldError>{errors.startTime.message}</FieldError>
            )}
          </Field>
          {watchedOpenEnded ? (
            <Field>
              <FieldLabel>Hasta</FieldLabel>
              <p className="flex h-9 items-center text-[13px] text-text-2">
                {OPEN_ENDED_LABEL}
              </p>
            </Field>
          ) : (
            <Field data-invalid={Boolean(errors.endTime) || undefined}>
              <FieldLabel htmlFor="shift-end-time">Hasta</FieldLabel>
              <Input
                id="shift-end-time"
                type="time"
                aria-invalid={Boolean(errors.endTime)}
                {...register('endTime')}
              />
              {errors.endTime && (
                <FieldError>{errors.endTime.message}</FieldError>
              )}
            </Field>
          )}
          <div className="col-span-2">
            <Controller
              control={control}
              name="openEnded"
              render={({ field }) => (
                <OpenEndedToggle
                  id="shift-open-ended"
                  checked={field.value ?? false}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>
        </div>

        <Field data-invalid={Boolean(errors.requiredStaff) || undefined}>
          <FieldLabel htmlFor="shift-required-staff">Dotación</FieldLabel>
          <Input
            id="shift-required-staff"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            aria-invalid={Boolean(errors.requiredStaff)}
            {...register('requiredStaff')}
          />
          {errors.requiredStaff && (
            <FieldError>{errors.requiredStaff.message}</FieldError>
          )}
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel>Empleados (opcional)</FieldLabel>
          <EmployeeMultiPicker
            aria-label="Empleados del turno"
            options={employeeOptionsQuery.data ?? []}
            loading={employeeOptionsQuery.isLoading}
            value={employeeIds}
            onValueChange={setPickedEmployeeIds}
            blockedIds={blockedEmployeeIds}
            partialLeaveIds={partialLeaveEmployeeIds}
            max={staffLimit}
            placeholder="Elegí quién va a este turno"
          />
          {droppedForLeave.length > 0 && (
            <Alert variant="warn">
              <AlertDescription>
                {`Sacamos de la selección a ${droppedForLeave
                  .map(
                    (employeeId) =>
                      (employeeOptionsQuery.data ?? []).find(
                        (option) => option.profileId === employeeId,
                      )?.name ?? 'un empleado',
                  )
                  .join(', ')} porque está de licencia el día elegido.`}
              </AlertDescription>
            </Alert>
          )}
          <p className="text-[11px] text-text-3">
            Quien está de licencia ese día no se puede elegir.{' '}
            {watchedRepeat
              ? 'Quedan asignados en cada turno de la repetición, hasta completar la dotación. Si alguno no se puede asignar en una fecha, el turno se crea igual y te avisamos.'
              : 'Quedan asignados al crear el turno, hasta completar la dotación. Si alguno no se puede asignar, el turno se crea igual y te avisamos.'}
          </p>
        </Field>

        <Controller
          control={control}
          name="requiresPhotos"
          render={({ field }) => (
            <RequiresPhotosToggle
              id="shift-requires-photos"
              className="sm:col-span-2"
              checked={field.value ?? false}
              onCheckedChange={field.onChange}
            />
          )}
        />

        <Controller
          control={control}
          name="showInPrint"
          render={({ field }) => (
            <ShiftObservationField
              id="shift-new"
              className="sm:col-span-2"
              textareaProps={register('notes')}
              showInPrint={field.value ?? true}
              onShowInPrintChange={field.onChange}
            />
          )}
        />
      </div>

      <div className="flex gap-2">
        <Button
          type="submit"
          loading={createShift.isPending || createShiftSeries.isPending}
          disabled={noDatesMatch}
        >
          {watchedRepeat ? 'Crear turnos' : 'Crear turno'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void navigate(-1)}
          disabled={createShift.isPending || createShiftSeries.isPending}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}

function EditShiftTimeForm({
  id,
  navigate,
  canManage,
}: {
  id: string
  navigate: ReturnType<typeof useNavigate>
  canManage: boolean
}) {
  const leaveForm = useLeaveForm()
  const shiftQuery = useShiftForEditQuery(id)
  const updateShiftTime = useUpdateShiftTimeMutation(
    shiftQuery.data?.shiftDate ?? '',
  )
  const updateShiftDetails = useUpdateShiftDetailsMutation()
  const dateWarnings = useShiftDateWarningsMutation()
  const isSaving = updateShiftTime.isPending || updateShiftDetails.isPending
  // P19.11d: advertencias del cambio de fecha pendientes de confirmar.
  const [pendingDateSave, setPendingDateSave] = useState<{
    values: ShiftEditFormValues
    lines: string[]
  } | null>(null)

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ShiftEditFormValues>({
    resolver: zodResolver(shiftEditFormSchema),
    values: shiftQuery.data
      ? {
          startTime: shiftQuery.data.startTime.slice(0, 5),
          endTime: shiftQuery.data.openEnded
            ? ''
            : shiftQuery.data.endTime.slice(0, 5),
          openEnded: shiftQuery.data.openEnded,
          requiredStaff: String(shiftQuery.data.requiredStaff),
          notes: shiftQuery.data.notes ?? '',
          showInPrint: shiftQuery.data.showInPrint ?? true,
          requiresPhotos: shiftQuery.data.requiresPhotos,
          date: shiftQuery.data.shiftDate,
        }
      : undefined,
  })

  const watchedOpenEnded = useWatch({ control, name: 'openEnded' }) ?? false
  const watchedDate = useWatch({ control, name: 'date' })

  // Franja (`update_shift_time`) y dotación/notas (`update_shift_details`)
  // son dos RPC separadas (`06` sección 7, ASSIGN-013): un solo formulario
  // las llama a las dos, así la persona no tiene que guardar dos veces.
  async function onSubmit(values: ShiftEditFormValues) {
    const shift = shiftQuery.data
    const dateChanged =
      shift != null &&
      canEditShiftDate(shift.status) &&
      Boolean(values.date) &&
      values.date !== shift.shiftDate
    if (dateChanged) {
      // Antes de confirmar: feriado y disponibilidad de los asignados.
      const inputs = shiftEditFormValuesToInputs(values)
      try {
        const warnings = await dateWarnings.mutateAsync({
          shiftId: id,
          date: values.date as string,
          start: inputs.time.start,
          end: inputs.time.end,
        })
        const lines = dateWarningLines(warnings)
        if (lines.length > 0) {
          setPendingDateSave({ values, lines })
          return
        }
      } catch (error) {
        toast.error(
          shiftDateErrorMessage(
            error,
            'No pudimos revisar la fecha nueva. Probá de nuevo.',
          ),
        )
        return
      }
    }
    await save(values)
  }

  async function save(values: ShiftEditFormValues) {
    const inputs = shiftEditFormValuesToInputs(values)
    const shift = shiftQuery.data
    // Solo se manda la fecha si cambió y el turno todavía la admite.
    const newDate =
      shift != null &&
      canEditShiftDate(shift.status) &&
      inputs.time.date &&
      inputs.time.date !== shift.shiftDate
        ? inputs.time.date
        : undefined
    try {
      // Un turno «A terminar» finalizado solo admite ponerle la hora de fin
      // (AJ2-10): ni la dotación ni las notas se tocan.
      const onlyEndTime =
        shiftQuery.data?.status === 'completed' && shiftQuery.data.openEnded
      await Promise.all([
        updateShiftTime.mutateAsync({
          shiftId: id,
          start: inputs.time.start,
          end: inputs.time.end,
          openEnded: inputs.time.openEnded,
          date: newDate,
        }),
        ...(onlyEndTime
          ? []
          : [
              updateShiftDetails.mutateAsync({
                shiftId: id,
                requiredStaff: inputs.details.requiredStaff,
                notes: inputs.details.notes,
                showInPrint: inputs.details.showInPrint,
                requiresPhotos: inputs.details.requiresPhotos,
              }),
            ]),
      ])
      setPendingDateSave(null)
      toast.success(
        newDate
          ? `Movimos el turno al ${formatDateOnly(newDate)}.`
          : 'Actualizamos el turno.',
      )
      // Si cambió la fecha, se lleva al usuario al día nuevo del calendario.
      leaveForm(
        `/admin/planificacion?vista=dia&fecha=${newDate ?? shiftQuery.data?.shiftDate ?? ''}`,
        'edit',
      )
    } catch (error) {
      setPendingDateSave(null)
      toast.error(
        shiftDateErrorMessage(error, 'No pudimos actualizar el turno.'),
      )
    }
  }

  if (shiftQuery.isLoading) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  if (!shiftQuery.data) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No encontramos este turno"
        description="Puede que se haya movido o que el enlace esté roto."
      />
    )
  }

  const shift = shiftQuery.data
  // AJ2-10: un turno «A terminar» finalizado todavía admite la hora de fin.
  const isCompletedOpenEnded = shift.status === 'completed' && shift.openEnded
  const isCancelledOrCompleted =
    shift.status === 'cancelled' ||
    (shift.status === 'completed' && !isCompletedOpenEnded)
  const isInProgress = shift.status === 'in_progress'

  if (!canManage) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No tenés permiso para editar turnos"
        description="Pedile a la dueña o a un administrador que lo haga."
      />
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-[14px] font-semibold text-text">
            {shift.clientName} · {shift.siteName}
          </h2>
          <StatusBadge domain="shift" status={shift.status} />
        </div>
        <p className="text-[12.5px] text-text-3">
          Cliente y sede no se pueden editar desde acá: sí la fecha (si el turno
          todavía no empezó), el horario, la dotación y las notas.
        </p>
      </div>

      {isCancelledOrCompleted ? (
        <Alert variant="warn">
          <TriangleAlert />
          <AlertDescription>
            Este turno está{' '}
            {shift.status === 'cancelled' ? 'cancelado' : 'finalizado'}: ya no
            admite cambios.
          </AlertDescription>
        </Alert>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          {isInProgress && (
            <Alert variant="info">
              <AlertDescription>
                Este turno ya está en curso: solo se puede cambiar la hora de
                fin.
              </AlertDescription>
            </Alert>
          )}
          {isCompletedOpenEnded && (
            <Alert variant="info">
              <AlertDescription>
                Este turno «A terminar» ya finalizó. Podés ponerle la hora de
                fin: las horas de cada empleado se recalculan contando solo lo
                que cae dentro de esa franja.
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-5">
            <Field className="col-span-2">
              <FieldLabel>Fecha del turno</FieldLabel>
              {canEditShiftDate(shift.status) ? (
                <>
                  <Controller
                    control={control}
                    name="date"
                    render={({ field }) => (
                      <DatePicker
                        aria-label="Fecha del turno"
                        value={isoDateToDate(field.value)}
                        minDate={isoDateToDate(todayInBuenosAires())}
                        onValueChange={(date) =>
                          field.onChange(date ? localDateToIsoDate(date) : '')
                        }
                      />
                    )}
                  />
                  <p className="text-[11.5px] text-text-3">
                    {DATE_CHANGE_NOTICE}
                  </p>
                  {watchedDate && watchedDate !== shift.shiftDate && (
                    <p className="text-[11.5px] font-semibold text-warning-800">
                      El turno pasa del {formatDateOnly(shift.shiftDate)} al{' '}
                      {formatDateOnly(watchedDate)}.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-text-2">
                  <span className="capitalize">
                    {formatDateOnly(shift.shiftDate)}
                  </span>{' '}
                  · El turno ya empezó o terminó: la fecha no se puede cambiar.
                </p>
              )}
            </Field>
            <Field data-invalid={Boolean(errors.startTime) || undefined}>
              <FieldLabel htmlFor="shift-start-time">Desde</FieldLabel>
              <Input
                id="shift-start-time"
                type="time"
                disabled={isInProgress || isCompletedOpenEnded}
                aria-invalid={Boolean(errors.startTime)}
                {...register('startTime')}
              />
              {errors.startTime && (
                <FieldError>{errors.startTime.message}</FieldError>
              )}
            </Field>
            {watchedOpenEnded ? (
              <Field>
                <FieldLabel>Hasta</FieldLabel>
                <p className="flex h-9 items-center text-[13px] text-text-2">
                  {OPEN_ENDED_LABEL}
                </p>
              </Field>
            ) : (
              <Field data-invalid={Boolean(errors.endTime) || undefined}>
                <FieldLabel htmlFor="shift-end-time">Hasta</FieldLabel>
                <Input
                  id="shift-end-time"
                  type="time"
                  aria-invalid={Boolean(errors.endTime)}
                  {...register('endTime')}
                />
                {errors.endTime && (
                  <FieldError>{errors.endTime.message}</FieldError>
                )}
              </Field>
            )}
            <div className="col-span-2">
              <Controller
                control={control}
                name="openEnded"
                render={({ field }) => (
                  <OpenEndedToggle
                    id="shift-open-ended"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
            {!isCompletedOpenEnded && (
              <>
                <Field
                  data-invalid={Boolean(errors.requiredStaff) || undefined}
                >
                  <FieldLabel htmlFor="shift-required-staff">
                    Dotación
                  </FieldLabel>
                  <Input
                    id="shift-required-staff"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={10}
                    aria-invalid={Boolean(errors.requiredStaff)}
                    {...register('requiredStaff')}
                  />
                  {errors.requiredStaff && (
                    <FieldError>{errors.requiredStaff.message}</FieldError>
                  )}
                </Field>
                <Controller
                  control={control}
                  name="requiresPhotos"
                  render={({ field }) => (
                    <RequiresPhotosToggle
                      id="shift-requires-photos"
                      className="col-span-2"
                      checked={field.value ?? false}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="showInPrint"
                  render={({ field }) => (
                    <ShiftObservationField
                      id="shift-edit"
                      className="sm:col-span-2"
                      textareaProps={register('notes')}
                      showInPrint={field.value ?? true}
                      onShowInPrintChange={field.onChange}
                    />
                  )}
                />
              </>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="submit" loading={isSaving}>
              Guardar cambios
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void navigate(-1)}
              disabled={isSaving}
            >
              Volver
            </Button>
          </div>
        </form>
      )}

      <SimpleConfirmDialog
        open={pendingDateSave != null}
        onOpenChange={(open) => {
          if (!open) setPendingDateSave(null)
        }}
        title="Confirmar el cambio de fecha"
        description={`Vas a mover el turno al ${
          pendingDateSave?.values.date
            ? formatDateOnly(pendingDateSave.values.date)
            : ''
        }. Revisá estos avisos: no impiden el cambio.`}
        confirmLabel="Mover igual"
        cancelLabel="Volver"
        isLoading={isSaving}
        onConfirm={() => {
          if (pendingDateSave) void save(pendingDateSave.values)
        }}
      >
        <ul className="list-disc pl-5 text-[13px] text-text-2">
          {pendingDateSave?.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>{DATE_CHANGE_NOTICE}</li>
        </ul>
      </SimpleConfirmDialog>
    </div>
  )
}
