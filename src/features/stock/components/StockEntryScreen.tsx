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
import type { StockPostResult } from '@/api/stock'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useRegisterStockEntryMutation,
  useStockItemsQuery,
} from '@/features/stock/queries'
import {
  ENTRY_KINDS,
  entrySchema,
  entryValuesToInput,
  findCostDifferences,
  type CostDifference,
  type EntryFormValues,
} from '@/features/stock/schemas'
import { canManageStock } from '@/features/stock/permissions'
import { supplyLabel } from '@/features/stock/filters'
import { formatMoney, formatQty } from '@/features/stock/money'
import { CostUpdateDialog } from './CostUpdateDialog'
import { EntryResultSummary } from './EntryResultSummary'

const EMPTY_VALUES: EntryFormValues = {
  kind: 'entry',
  lines: [],
  supplier: '',
  documentNumber: '',
  note: '',
}

/**
 * Formulario de ingreso o devolución (`/admin/insumos/ingreso`, IS-08, IS-09,
 * IS-23): se agregan artículos con un buscador, cada uno con su cantidad y un
 * costo unitario opcional. Proveedor, comprobante y observación son
 * opcionales. Si un costo cargado difiere del vigente, antes de confirmar se
 * pregunta si se actualiza el precio de costo (`update_cost`). Al confirmar se
 * muestra el resumen con el stock resultante.
 */
