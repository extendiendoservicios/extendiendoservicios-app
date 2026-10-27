import { useMemo, useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { PackageX, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Combobox } from '@/components/Combobox'
import { EmptyState } from '@/components/EmptyState'
import { SegmentedControl } from '@/components/SegmentedControl'
import { isApiError } from '@/api/errors'
import type { WithdrawalShiftOption } from '@/api/stock'
import { useAuth } from '@/features/auth/AuthProvider'
import { ROLE_LABELS } from '@/features/auth/session'
import {
  useRegisterWithdrawalOnBehalfMutation,
  useStockItemsQuery,
  useStockPeopleQuery,
  useWithdrawalShiftOptionsQuery,
  useWithdrawalSiteOptionsQuery,
} from '@/features/stock/queries'
import {
  withdrawalSchema,
  withdrawalValuesToInput,
  type WithdrawalFormValues,
} from '@/features/stock/schemas'
import { canManageStock } from '@/features/stock/permissions'
import { supplyLabel } from '@/features/stock/filters'
import { formatQty } from '@/features/stock/money'
import { formatShiftDay } from '@/features/stock/labels'
import {
  findInsufficientLines,
  orderShiftsForPerson,
} from '@/features/stock/withdrawal'
import {
  WithdrawalResultSummary,
  type WithdrawalSummaryData,
} from './WithdrawalResultSummary'

const EMPTY_VALUES: WithdrawalFormValues = {
  personId: '',
  place: 'shift',
  shiftId: '',
  siteId: '',
  note: '',
  lines: [],
}

const PLACE_OPTIONS = [
  { value: 'shift', label: 'Un turno' },
  { value: 'site', label: 'Una sede' },
] as const

/** «jue 13 ago 08:00 · Cliente · Sede». */
function shiftSummaryLabel(shift: WithdrawalShiftOption | undefined): string {
  if (!shift) return ''
  return `${formatShiftDay(shift.shiftDate)} ${shift.startTime.slice(0, 5)} · ${shift.clientName} · ${shift.siteName}`
}

/**
 * Retiro en nombre de otra persona (`/admin/insumos/retiro`, IS-11, IS-12):
 * el mismo formulario del celular, con selector de persona (empleados y
 * coordinadores activos). Se elige un turno o una sede (con observación
 * obligatoria si es sede), los artículos y las cantidades. Descuenta el stock
 * en el momento (IS-13); al terminar muestra un resumen. Solo con
 * `manage_stock`. Turnos y sedes salen de las vistas `_admin` (IS-35): los
 * turnos de la persona elegida van primero, sin ocultar los demás.
 */
function WithdrawalOnBehalfScreen() {
  const auth = useAuth()
  const canManage = canManageStock(auth)
  const itemsQuery = useStockItemsQuery()
  const peopleQuery = useStockPeopleQuery('withdraw')
  const shiftsQuery = useWithdrawalShiftOptionsQuery(canManage)
  const sitesQuery = useWithdrawalSiteOptionsQuery(canManage)
  const register = useRegisterWithdrawalOnBehalfMutation()
  const [summary, setSummary] = useState<WithdrawalSummaryData | null>(null)

  const form = useForm<WithdrawalFormValues>({
    resolver: zodResolver(withdrawalSchema),
    defaultValues: EMPTY_VALUES,
  })
  const {
    register: field,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors },
  } = form
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = useWatch({ control, name: 'lines' })
  const place = useWatch({ control, name: 'place' })
  const personId = useWatch({ control, name: 'personId' })

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  )
  const pickedIds = new Set(lines.map((line) => line.supplyId))
  const supplyOptions = items
    .filter(
      (item) => item.active && item.stockQty > 0 && !pickedIds.has(item.id),
    )
    .map((item) => ({
      value: item.id,
      label: `${item.code} · ${supplyLabel(item)} (hay ${formatQty(item.stockQty)})`,
    }))
  const people = peopleQuery.data ?? []
  const personOptions = people.map((person) => ({
    value: person.profileId,
    label: `${person.firstName} ${person.lastName} · ${
      person.roles.includes('supervisor')
        ? ROLE_LABELS.supervisor
        : ROLE_LABELS.employee
    }`,
  }))
  // Los turnos de la persona elegida van primero y marcados; el resto sigue
  // disponible (la administración puede cargar un retiro de cualquier turno).
  const pickedPerson = people.find((person) => person.profileId === personId)
  const shiftOptions = orderShiftsForPerson(
    shiftsQuery.data ?? [],
    personId,
    pickedPerson?.roles.includes('supervisor') ?? false,
  ).map(({ shift, ofPerson }) => ({
    value: shift.shiftId,
    label: `${shiftSummaryLabel(shift)}${
      shift.shiftStatus === 'cancelled' ? ' · cancelado' : ''
    }${ofPerson ? ' · es su turno' : ''}`,
  }))
  const siteOptions = (sitesQuery.data ?? []).map((site) => ({
    value: site.siteId,
    label: `${site.clientName} · ${site.siteName}`,
  }))

  async function onValid(values: WithdrawalFormValues) {
    // Aviso antes de mandar: el servidor igual corta con `INSUFFICIENT_STOCK`.
    const insufficient = findInsufficientLines(values.lines, itemsById)
    if (insufficient.length > 0) {
      for (const problem of insufficient) {
        setError(`lines.${problem.index}.qty`, {
          message: `No alcanza el stock: hay ${formatQty(problem.available)}.`,
        })
      }
      return
    }
    try {
      const result = await register.mutateAsync(withdrawalValuesToInput(values))
      setSummary({
        result,
        personName:
          personOptions
            .find((option) => option.value === values.personId)
            ?.label.split(' · ')[0] ?? '',
        place:
          values.place === 'shift'
            ? shiftSummaryLabel(
                (shiftsQuery.data ?? []).find(
                  (shift) => shift.shiftId === values.shiftId,
                ),
              )
            : (siteOptions.find((option) => option.value === values.siteId)
                ?.label ?? ''),
        note: values.note.trim() || null,
      })
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos registrar el retiro.',
      )
    }
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={PackageX}
        title="No tenés permiso para registrar retiros"
        description="Pedile a la dueña el permiso «Gestionar stock»."
        action={
          <Button asChild variant="ghost">
            <Link to="/admin/insumos">Volver a Insumos</Link>
          </Button>
        }
      />
    )
  }

  if (summary) {
    return (
      <WithdrawalResultSummary
        data={summary}
        onAnother={() => {
          setSummary(null)
          reset(EMPTY_VALUES)
        }}
      />
    )
  }

  if (itemsQuery.isLoading || peopleQuery.isLoading) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const linesError =
    errors.lines?.message ?? errors.lines?.root?.message ?? undefined

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      className="flex max-w-3xl flex-col gap-4"
    >
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <p className="text-[12.5px] text-text-2">
          Cargá un retiro en nombre de otra persona. El stock se descuenta en el
          momento y el retiro queda a nombre de quien retira, con tu usuario
          como quien lo cargó.
        </p>

        <Field data-invalid={Boolean(errors.personId) || undefined}>
          <FieldLabel>Quién retira</FieldLabel>
          <Controller
            control={control}
            name="personId"
            render={({ field: personField }) => (
              <Combobox
                aria-label="Quién retira"
                options={personOptions}
                value={personField.value || undefined}
                onValueChange={personField.onChange}
                placeholder="Elegí un empleado o coordinador…"
                searchPlaceholder="Buscar por nombre…"
                emptyText="No encontramos a nadie con ese nombre."
              />
            )}
          />
          {errors.personId && (
            <FieldError>{errors.personId.message}</FieldError>
          )}
        </Field>

        <Field>
          <FieldLabel>Para qué retira</FieldLabel>
          <Controller
            control={control}
            name="place"
            render={({ field: placeField }) => (
              <SegmentedControl
                aria-label="Para qué retira"
                value={placeField.value}
                onValueChange={placeField.onChange}
                options={PLACE_OPTIONS.map((option) => ({ ...option }))}
              />
            )}
          />
        </Field>

        {place === 'shift' ? (
          <Field data-invalid={Boolean(errors.shiftId) || undefined}>
            <FieldLabel>Turno</FieldLabel>
            {pickedPerson && (
              <p className="text-[11.5px] text-text-3">
                Los turnos de {pickedPerson.firstName} salen primero.
              </p>
            )}
            <Controller
              control={control}
              name="shiftId"
              render={({ field: shiftField }) => (
                <Combobox
                  aria-label="Turno"
                  options={shiftOptions}
                  value={shiftField.value || undefined}
                  onValueChange={shiftField.onChange}
                  placeholder="Elegí el turno…"
                  searchPlaceholder="Buscar por cliente, sede o día…"
                  emptyText="No hay turnos entre los últimos 30 días y los próximos 7."
                />
              )}
            />
            {errors.shiftId && (
              <FieldError>{errors.shiftId.message}</FieldError>
            )}
          </Field>
        ) : (
          <Field data-invalid={Boolean(errors.siteId) || undefined}>
            <FieldLabel>Sede</FieldLabel>
            <Controller
              control={control}
              name="siteId"
              render={({ field: siteField }) => (
                <Combobox
                  aria-label="Sede"
                  options={siteOptions}
                  value={siteField.value || undefined}
                  onValueChange={siteField.onChange}
                  placeholder="Elegí la sede…"
                  searchPlaceholder="Buscar por cliente o sede…"
                  emptyText="No encontramos sedes con ese texto."
                />
              )}
            />
            {errors.siteId && <FieldError>{errors.siteId.message}</FieldError>}
          </Field>
        )}

        <Field data-invalid={Boolean(errors.note) || undefined}>
          <FieldLabel htmlFor="withdrawal-note">
            {place === 'site' ? 'Observación' : 'Observación (opcional)'}
          </FieldLabel>
          <Textarea
            id="withdrawal-note"
            rows={3}
            placeholder={
              place === 'site' ? 'Por ejemplo: reposición de la semana' : ''
            }
            aria-invalid={Boolean(errors.note)}
            {...field('note')}
          />
          {errors.note && <FieldError>{errors.note.message}</FieldError>}
        </Field>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <Field data-invalid={Boolean(linesError) || undefined}>
          <FieldLabel>Artículos</FieldLabel>
          <Combobox
            aria-label="Agregar un artículo"
            options={supplyOptions}
            placeholder="Buscar y agregar un artículo…"
            searchPlaceholder="Buscar por código o nombre…"
            emptyText="No encontramos artículos con stock con ese texto."
            onValueChange={(supplyId) => append({ supplyId, qty: '' })}
          />
          {linesError && <FieldError>{linesError}</FieldError>}
        </Field>

        {fields.length > 0 && (
          <ul className="flex flex-col gap-3">
            {fields.map((lineField, index) => {
              const item = itemsById.get(lineField.supplyId)
              const lineErrors = errors.lines?.[index]
              return (
                <li
                  key={lineField.id}
                  className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-start"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-text">
                      {item ? supplyLabel(item) : 'Artículo'}
                    </p>
                    <p className="text-[11px] text-text-3">
                      <span className="font-mono">{item?.code}</span>
                      {item && ` · Hay ${formatQty(item.stockQty)}`}
                    </p>
                    {lineErrors?.supplyId && (
                      <p className="text-[11px] text-danger-800">
                        {lineErrors.supplyId.message}
                      </p>
                    )}
                  </div>
                  <Field data-invalid={Boolean(lineErrors?.qty) || undefined}>
                    <FieldLabel htmlFor={`withdrawal-qty-${index}`}>
                      Cantidad
                    </FieldLabel>
                    <Input
                      id={`withdrawal-qty-${index}`}
                      inputMode="numeric"
                      autoComplete="off"
                      aria-invalid={Boolean(lineErrors?.qty)}
                      {...field(`lines.${index}.qty`)}
                    />
                    {lineErrors?.qty && (
                      <FieldError>{lineErrors.qty.message}</FieldError>
                    )}
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={Trash2}
                    className="sm:mt-5"
                    onClick={() => remove(index)}
                    aria-label={`Quitar ${item ? supplyLabel(item) : 'el artículo'}`}
                  >
                    Quitar
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="ghost">
          <Link to="/admin/insumos">Cancelar</Link>
        </Button>
        <Button type="submit" loading={register.isPending}>
          Registrar retiro
        </Button>
      </div>
    </form>
  )
}

export { WithdrawalOnBehalfScreen }
