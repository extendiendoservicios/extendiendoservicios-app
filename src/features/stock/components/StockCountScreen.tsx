import { useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router'
import { toast } from 'sonner'
import {
  CheckCircle2,
  ClipboardCheck,
  Info,
  PackageX,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Combobox } from '@/components/Combobox'
import { DatePicker } from '@/components/DatePicker'
import { EmptyState } from '@/components/EmptyState'
import { SegmentedControl } from '@/components/SegmentedControl'
import { TimeInput } from '@/components/TimeInput'
import { isApiError } from '@/api/errors'
import {
  STOCK_MOVEMENTS_LIMIT,
  type StockCountResult,
  type StockItem,
} from '@/api/stock'
import { useAuth } from '@/features/auth/AuthProvider'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import {
  useRegisterStockCountMutation,
  useStockItemsQuery,
  useStockMovementsQuery,
  useStockReviewersQuery,
  useSupplyCategoriesQuery,
} from '@/features/stock/queries'
import {
  argentinaDateTimeToIso,
  buildCountHeaderSchema,
  buildCountInput,
  buildCountLines,
  COUNT_MAX_DAYS_BACK,
  describeLaterMovements,
  isRetroactive,
  laterMovementsBySupply,
  nowInArgentina,
  systemQtyAt,
  type CountHeaderValues,
  type LaterMovements,
} from '@/features/stock/count'
import {
  DEFAULT_STOCK_FILTERS,
  filterStockItems,
  normalizeText,
  supplyLabel,
} from '@/features/stock/filters'
import { canManageStock } from '@/features/stock/permissions'
import { formatQty } from '@/features/stock/money'
import { CountLinesTable } from './CountLinesTable'
import { isoDateToDate } from './MovementFilters'

const REVIEWER_OPTIONS = [
  { value: 'person', label: 'Una persona de la app' },
  { value: 'name', label: 'Un nombre escrito' },
] as const

/**
 * «Cargar control» (`/admin/insumos/control`, IS-16, IS-31): se pasa al
 * sistema lo contado a mano. Fecha y hora del control (por defecto, ahora; no
 * futura), revisor (una persona de la app **o** un nombre escrito),
 * observaciones y una fila por artículo activo con su stock de referencia y un
 * campo «Contado». En blanco significa «no tocar». La diferencia se calcula
 * contra el stock del sistema a la hora del control, no contra el actual: si
 * el artículo tuvo movimientos después de esa hora, se avisa. Las diferencias
 * quedan como ajustes (`register_stock_count`). Solo con `manage_stock`.
 */
function StockCountScreen() {
  const auth = useAuth()
  const canManage = canManageStock(auth)
  const itemsQuery = useStockItemsQuery()
  const categoriesQuery = useSupplyCategoriesQuery()
  const reviewersQuery = useStockReviewersQuery()
  const register = useRegisterStockCountMutation()
  const [result, setResult] = useState<StockCountResult | null>(null)

  const [initialNow] = useState(() => new Date())
  const [defaults] = useState(() => {
    const now = nowInArgentina(initialNow)
    return {
      date: now.date,
      time: now.time,
      reviewerKind: 'person' as const,
      reviewerId: '',
      reviewerName: '',
      notes: '',
    }
  })
  const form = useForm<CountHeaderValues>({
    resolver: (values, context, options) =>
      // El «ahora» se toma al confirmar, no al abrir la pantalla.
      zodResolver(buildCountHeaderSchema(new Date()))(values, context, options),
    defaultValues: defaults,
  })
  const {
    register: field,
    handleSubmit,
    control,
    formState: { errors },
  } = form

  const [counted, setCounted] = useState<Record<string, string>>({})
  const [lineErrors, setLineErrors] = useState<Map<string, string>>(new Map())
  const [noLinesError, setNoLinesError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [categoryId, setCategoryId] = useState('all')

  const date = useWatch({ control, name: 'date' })
  const time = useWatch({ control, name: 'time' })
  const reviewerKind = useWatch({ control, name: 'reviewerKind' })
  const countedAtIso = date && time ? argentinaDateTimeToIso(date, time) : null
  const retroactive =
    countedAtIso !== null &&
    !Number.isNaN(new Date(countedAtIso).getTime()) &&
    isRetroactive(countedAtIso, new Date())

  const movementsQuery = useStockMovementsQuery(
    { dateFrom: date || undefined },
    { enabled: retroactive },
  )
  const later = useMemo(
    () =>
      retroactive && countedAtIso && movementsQuery.data
        ? laterMovementsBySupply(movementsQuery.data, countedAtIso)
        : new Map<string, LaterMovements>(),
    [retroactive, countedAtIso, movementsQuery.data],
  )
  const laterIsPartial =
    retroactive && (movementsQuery.data?.length ?? 0) >= STOCK_MOVEMENTS_LIMIT

  const activeItems = useMemo(
    () => (itemsQuery.data ?? []).filter((item) => item.active),
    [itemsQuery.data],
  )
  const visibleItems = useMemo(
    () =>
      filterStockItems(activeItems, {
        ...DEFAULT_STOCK_FILTERS,
        categoryId,
        text,
      }),
    [activeItems, categoryId, text],
  )
  const countedCount = buildCountLines(counted).lines.length

  function onValid(header: CountHeaderValues) {
    const { lines, errors: rowErrors } = buildCountLines(counted)
    setLineErrors(rowErrors)
    if (rowErrors.size > 0) {
      setNoLinesError(null)
      toast.error('Revisá las cantidades marcadas en rojo.')
      return
    }
    if (lines.length === 0) {
      setNoLinesError('Cargá la cantidad contada de al menos un artículo.')
      return
    }
    setNoLinesError(null)
    register.mutate(buildCountInput(header, lines), {
      onSuccess: setResult,
      onError: (error) => {
        toast.error(
          isApiError(error) ? error.message : 'No pudimos cargar el control.',
        )
      },
    })
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={PackageX}
        title="No tenés permiso para cargar controles"
        description="Pedile a la dueña el permiso «Gestionar stock»."
        action={
          <Button asChild variant="ghost">
            <Link to="/admin/insumos">Volver a Insumos</Link>
          </Button>
        }
      />
    )
  }

  if (result) {
    return <CountResultSummary result={result} />
  }

  if (itemsQuery.isLoading) {
    return (
      <div className="flex max-w-3xl flex-col gap-3">
        <Skeleton className="h-9" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const today = nowInArgentina(initialNow).date
  // IS-36: el servidor acepta el control desde 30 días atrás.
  const minDate = isoDateToDate(today)
  minDate.setDate(minDate.getDate() - COUNT_MAX_DAYS_BACK)

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onValid)(event)}
      className="flex max-w-4xl flex-col gap-4"
    >
      <div className="flex items-start gap-2 rounded-lg border border-info-border bg-info-bg p-4 text-[12.5px] text-info-800">
        <Info aria-hidden="true" className="mt-[2px] size-4 shrink-0" />
        <p>
          La diferencia de cada artículo se calcula contra el stock del sistema{' '}
          <strong>a la hora del control</strong>, no contra el de ahora: se
          descuentan los movimientos posteriores, así un retiro hecho entre el
          conteo y la carga no se toma como faltante. Las filas en blanco no se
          tocan.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.date || errors.time) || undefined}>
          <FieldLabel>Día del control</FieldLabel>
          <Controller
            control={control}
            name="date"
            render={({ field: dateField }) => (
              <DatePicker
                aria-label="Día del control"
                value={
                  dateField.value ? isoDateToDate(dateField.value) : undefined
                }
                onValueChange={(next) =>
                  dateField.onChange(next ? localDateToIsoDate(next) : '')
                }
                minDate={minDate}
                maxDate={isoDateToDate(today)}
              />
            )}
          />
          {errors.date && <FieldError>{errors.date.message}</FieldError>}
        </Field>
        <Field data-invalid={Boolean(errors.time) || undefined}>
          <FieldLabel htmlFor="count-time">Hora del control</FieldLabel>
          <TimeInput
            id="count-time"
            error={errors.time?.message}
            {...field('time')}
          />
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel>Quién revisó</FieldLabel>
          <Controller
            control={control}
            name="reviewerKind"
            render={({ field: kindField }) => (
              <SegmentedControl
                aria-label="Quién revisó"
                value={kindField.value}
                onValueChange={kindField.onChange}
                options={REVIEWER_OPTIONS.map((option) => ({ ...option }))}
              />
            )}
          />
        </Field>
        {reviewerKind === 'person' ? (
          <Field
            className="sm:col-span-2"
            data-invalid={Boolean(errors.reviewerId) || undefined}
          >
            <FieldLabel>Persona</FieldLabel>
            <Controller
              control={control}
              name="reviewerId"
              render={({ field: reviewerField }) => (
                <Combobox
                  aria-label="Persona que revisó"
                  options={(reviewersQuery.data ?? []).map((user) => ({
                    value: user.profileId,
                    label: `${user.firstName} ${user.lastName}`,
                  }))}
                  value={reviewerField.value || undefined}
                  onValueChange={reviewerField.onChange}
                  placeholder="Elegí una persona…"
                  searchPlaceholder="Buscar por nombre…"
                  emptyText="No encontramos a nadie con ese nombre."
                />
              )}
            />
            {errors.reviewerId && (
              <FieldError>{errors.reviewerId.message}</FieldError>
            )}
          </Field>
        ) : (
          <Field
            className="sm:col-span-2"
            data-invalid={Boolean(errors.reviewerName) || undefined}
          >
            <FieldLabel htmlFor="count-reviewer-name">
              Nombre de quien revisó
            </FieldLabel>
            <Input
              id="count-reviewer-name"
              autoComplete="off"
              aria-invalid={Boolean(errors.reviewerName)}
              {...field('reviewerName')}
            />
            {errors.reviewerName && (
              <FieldError>{errors.reviewerName.message}</FieldError>
            )}
          </Field>
        )}

        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(errors.notes) || undefined}
        >
          <FieldLabel htmlFor="count-notes">
            Observaciones (opcional)
          </FieldLabel>
          <Textarea
            id="count-notes"
            rows={3}
            aria-invalid={Boolean(errors.notes)}
            {...field('notes')}
          />
          {errors.notes && <FieldError>{errors.notes.message}</FieldError>}
        </Field>
      </div>

      {laterIsPartial && (
        <p
          role="status"
          className="rounded-lg border border-warning-border bg-warning-bg px-4 py-3 text-[12.5px] text-warning-800"
        >
          Hubo muchos movimientos desde ese día: el aviso de movimientos
          posteriores puede estar incompleto. El servidor calcula la diferencia
          con todos igual.
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[14px] font-semibold text-text">
            Artículos contados
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              icon={Search}
              placeholder="Buscar por código o nombre…"
              aria-label="Buscar artículo"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="w-60"
            />
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger aria-label="Filtrar por categoría">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las categorías</SelectItem>
                {(categoriesQuery.data ?? []).map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-[11.5px] text-text-3">
          Escribí lo que contaste en cada artículo. Dejá en blanco lo que no
          contaste. Un cero cuenta como «no hay nada».
        </p>

        {visibleItems.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-text-3">
            {normalizeText(text) === '' && categoryId === 'all'
              ? 'No hay artículos activos.'
              : 'No encontramos artículos con esos filtros.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {visibleItems.map((item) => (
              <CountRow
                key={item.id}
                item={item}
                value={counted[item.id] ?? ''}
                error={lineErrors.get(item.id)}
                laterCount={later.get(item.id)?.count ?? 0}
                systemAtTime={
                  retroactive && !laterIsPartial && later.has(item.id)
                    ? systemQtyAt(item, later.get(item.id))
                    : null
                }
                onChange={(next) => {
                  setCounted((previous) => ({ ...previous, [item.id]: next }))
                  setLineErrors((previous) => {
                    if (!previous.has(item.id)) return previous
                    const copy = new Map(previous)
                    copy.delete(item.id)
                    return copy
                  })
                  setNoLinesError(null)
                }}
              />
            ))}
          </ul>
        )}
        {noLinesError && (
          <p role="alert" className="text-[12.5px] text-danger-800">
            {noLinesError}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p className="text-[12px] text-text-3" aria-live="polite">
          {countedCount === 0
            ? 'Todavía no cargaste ningún artículo.'
            : countedCount === 1
              ? '1 artículo contado.'
              : `${countedCount} artículos contados.`}
        </p>
        <Button asChild variant="ghost">
          <Link to="/admin/insumos?pestana=controles">Cancelar</Link>
        </Button>
        <Button
          type="submit"
          icon={ClipboardCheck}
          loading={register.isPending}
        >
          Confirmar control
        </Button>
      </div>
    </form>
  )
}