function StockEntryScreen() {
  const auth = useAuth()
  const canManage = canManageStock(auth)
  const itemsQuery = useStockItemsQuery()
  const register = useRegisterStockEntryMutation()
  const [result, setResult] = useState<StockPostResult | null>(null)
  const [pendingDifferences, setPendingDifferences] = useState<
    CostDifference[] | null
  >(null)
  const [pendingValues, setPendingValues] = useState<EntryFormValues | null>(
    null,
  )

  const form = useForm<EntryFormValues>({
    resolver: zodResolver(entrySchema),
    defaultValues: EMPTY_VALUES,
  })
  const {
    register: field,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = form
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const lines = useWatch({ control, name: 'lines' })
  const kind = useWatch({ control, name: 'kind' })

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const activeItems = useMemo(
    () => items.filter((item) => item.active),
    [items],
  )
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  )
  const pickedIds = new Set(lines.map((line) => line.supplyId))
  const options = activeItems
    .filter((item) => !pickedIds.has(item.id))
    .map((item) => ({
      value: item.id,
      label: `${item.code} · ${supplyLabel(item)}`,
    }))

  async function submit(values: EntryFormValues, updateCostFor: Set<string>) {
    try {
      const posted = await register.mutateAsync(
        entryValuesToInput(values, updateCostFor),
      )
      setPendingDifferences(null)
      setPendingValues(null)
      setResult(posted)
    } catch (error) {
      setPendingDifferences(null)
      toast.error(
        isApiError(error) ? error.message : 'No pudimos registrar el ingreso.',
      )
    }
  }

  function onValid(values: EntryFormValues) {
    const differences = findCostDifferences(values.lines, itemsById)
    if (differences.length > 0) {
      setPendingValues(values)
      setPendingDifferences(differences)
      return
    }
    void submit(values, new Set())
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={PackageX}
        title="No tenés permiso para registrar ingresos"
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
    return (
      <EntryResultSummary
        result={result}
        onAnother={() => {
          setResult(null)
          reset(EMPTY_VALUES)
        }}
      />
    )
  }

  if (itemsQuery.isLoading) {
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
        <Field>
          <FieldLabel>Tipo de movimiento</FieldLabel>
          <Controller
            control={control}
            name="kind"
            render={({ field: kindField }) => (
              <SegmentedControl
                aria-label="Tipo de movimiento"
                value={kindField.value}
                onValueChange={kindField.onChange}
                options={ENTRY_KINDS.map((option) => ({ ...option }))}
              />
            )}
          />
          {kind === 'return' && (
            <p className="text-[11.5px] text-text-3">
              Una devolución es algo que vuelve al stock: suma igual que un
              ingreso y queda marcada como devolución.
            </p>
          )}
        </Field>

        <Field data-invalid={Boolean(linesError) || undefined}>
          <FieldLabel>Artículos</FieldLabel>
          <Combobox
            aria-label="Agregar un artículo"
            options={options}
            placeholder="Buscar y agregar un artículo…"
            searchPlaceholder="Buscar por código o nombre…"
            emptyText="No encontramos artículos activos con ese texto."
            onValueChange={(supplyId) =>
              append({ supplyId, qty: '', unitCost: '' })
            }
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
                  className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_7rem_9rem_auto] sm:items-start"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-text">
                      {item ? supplyLabel(item) : 'Artículo'}
                    </p>
                    <p className="text-[11px] text-text-3">
                      <span className="font-mono">{item?.code}</span>
                      {item &&
                        ` · Hay ${formatQty(item.stockQty)} · Costo actual ${formatMoney(item.costPrice)}`}
                    </p>
                    {lineErrors?.supplyId && (
                      <p className="text-[11px] text-danger-800">
                        {lineErrors.supplyId.message}
                      </p>
                    )}
                  </div>
                  <Field data-invalid={Boolean(lineErrors?.qty) || undefined}>
                    <FieldLabel htmlFor={`entry-qty-${index}`}>
                      Cantidad
                    </FieldLabel>
                    <Input
                      id={`entry-qty-${index}`}
                      inputMode="numeric"
                      autoComplete="off"
                      aria-invalid={Boolean(lineErrors?.qty)}
                      {...field(`lines.${index}.qty`)}
                    />
                    {lineErrors?.qty && (
                      <FieldError>{lineErrors.qty.message}</FieldError>
                    )}
                  </Field>
                  <Field
                    data-invalid={Boolean(lineErrors?.unitCost) || undefined}
                  >
                    <FieldLabel htmlFor={`entry-cost-${index}`}>
                      Costo unitario (opcional)
                    </FieldLabel>
                    <Input
                      id={`entry-cost-${index}`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="$"
                      aria-invalid={Boolean(lineErrors?.unitCost)}
                      {...field(`lines.${index}.unitCost`)}
                    />
                    {lineErrors?.unitCost && (
                      <FieldError>{lineErrors.unitCost.message}</FieldError>
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

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.supplier) || undefined}>
          <FieldLabel htmlFor="entry-supplier">Proveedor (opcional)</FieldLabel>
          <Input
            id="entry-supplier"
            autoComplete="off"
            aria-invalid={Boolean(errors.supplier)}
            {...field('supplier')}
          />
          {errors.supplier && (
            <FieldError>{errors.supplier.message}</FieldError>
          )}
        </Field>
        <Field data-invalid={Boolean(errors.documentNumber) || undefined}>
          <FieldLabel htmlFor="entry-document">
            Remito o factura (opcional)
          </FieldLabel>
          <Input
            id="entry-document"
            autoComplete="off"
            aria-invalid={Boolean(errors.documentNumber)}
            {...field('documentNumber')}
          />
          {errors.documentNumber && (
            <FieldError>{errors.documentNumber.message}</FieldError>
          )}
        </Field>
        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(errors.note) || undefined}
        >
          <FieldLabel htmlFor="entry-note">Observación (opcional)</FieldLabel>
          <Textarea
            id="entry-note"
            rows={3}
            aria-invalid={Boolean(errors.note)}
            {...field('note')}
          />
          {errors.note && <FieldError>{errors.note.message}</FieldError>}
        </Field>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="ghost">
          <Link to="/admin/insumos">Cancelar</Link>
        </Button>
        <Button
          type="submit"
          loading={register.isPending && !pendingDifferences}
        >
          {kind === 'return' ? 'Registrar devolución' : 'Registrar ingreso'}
        </Button>
      </div>

      {pendingDifferences && (
        <CostUpdateDialog
          differences={pendingDifferences}
          open
          onOpenChange={(open) => {
            if (!open) setPendingDifferences(null)
          }}
          isLoading={register.isPending}
          onConfirm={(updateCostFor) => {
            if (pendingValues) void submit(pendingValues, updateCostFor)
          }}
        />
      )}
    </form>
  )
}

export { StockEntryScreen }
