import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import type { StockItem } from '@/api/stock'
import { useSetSupplyPricesMutation } from '@/features/stock/queries'
import {
  pricesValuesToInput,
  supplyPricesSchema,
  type SupplyPricesFormValues,
} from '@/features/stock/schemas'
import { moneyToInputText } from '@/features/stock/money'
import { supplyLabel } from '@/features/stock/filters'

/**
 * Cambiar precios (`set_supply_prices`, IS-06, IS-22): costo y venta del
 * artículo. Cada cambio queda en el historial (quién, cuándo, de cuánto a
 * cuánto); lo que ya se movió no se recalcula.
 */
function SupplyPricesDialog({
  item,
  open,
  onOpenChange,
}: {
  item: StockItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const setPrices = useSetSupplyPricesMutation()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SupplyPricesFormValues>({
    resolver: zodResolver(supplyPricesSchema),
    values: {
      costPrice: moneyToInputText(item.costPrice),
      salePrice: moneyToInputText(item.salePrice),
    },
  })

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function onSubmit(values: SupplyPricesFormValues) {
    const input = pricesValuesToInput(values)
    if (
      Math.round(input.costPrice * 100) === Math.round(item.costPrice * 100) &&
      Math.round(input.salePrice * 100) === Math.round(item.salePrice * 100)
    ) {
      toast.info(
        'Los precios son los mismos de antes: no hay nada que guardar.',
      )
      return
    }
    try {
      await setPrices.mutateAsync({ supplyId: item.id, ...input })
      toast.success('Actualizamos los precios.')
      handleOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar los precios.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar precios</DialogTitle>
          <DialogDescription>
            {supplyLabel(item)} ({item.code}). El cambio queda en el historial y
            no modifica lo ya registrado.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-[13px]"
        >
          <Field data-invalid={Boolean(errors.costPrice) || undefined}>
            <FieldLabel htmlFor="prices-cost">Precio de costo ($)</FieldLabel>
            <Input
              id="prices-cost"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={Boolean(errors.costPrice)}
              {...register('costPrice')}
            />
            {errors.costPrice && (
              <FieldError>{errors.costPrice.message}</FieldError>
            )}
          </Field>
          <Field data-invalid={Boolean(errors.salePrice) || undefined}>
            <FieldLabel htmlFor="prices-sale">Precio de venta ($)</FieldLabel>
            <Input
              id="prices-sale"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={Boolean(errors.salePrice)}
              {...register('salePrice')}
            />
            {errors.salePrice && (
              <FieldError>{errors.salePrice.message}</FieldError>
            )}
          </Field>
          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={setPrices.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={setPrices.isPending}>
              Guardar precios
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { SupplyPricesDialog }