function CountRow({
  item,
  value,
  error,
  laterCount,
  systemAtTime,
  onChange,
}: {
  item: StockItem
  value: string
  error: string | undefined
  laterCount: number
  systemAtTime: number | null
  onChange: (next: string) => void
}) {
  const inputId = `count-qty-${item.id}`
  return (
    <li className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[1fr_9rem] sm:items-start">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-text">
          {supplyLabel(item)}
        </p>
        <p className="text-[11px] text-text-3">
          <span className="font-mono">{item.code}</span>
          {' · '}
          {item.categoryName}
          {' · Stock actual '}
          <span className="font-semibold tabular-nums">
            {formatQty(item.stockQty)}
          </span>
        </p>
        {laterCount > 0 && (
          <p className="mt-[2px] text-[11px] text-warning-800">
            {describeLaterMovements(laterCount)}
            {systemAtTime !== null &&
              ` Stock del sistema a esa hora: ${formatQty(systemAtTime)}.`}
          </p>
        )}
      </div>
      <Field data-invalid={Boolean(error) || undefined}>
        <FieldLabel htmlFor={inputId} className="sr-only">
          {`Contado de ${supplyLabel(item)}`}
        </FieldLabel>
        <Input
          id={inputId}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Contado"
          value={value}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.value)}
        />
        {error && <FieldError>{error}</FieldError>}
      </Field>
    </li>
  )
}

function CountResultSummary({ result }: { result: StockCountResult }) {
  const differences = result.lines.filter((line) => line.difference !== 0)
  return (
    <div
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-5"
      data-testid="count-summary"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="size-5 text-success-800" />
        <h2 className="text-[15px] font-semibold text-text">Control cargado</h2>
      </div>
      <p className="text-[12.5px] text-text-2">
        {differences.length === 0
          ? 'Todo lo contado coincide con el sistema: no hizo falta ningún ajuste.'
          : differences.length === 1
            ? 'Hay 1 diferencia: quedó registrada como un ajuste de control de stock.'
            : `Hay ${differences.length} diferencias: quedaron registradas como un ajuste de control de stock.`}
      </p>
      <CountLinesTable
        lines={result.lines}
        caption="Stock del sistema, contado y diferencia por artículo"
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="ghost">
          <Link to="/admin/insumos?pestana=controles">Ver controles</Link>
        </Button>
        <Button asChild>
          <Link to="/admin/insumos">Volver a Stock</Link>
        </Button>
      </div>
    </div>
  )
}

export { StockCountScreen }
