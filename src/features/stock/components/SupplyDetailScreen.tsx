import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import {
  ArrowLeft,
  PackageX,
  Pencil,
  Power,
  SlidersHorizontal,
  Tag,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useSetSupplyActiveMutation,
  useStockItemQuery,
  useSupplyImageUrls,
} from '@/features/stock/queries'
import { canManageStock } from '@/features/stock/permissions'
import { supplyLabel } from '@/features/stock/filters'
import { formatMoney, formatQty } from '@/features/stock/money'
import { AdjustStockDialog } from './AdjustStockDialog'
import { DeactivateSupplyDialog } from './DeactivateSupplyDialog'
import { PriceHistorySection } from './PriceHistorySection'
import { StockAlertBadge } from './StockAlertBadge'
import { SupplyImage } from './SupplyImage'
import { SupplyMovementsSection } from './SupplyMovementsSection'
import { SupplyPricesDialog } from './SupplyPricesDialog'

function Datum({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold tracking-wide text-text-3 uppercase">
        {label}
      </dt>
      <dd className="text-[13px] text-text">{children}</dd>
    </div>
  )
}

/**
 * Ficha del artículo (`/admin/insumos/:id`, IS-18, IS-22, IS-26): datos e
 * imagen, «Editar», «Cambiar precios» con su historial, «Ajustar»,
 * «Desactivar» o «Activar» y los movimientos del artículo. Sin
 * `manage_stock` se ve todo, sin los botones que cambian algo (IS-21).
 */
function SupplyDetailScreen() {
  const { id } = useParams()
  const auth = useAuth()
  const canManage = canManageStock(auth)
  const itemQuery = useStockItemQuery(id)
  const setActive = useSetSupplyActiveMutation()
  const [pricesOpen, setPricesOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const item = itemQuery.data
  const imageUrls = useSupplyImageUrls([item?.imagePath ?? null])

  if (itemQuery.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  if (!item) {
    return (
      <EmptyState
        icon={PackageX}
        title="No encontramos este artículo"
        description="Puede que se haya movido o que el enlace esté roto."
        action={
          <Button asChild variant="ghost">
            <Link to="/admin/insumos">Volver a Insumos</Link>
          </Button>
        }
      />
    )
  }

  async function handleActivate() {
    if (!item) return
    try {
      await setActive.mutateAsync({ supplyId: item.id, active: true })
      toast.success('Activamos el artículo.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos activar el artículo.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button asChild variant="link" size="sm" icon={ArrowLeft}>
          <Link to="/admin/insumos">Volver a Insumos</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex min-w-0 items-start gap-4">
          <SupplyImage
            path={item.imagePath}
            urls={imageUrls}
            alt={`Imagen de ${supplyLabel(item)}`}
            className="size-24"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold text-text">
                {supplyLabel(item)}
              </h2>
              {item.active ? (
                <Badge variant="success" dot>
                  Activo
                </Badge>
              ) : (
                <Badge variant="neutral" dot>
                  Inactivo
                </Badge>
              )}
              <StockAlertBadge item={item} />
            </div>
            <p className="font-mono text-[12px] text-text-3">{item.code}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
              <Datum label="Categoría">{item.categoryName}</Datum>
              <Datum label="Stock">
                <span className="font-semibold tabular-nums">
                  {formatQty(item.stockQty)}
                </span>
              </Datum>
              <Datum label="Mínimo">
                {item.minQty == null ? 'Sin mínimo' : formatQty(item.minQty)}
              </Datum>
              <Datum label="Costo">
                <span className="tabular-nums">
                  {formatMoney(item.costPrice)}
                </span>
              </Datum>
              <Datum label="Venta">
                <span className="tabular-nums">
                  {formatMoney(item.salePrice)}
                </span>
              </Datum>
              <Datum label="Valor a costo">
                <span className="tabular-nums">
                  {formatMoney(item.stockValue)}
                </span>
              </Datum>
            </dl>
            {item.notes && (
              <p className="mt-3 text-[12px] text-text-3">{item.notes}</p>
            )}
          </div>
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {item.active && (
              <Button
                variant="ghost"
                size="sm"
                icon={SlidersHorizontal}
                onClick={() => setAdjustOpen(true)}
              >
                Ajustar
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={Tag}
              onClick={() => setPricesOpen(true)}
            >
              Cambiar precios
            </Button>
            {item.active ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Power}
                onClick={() => setDeactivateOpen(true)}
              >
                Desactivar
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={Power}
                loading={setActive.isPending}
                onClick={() => void handleActivate()}
              >
                Activar
              </Button>
            )}
            <Button asChild size="sm" icon={Pencil}>
              <Link to={`/admin/insumos/${item.id}/editar`}>Editar</Link>
            </Button>
          </div>
        )}
      </div>

      <PriceHistorySection supplyId={item.id} />
      <SupplyMovementsSection supplyId={item.id} />

      {canManage && (
        <>
          <SupplyPricesDialog
            item={item}
            open={pricesOpen}
            onOpenChange={setPricesOpen}
          />
          <AdjustStockDialog
            item={item}
            open={adjustOpen}
            onOpenChange={setAdjustOpen}
          />
          <DeactivateSupplyDialog
            item={item}
            open={deactivateOpen}
            onOpenChange={setDeactivateOpen}
            onAdjust={() => setAdjustOpen(true)}
          />
        </>
      )}
    </div>
  )
}

export { SupplyDetailScreen }
