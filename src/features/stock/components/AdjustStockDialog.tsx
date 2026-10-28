import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SegmentedControl } from '@/components/SegmentedControl'
import { isApiError } from '@/api/errors'
import type { StockItem } from '@/api/stock'
import { useAdjustStockMutation } from '@/features/stock/queries'
import {
  ADJUSTMENT_REASONS,
  adjustValuesToDelta,
  buildAdjustSchema,
  type AdjustFormValues,
} from '@/features/stock/schemas'
import { supplyLabel } from '@/features/stock/filters'
import { formatQty } from '@/features/stock/money'

const EMPTY_VALUES = {
  sign: '+' as const,
  qty: '',
  reason: '' as unknown as AdjustFormValues['reason'],
  note: '',
}

/**
 * Ajustar (IS-10): el número no se pisa, se registra un ajuste `+` o `−` con
 * motivo obligatorio (y observación obligatoria con «Otro»). Queda en el
 * historial del artículo.
 */
function AdjustStockDialog({
  item,
  open,
  onOpenChange,
}: {
  item: StockItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const adjust = useAdjustStockMutation()
  const schema = useMemo(
    () => buildAdjustSchema(item?.stockQty ?? 0),
    [item?.stockQty],
  )
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<AdjustFormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_VALUES,
  })
  const sign = useWatch({ control, name: 'sign' })
  const qtyText = useWatch({ control, name: 'qty' })
  const reason = useWatch({ control, name: 'reason' })

  function handleOpenChange(next: boolean) {
    if (!next) reset(EMPTY_VALUES)
    onOpenChange(next)
  }

  async function onSubmit(values: AdjustFormValues) {
    if (!item) return
    try {
      const result = await adjust.mutateAsync({
        supplyId: item.id,
        delta: adjustValuesToDelta(values),
        reason: values.reason,
        note: values.note.trim() || null,
      })
      const after = result.lines[0]?.stockAfter
      toast.success(
        after === undefined
          ? 'Registramos el ajuste.'
          : `Registramos el ajuste. El stock queda en ${formatQty(after)}.`,
      )
      handleOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos registrar el ajuste.',
      )
    }
  }

  const qty = /^\d+$/.test(qtyText.trim()) ? Number(qtyText) : null
  const resulting =
    item && qty !== null ? item.stockQty + (sign === '-' ? -qty : qty) : null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar stock</DialogTitle>
          <DialogDescription>
            {item
              ? `${supplyLabel(item)} (${item.code}). Hay ${formatQty(item.stockQty)} en stock.`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-[13px]"
        >
          <Field>
            <FieldLabel>Tipo de ajuste</FieldLabel>
            <Controller
              control={control}
              name="sign"
              render={({ field }) => (
                <SegmentedControl
                  aria-label="Tipo de ajuste"
                  value={field.value}
                  onValueChange={field.onChange}
                  options={[
                    { value: '+', label: 'Sumar (+)' },
                    { value: '-', label: 'Restar (−)' },
                  ]}
                />
              )}
            />
          </Field>

          <Field data-invalid={Boolean(errors.qty) || undefined}>
            <FieldLabel htmlFor="adjust-qty">Cantidad</FieldLabel>
            <Input
              id="adjust-qty"
              inputMode="numeric"
              autoComplete="off"
              aria-invalid={Boolean(errors.qty)}
              {...register('qty')}
            />
            {errors.qty && <FieldError>{errors.qty.message}</FieldError>}
            {resulting !== null && resulting >= 0 && (
              <p className="text-[11.5px] text-text-3">
                El stock va a quedar en {formatQty(resulting)}.
              </p>
            )}
          </Field>

          <Field data-invalid={Boolean(errors.reason) || undefined}>
            <FieldLabel htmlFor="adjust-reason">Motivo</FieldLabel>
            <Controller
              control={control}
              name="reason"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="adjust-reason"
                    aria-invalid={Boolean(errors.reason)}
                    className="w-full"
                  >
                    <SelectValue placeholder="Elegí el motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADJUSTMENT_REASONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.reason && <FieldError>{errors.reason.message}</FieldError>}
          </Field>

          <Field data-invalid={Boolean(errors.note) || undefined}>
            <FieldLabel htmlFor="adjust-note">
              Observación{reason === 'other' ? '' : ' (opcional)'}
            </FieldLabel>
            <Textarea
              id="adjust-note"
              rows={3}
              aria-invalid={Boolean(errors.note)}
              {...register('note')}
            />
            {errors.note && <FieldError>{errors.note.message}</FieldError>}
          </Field>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={adjust.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={adjust.isPending}>
              Registrar ajuste
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { AdjustStockDialog }
