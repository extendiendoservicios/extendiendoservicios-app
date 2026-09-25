import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { CalendarClock, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { Combobox } from '@/components/Combobox'
import { DatePicker } from '@/components/DatePicker'
import { StatusBadge } from '@/components/status'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useClientsQuery,
  useClientSitesQuery,
} from '@/features/clients/queries'
import { useHolidaysQuery } from '@/features/settings/queries'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { canManageShiftTime } from '@/features/shifts/permissions'
import {
  useCreateShiftMutation,
  useShiftForEditQuery,
  useUpdateShiftTimeMutation,
} from '@/features/shifts/queries'
import {
  shiftEditFormSchema,
  shiftEditFormValuesToInputs,
  shiftFormSchema,
  shiftFormValuesToCreateInput,
  type ShiftEditFormValues,
  type ShiftFormValues,
} from '@/features/shifts/schemas'
import { useUpdateShiftDetailsMutation } from '@/features/planning/queries'

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
  const createShift = useCreateShiftMutation()

  const defaultValues: ShiftFormValues = {
    clientId: '',
    siteId: '',
    date: dateFromQuery ?? '',
    startTime: '',
    endTime: '',
    requiredStaff: '1',
    notes: '',
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
  const clientsQuery = useClientsQuery({})
  const sitesQuery = useClientSitesQuery(watchedClientId || undefined)

  const holidayYear = watchedDate ? Number(watchedDate.slice(0, 4)) : undefined
  const holidaysQuery = useHolidaysQuery(
    holidayYear ?? new Date().getFullYear(),
  )
  const isHoliday =
    holidayYear != null &&
    (holidaysQuery.data ?? []).some(
      (holiday) => holiday.holidayDate === watchedDate && !holiday.deletedAt,
    )

  const clientOptions = (clientsQuery.data ?? []).map((client) => ({
    value: client.id,
    label:
      (client.tradeName ?? client.legalName) +
      (client.status !== 'active'
        ? ` (${client.status === 'suspended' ? 'suspendido' : 'baja'})`
        : ''),
  }))
  const siteOptions = (sitesQuery.data ?? []).map((site) => ({
    value: site.id,
    label: site.name + (site.status !== 'active' ? ' (inactiva)' : ''),
  }))

  function handleClientChange(value: string) {
    setValue('clientId', value, { shouldValidate: true, shouldDirty: true })
    setValue('siteId', '', { shouldValidate: true, shouldDirty: true })
  }

  async function onSubmit(values: ShiftFormValues) {
    const input = shiftFormValuesToCreateInput(values)
    try {
      const result = await createShift.mutateAsync(input)
      if (result.warnings.includes('HOLIDAY')) {
        toast.warning('Creamos el turno. Ojo: la fecha elegida es feriado.')
      } else {
        toast.success('Creamos el turno.')
      }
      void navigate(`/admin/planificacion?vista=dia&fecha=${input.date}`)
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
          <FieldLabel htmlFor="shift-date">Fecha</FieldLabel>
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <DatePicker
                aria-label="Fecha del turno"
                value={isoDateToDate(field.value)}
                onValueChange={(date) =>
                  field.onChange(date ? localDateToIsoDate(date) : '')
                }
              />
            )}
          />
          {errors.date && <FieldError>{errors.date.message}</FieldError>}
          {isHoliday && (
            <Alert variant="warn" className="mt-1">
              <TriangleAlert />
              <AlertDescription>
                Esta fecha es feriado. El turno se crea igual; es solo un aviso.
              </AlertDescription>
            </Alert>
          )}
        </Field>

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
          <FieldLabel htmlFor="shift-notes">Notas</FieldLabel>
          <Textarea id="shift-notes" rows={3} {...register('notes')} />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit" loading={createShift.isPending}>
          Crear turno
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void navigate(-1)}
          disabled={createShift.isPending}
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
  const shiftQuery = useShiftForEditQuery(id)
  const updateShiftTime = useUpdateShiftTimeMutation(
    shiftQuery.data?.shiftDate ?? '',
  )
  const updateShiftDetails = useUpdateShiftDetailsMutation()
  const isSaving = updateShiftTime.isPending || updateShiftDetails.isPending

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ShiftEditFormValues>({
    resolver: zodResolver(shiftEditFormSchema),
    values: shiftQuery.data
      ? {
          startTime: shiftQuery.data.startTime.slice(0, 5),
          endTime: shiftQuery.data.endTime.slice(0, 5),
          requiredStaff: String(shiftQuery.data.requiredStaff),
          notes: shiftQuery.data.notes ?? '',
        }
      : undefined,
  })

  // Franja (`update_shift_time`) y dotación/notas (`update_shift_details`)
  // son dos RPC separadas (`06` sección 7, ASSIGN-013): un solo formulario
  // las llama a las dos, así la persona no tiene que guardar dos veces.
  async function onSubmit(values: ShiftEditFormValues) {
    const inputs = shiftEditFormValuesToInputs(values)
    try {
      await Promise.all([
        updateShiftTime.mutateAsync({
          shiftId: id,
          start: inputs.time.start,
          end: inputs.time.end,
        }),
        updateShiftDetails.mutateAsync({
          shiftId: id,
          requiredStaff: inputs.details.requiredStaff,
          notes: inputs.details.notes,
        }),
      ])
      toast.success('Actualizamos el turno.')
      void navigate(
        `/admin/planificacion?vista=dia&fecha=${shiftQuery.data?.shiftDate ?? ''}`,
      )
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos actualizar el turno.',
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
  const isCancelledOrCompleted =
    shift.status === 'cancelled' || shift.status === 'completed'
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
          Cliente, sede y fecha no se pueden editar desde acá: solo el horario,
          la dotación y las notas del turno.
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
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-5">
            <Field data-invalid={Boolean(errors.startTime) || undefined}>
              <FieldLabel htmlFor="shift-start-time">Desde</FieldLabel>
              <Input
                id="shift-start-time"
                type="time"
                disabled={isInProgress}
                aria-invalid={Boolean(errors.startTime)}
                {...register('startTime')}
              />
              {errors.startTime && (
                <FieldError>{errors.startTime.message}</FieldError>
              )}
            </Field>
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
              <FieldLabel htmlFor="shift-notes">Notas</FieldLabel>
              <Textarea id="shift-notes" rows={3} {...register('notes')} />
            </Field>
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
    </div>
  )
}
