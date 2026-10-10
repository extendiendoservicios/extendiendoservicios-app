import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { CalendarClock } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { OpenEndedToggle } from '@/features/shifts/components/OpenEndedToggle'
import { OPEN_ENDED_LABEL } from '@/features/shifts/openEnded'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { Combobox } from '@/components/Combobox'
import { DatePicker } from '@/components/DatePicker'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useClientsQuery,
  useClientSitesQuery,
} from '@/features/clients/queries'
import { useSiteDetailQuery } from '@/features/sites/queries'
import { useActiveEmployeeOptionsQuery } from '@/features/employees/queries'
import { EmployeeMultiPicker } from '@/features/planning/components/EmployeeMultiPicker'
import { fixedEmployeesError } from '@/features/shifts/assignOnCreate'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import {
  useCreateServiceMutation,
  useServiceDetailQuery,
  useServiceFixedEmployeesQuery,
  useSetServiceFixedEmployeesMutation,
  useUpdateServiceMutation,
} from '@/features/services/queries'
import {
  SERVICE_STATUS_OPTIONS,
  WEEKDAY_OPTIONS,
  serviceFormSchema,
  serviceFormValuesToInput,
  type ServiceFormValues,
} from '@/features/services/schemas'

/** `"YYYY-MM-DD"` (columna `date` de Postgres, o cadena vacía) → `Date` para `DatePicker`. */
function isoDateToDate(isoDate: string | undefined): Date | undefined {
  return isoDate ? new Date(`${isoDate}T00:00:00`) : undefined
}

/** Misma lista de ids sin importar el orden. */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}

/**
 * ADM-25 "Servicio · formulario" (SERVICE-002, `05` línea 79): alta
 * (`/admin/servicios/nuevo`) y edición (`/admin/servicios/:id/editar`) en
 * una sola pantalla, mismo criterio que `ClientFormPage`/`SiteFormPage` — el
 * modo lo decide `useParams().id`.
 *
 * A diferencia de `SiteFormPage` (donde el cliente es solo contexto, nunca
 * un campo del formulario), `05` línea 79 lista "Cliente y sede" entre los
 * campos de ADM-25: acá son dos `Combobox` editables, no un dato fijo. El
 * contexto de origen (`?sede=` desde ADM-22, documentado en `05` sección 5;
 * `?cliente=` desde ADM-21, extensión propia -- ver el reporte del
 * encargo) solo los precarga, el administrador los puede cambiar.
 */
