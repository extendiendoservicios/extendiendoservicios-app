import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { useSetSupplyActiveMutation } from '@/features/stock/queries'
import { supplyLabel } from '@/features/stock/filters'
import { formatQty } from '@/features/stock/money'

/**
 * Desactivar un artículo (IS-26, P-014: no se borra). Solo se puede con el
 * stock en cero: si no lo está, el diálogo lo explica y ofrece ir a
 * «Ajustar»; el servidor lo vuelve a exigir (`STOCK_NOT_ZERO`).
 */
function DeactivateSupplyDialog({
  item,
  open,
  onOpenChange,
  onAdjust,
}: {
  item: StockItem
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Abre «Ajustar» para dejar el stock en cero. */
  onAdjust: () => void
}) {
  const setActive = useSetSupplyActiveMutation()
  const hasStock = item.stockQty !== 0

  async function handleConfirm() {
    try {
      await setActive.mutateAsync({ supplyId: item.id, active: false })
      toast.success('Desactivamos el artículo.')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos desactivar el artículo.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {hasStock
              ? 'Primero ajustá el stock a cero'
              : 'Desactivar el artículo'}
          </DialogTitle>
          <DialogDescription>
            {hasStock
              ? `${supplyLabel(item)} tiene ${formatQty(item.stockQty)} en stock. Para desactivarlo, primero ajustá el stock a cero (con «Ajustar», por ejemplo por vencimiento o rotura).`
              : `${supplyLabel(item)} deja de aparecer en el catálogo y no recibe ingresos ni retiros. No se borra: podés volver a activarlo cuando quieras.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={setActive.isPending}
          >
            Cancelar
          </Button>
          {hasStock ? (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false)
                onAdjust()
              }}
            >
              Ajustar stock
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              loading={setActive.isPending}
              onClick={() => void handleConfirm()}
            >
              Desactivar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { DeactivateSupplyDialog }