export default function ServiceFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEditMode = id != null
  const [searchParams] = useSearchParams()
  const siteIdFromQuery = !isEditMode ? searchParams.get('sede') : null
  const clientIdFromQuery = !isEditMode ? searchParams.get('cliente') : null
  const navigate = useNavigate()
  const auth = useAuth()

  const serviceQuery = useServiceDetailQuery(id)
  const presetSiteQuery = useSiteDetailQuery(siteIdFromQuery ?? undefined)

  const createService = useCreateServiceMutation()
  const updateService = useUpdateServiceMutation(
    serviceQuery.data?.clientId ?? '',
    serviceQuery.data?.siteId ?? '',
  )
  const setFixedEmployees = useSetServiceFixedEmployeesMutation()
  const isSaving =
    createService.isPending ||
    updateService.isPending ||
    setFixedEmployees.isPending

  // AJ2-17: empleados fijos. `fixedDraft` en null = sin tocar (en edición se
  // usa lo guardado); la lista se guarda con su propia RPC después del servicio.
  const employeeOptionsQuery = useActiveEmployeeOptionsQuery()
  const fixedQuery = useServiceFixedEmployeesQuery(id)
  const [fixedDraft, setFixedDraft] = useState<string[] | null>(null)
  const savedFixedIds = fixedQuery.data
  const fixedIds = fixedDraft ?? savedFixedIds ?? []
  const fixedChanged =
    fixedDraft !== null && !sameIds(fixedDraft, savedFixedIds ?? [])

  const defaultValues: ServiceFormValues = {
    clientId: clientIdFromQuery ?? '',
    siteId: '',
    name: '',
    weekdays: [],
    startTime: '',
    endTime: '',
    openEnded: false,
    requiredStaff: '1',
    validFrom: '',
    validTo: '',
    // Decisión de Mike (P10.0, 25 sep 2026): "Trabaja los feriados" viene
    // marcado por defecto; se puede desmarcar por servicio.
    worksOnHolidays: true,
    minHoursMonth: '',
    maxHoursMonth: '',
    status: 'active',
    notes: '',
  }

  const {
    control,
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues,
    values: isEditMode
      ? serviceQuery.data
        ? {
            clientId: serviceQuery.data.clientId,
            siteId: serviceQuery.data.siteId,
            name: serviceQuery.data.name,
            weekdays: serviceQuery.data.weekdays.map(String),
            startTime: serviceQuery.data.startTime.slice(0, 5),
            endTime: serviceQuery.data.openEnded
              ? ''
              : serviceQuery.data.endTime.slice(0, 5),
            openEnded: serviceQuery.data.openEnded,
            requiredStaff: String(serviceQuery.data.requiredStaff),
            validFrom: serviceQuery.data.validFrom,
            validTo: serviceQuery.data.validTo ?? '',
            worksOnHolidays: serviceQuery.data.worksOnHolidays,
            minHoursMonth: serviceQuery.data.minHoursMonth?.toString() ?? '',
            maxHoursMonth: serviceQuery.data.maxHoursMonth?.toString() ?? '',
            status: serviceQuery.data.status,
            notes: serviceQuery.data.notes ?? '',
          }
        : undefined
      : siteIdFromQuery && presetSiteQuery.data
        ? {
            ...defaultValues,
            clientId: presetSiteQuery.data.clientId,
            siteId: presetSiteQuery.data.id,
          }
        : undefined,
  })

  const watchedClientId = watch('clientId')
  const watchedOpenEnded = watch('openEnded') ?? false
  const watchedRequiredStaff = Number(watch('requiredStaff'))
  const fixedLimit =
    Number.isInteger(watchedRequiredStaff) &&
    watchedRequiredStaff >= 1 &&
    watchedRequiredStaff <= 10
      ? watchedRequiredStaff
      : 10
  const fixedError = fixedEmployeesError(fixedIds.length, fixedLimit)
  const clientsQuery = useClientsQuery({})
  const sitesQuery = useClientSitesQuery(watchedClientId || undefined)

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

  function toggleWeekday(
    current: string[],
    value: string,
    onChange: (next: string[]) => void,
  ) {
    onChange(
      current.includes(value)
        ? current.filter((day) => day !== value)
        : [...current, value],
    )
  }

  async function onSubmit(values: ServiceFormValues) {
    const input = serviceFormValuesToInput(values)
    if (fixedEmployeesError(fixedIds.length, input.requiredStaff)) {
      // Se ve debajo del selector; el servidor igual lo vuelve a verificar.
      toast.error('Revisá los empleados fijos: son más que la dotación.')
      return
    }
    // En edición solo se llama a la RPC si la lista cambió; sin lista cargada
    // (falló la lectura) no se toca, para no pisar nada.
    const mustSaveFixed = isEditMode
      ? fixedChanged && savedFixedIds !== undefined
      : fixedIds.length > 0
    let serviceSaved = false
    try {
      if (isEditMode) {
        // Si la dotación baja, primero se achica la lista de fijos (el
        // servidor no deja bajarla por debajo de los fijos); si sube, primero
        // el servicio, así entran más fijos.
        const lowersStaff =
          serviceQuery.data != null &&
          input.requiredStaff < serviceQuery.data.requiredStaff
        if (mustSaveFixed && lowersStaff) {
          await setFixedEmployees.mutateAsync({
            serviceId: id,
            employeeIds: fixedIds,
          })
        }
        const service = await updateService.mutateAsync({
          id,
          input,
          updatedBy: auth.userId as string,
        })
        serviceSaved = true
        if (mustSaveFixed && !lowersStaff) {
          await setFixedEmployees.mutateAsync({
            serviceId: id,
            employeeIds: fixedIds,
          })
        }
        toast.success('Guardamos los cambios del servicio.')
        void navigate(`/admin/clientes/${service.clientId}?pestana=servicios`)
      } else {
        const service = await createService.mutateAsync({
          input,
          createdBy: auth.userId as string,
        })
        serviceSaved = true
        if (mustSaveFixed) {
          try {
            await setFixedEmployees.mutateAsync({
              serviceId: service.id,
              employeeIds: fixedIds,
            })
          } catch (fixedFailure) {
            // El servicio ya existe: se sigue en su edición para reintentar.
            toast.warning(
              `Creamos el servicio, pero no se guardaron los empleados fijos: ${
                isApiError(fixedFailure)
                  ? fixedFailure.message
                  : 'ocurrió un error inesperado.'
              }`,
              { duration: 15_000 },
            )
            void navigate(`/admin/servicios/${service.id}/editar`)
            return
          }
        }
        toast.success('Creamos el servicio.')
        void navigate(`/admin/clientes/${service.clientId}?pestana=servicios`)
      }
    } catch (error) {
      const message = isApiError(error)
        ? error.message
        : 'No pudimos guardar el servicio.'
      toast.error(
        serviceSaved
          ? `Guardamos el servicio, pero no los empleados fijos: ${message}`
          : message,
      )
    }
  }

  // A la espera del detalle en modo edición: mismo esqueleto que `SiteFormPage`.
  if (isEditMode && serviceQuery.isLoading) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  if (isEditMode && !serviceQuery.isLoading && !serviceQuery.data) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No encontramos este servicio"
        description="Puede que se haya movido o que el enlace esté roto."
      />
    )
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex max-w-2xl flex-col gap-4"
    >
      {isEditMode && (
        <Alert>
          <AlertDescription>
            Los turnos ya generados no cambian. Si hace falta, generá el mes de
            nuevo para crear los que falten con los datos actualizados.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.clientId) || undefined}>
          {/* `Combobox` no expone un `id` propio (ver `src/components/Combobox.tsx`): el
              rótulo queda sin `htmlFor`, la accesibilidad la da el `aria-label` de abajo. */}
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
          data-invalid={Boolean(errors.name) || undefined}
        >
          <FieldLabel htmlFor="service-name">Nombre</FieldLabel>
          <Input
            id="service-name"
            placeholder="Limpieza mañana"
            aria-invalid={Boolean(errors.name)}
            {...register('name')}
          />
          {errors.name && <FieldError>{errors.name.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.status) || undefined}>
          <FieldLabel htmlFor="service-status">Estado</FieldLabel>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="service-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field data-invalid={Boolean(errors.requiredStaff) || undefined}>
          <FieldLabel htmlFor="service-required-staff">Dotación</FieldLabel>
          <Input
            id="service-required-staff"
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
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-[14px] font-semibold text-text">Empleados fijos</h2>
        <p className="text-[12.5px] text-text-3">
          Se asignan solos en cada turno que se genere. No cambia los turnos ya
          generados.
        </p>
        <EmployeeMultiPicker
          aria-label="Empleados fijos"
          options={employeeOptionsQuery.data ?? []}
          loading={
            employeeOptionsQuery.isLoading ||
            (isEditMode && fixedQuery.isLoading)
          }
          value={fixedIds}
          onValueChange={setFixedDraft}
          max={fixedLimit}
          placeholder="Elegí empleados fijos (opcional)"
        />
        {isEditMode && fixedQuery.isError && (
          <p className="text-[11px] text-danger">
            No pudimos leer los empleados fijos actuales. Si guardás, no se
            tocan.
          </p>
        )}
        {fixedError && <p className="text-[11px] text-danger">{fixedError}</p>}
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-[14px] font-semibold text-text">
          Días y franja horaria
        </h2>
        <Controller
          control={control}
          name="weekdays"
          render={({ field }) => (
            <div className="flex flex-wrap gap-3">
              {WEEKDAY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  htmlFor={`service-weekday-${option.value}`}
                  className="flex items-center gap-[6px] text-[13px] text-text"
                >
                  <Checkbox
                    id={`service-weekday-${option.value}`}
                    checked={field.value.includes(option.value)}
                    onCheckedChange={() =>
                      toggleWeekday(field.value, option.value, field.onChange)
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
          )}
        />
        {errors.weekdays && (
          <p className="text-[11px] text-danger">{errors.weekdays.message}</p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.startTime) || undefined}>
            <FieldLabel htmlFor="service-start-time">Desde</FieldLabel>
            <Input
              id="service-start-time"
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
              <FieldLabel htmlFor="service-end-time">Hasta</FieldLabel>
              <Input
                id="service-end-time"
                type="time"
                aria-invalid={Boolean(errors.endTime)}
                {...register('endTime')}
              />
              {errors.endTime && (
                <FieldError>{errors.endTime.message}</FieldError>
              )}
            </Field>
          )}
        </div>

        <Controller
          control={control}
          name="openEnded"
          render={({ field }) => (
            <OpenEndedToggle
              id="service-open-ended"
              checked={field.value ?? false}
              onCheckedChange={field.onChange}
              hint="Los turnos que se generen quedan «A terminar»: cada empleado cuenta las horas desde que ficha el inicio hasta que ficha la salida."
            />
          )}
        />

        <label
          htmlFor="service-works-on-holidays"
          className="flex items-center justify-between gap-3 text-[13px] font-medium text-text"
        >
          Trabaja los feriados
          <Controller
            control={control}
            name="worksOnHolidays"
            render={({ field }) => (
              <Switch
                id="service-works-on-holidays"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <h2 className="text-[14px] font-semibold text-text sm:col-span-2">
          Vigencia
        </h2>
        <Field data-invalid={Boolean(errors.validFrom) || undefined}>
          <FieldLabel htmlFor="service-valid-from">Desde</FieldLabel>
          <Controller
            control={control}
            name="validFrom"
            render={({ field }) => (
              <DatePicker
                aria-label="Vigente desde"
                value={isoDateToDate(field.value)}
                onValueChange={(date) =>
                  field.onChange(date ? localDateToIsoDate(date) : '')
                }
              />
            )}
          />
          {errors.validFrom && (
            <FieldError>{errors.validFrom.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.validTo) || undefined}>
          <FieldLabel htmlFor="service-valid-to">
            Hasta (opcional, sin fin si se deja vacío)
          </FieldLabel>
          <Controller
            control={control}
            name="validTo"
            render={({ field }) => (
              <DatePicker
                aria-label="Vigente hasta"
                value={isoDateToDate(field.value)}
                onValueChange={(date) =>
                  field.onChange(date ? localDateToIsoDate(date) : '')
                }
              />
            )}
          />
          {errors.validTo && <FieldError>{errors.validTo.message}</FieldError>}
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <h2 className="text-[14px] font-semibold text-text sm:col-span-2">
          Horas mensuales (informativas)
        </h2>
        <Field data-invalid={Boolean(errors.minHoursMonth) || undefined}>
          <FieldLabel htmlFor="service-min-hours">Mínimas</FieldLabel>
          <Input
            id="service-min-hours"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.5"
            {...register('minHoursMonth')}
          />
          {errors.minHoursMonth && (
            <FieldError>{errors.minHoursMonth.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.maxHoursMonth) || undefined}>
          <FieldLabel htmlFor="service-max-hours">Máximas</FieldLabel>
          <Input
            id="service-max-hours"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.5"
            {...register('maxHoursMonth')}
          />
          {errors.maxHoursMonth && (
            <FieldError>{errors.maxHoursMonth.message}</FieldError>
          )}
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="service-notes">Notas</FieldLabel>
          <Textarea id="service-notes" rows={3} {...register('notes')} />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit" loading={isSaving}>
          {isEditMode ? 'Guardar cambios' : 'Crear servicio'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => void navigate(-1)}
          disabled={isSaving}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
